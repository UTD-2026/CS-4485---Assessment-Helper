// kpis.js
// Pure KPI calculations for the Assessment Committee dashboard.
// Every function takes the app's global state and returns plain numbers/lists,
// so the same logic can later run on the Node/MySQL back end unchanged.
 
import { mockProfessors, mockCourses, calculateEvaluationStatus } from './mockDatabase.js';
 
export const TARGET_LIST_SIZE = 5; // matchmaker.js returns up to 5 observers per sign-up
 
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);
 
// "TR 10:00 AM" -> { days: ['T','R'], time: '10:00 AM' }
const parseTiming = (timing = '') => {
  const [days = '', ...rest] = timing.trim().split(/\s+/);
  return { days: days.toUpperCase().split(''), time: rest.join(' ').toUpperCase() };
};
 
const timingsOverlap = (a, b) => {
  const ta = parseTiming(a);
  const tb = parseTiming(b);
  return ta.time === tb.time && ta.days.some(d => tb.days.includes(d));
};
 
// Course level = first digit of the course number ("CS 3345" -> "3"), same rule as matchmaker.js
const courseLevel = (courseCode = '') => {
  const parts = courseCode.split(' ');
  return parts.length > 1 ? parts[1].charAt(0) : '1';
};
 
/* =========================================
   1. FACULTY EVALUATION KPI
========================================= */
 
export const VIOLATION_TYPES = {
  SAME_PROF: { code: 'a', label: 'Same professor as the observee' },
  OTHER_DEPT: { code: 'b', label: 'Same-level professor from another department' },
  DIFFERENT_LEVEL: { code: 'c', label: 'Different-level professor (same or any department)' },
  SCHEDULE_CONFLICT: { code: 'd', label: 'Same-level, same-department professor who teaches at the requested day/time' },
};
 
// Independently re-checks one observee -> observer pairing against the eligibility rules.
// Returns the list of violated rules (empty array = correct pairing).
export const auditPairing = (observeeId, observerId, courseCode, timing) => {
  const observee = mockProfessors.find(p => p.professor_id === observeeId);
  const observer = mockProfessors.find(p => p.professor_id === observerId);
  if (!observee || !observer) return [];
 
  if (observee.professor_id === observer.professor_id) return ['SAME_PROF'];
 
  const level = courseLevel(courseCode);
  const observerCourses = mockCourses.filter(c => c.instructor_id === observer.professor_id);
  const sameLevel = observerCourses.some(c => courseLevel(c.course_code) === level);
  const sameDept = observer.department === observee.department;
 
  const violations = [];
  if (!sameLevel) violations.push('DIFFERENT_LEVEL');
  else if (!sameDept) violations.push('OTHER_DEPT');
  else if (observerCourses.some(c => timingsOverlap(c.timing, timing))) violations.push('SCHEDULE_CONFLICT');
  return violations;
};
 
// 1a. Evaluation Eligibility Accuracy
// Audits every observer that was recommended to a sign-up AND every observer that ended up confirmed.
export const computeEligibilityAccuracy = (signups, observations) => {
  const audited = [];
 
  signups.forEach(s => {
    (s.eligibleObservers || []).forEach(obs => {
      audited.push({
        source: 'Recommended',
        observeeName: s.observeeName,
        observerName: obs.name,
        courseCode: s.courseCode,
        timing: s.timing,
        violations: auditPairing(s.observeeId, obs.professor_id, s.courseCode, s.timing),
      });
    });
  });
 
  observations.forEach(o => {
    audited.push({
      source: 'Confirmed',
      observeeName: o.observeeName,
      observerName: o.observerName,
      courseCode: o.courseCode,
      timing: o.timing,
      violations: auditPairing(o.observeeId, o.observerId, o.courseCode, o.timing),
    });
  });
 
  const incorrect = audited.filter(a => a.violations.length > 0);
  const byType = Object.fromEntries(Object.keys(VIOLATION_TYPES).map(k => [k, 0]));
  incorrect.forEach(a => a.violations.forEach(v => { byType[v] += 1; }));
 
  return {
    total: audited.length,
    correct: audited.length - incorrect.length,
    incorrect,
    byType,
    rate: audited.length ? pct(audited.length - incorrect.length, audited.length) : null,
  };
};
 
// 1b. Overdue Evaluation Count (Evaluation Cycle spec: Assistant = every 2 semesters, Associate/Full = every 4)
export const computeOverdue = (signups) => {
  const faculty = mockProfessors.map(p => ({ ...p, ...calculateEvaluationStatus(p) }));
  const overdue = faculty
    .filter(f => f.status === 'Overdue')
    .map(f => ({ ...f, signedUp: signups.some(s => s.observeeId === f.professor_id) }))
    .sort((a, b) => b.overdue_by - a.overdue_by);
  const due = faculty.filter(f => f.status === 'Due' || f.status === 'Overdue');
  return { count: overdue.length, overdue, due, notSignedUp: overdue.filter(f => !f.signedUp).length };
};
 
/* =========================================
   2. ASSESSMENT PARTICIPATION KPI
========================================= */
 
// 2a. # of Profs who signed up this cycle / # of Profs who were due
export const computeParticipation = (signups, dueFaculty) => {
  const dueIds = new Set(dueFaculty.map(f => f.professor_id));
  const signedUpDue = new Set(signups.filter(s => dueIds.has(s.observeeId)).map(s => s.observeeId));
  return { numerator: signedUpDue.size, denominator: dueIds.size, rate: pct(signedUpDue.size, dueIds.size) };
};
 
// 2b. # of Profs who took on the Observer role / # of Profs who signed up
export const computeObserverUtilization = (signups, observations) => {
  const observerIds = new Set(observations.filter(o => o.status !== 'Missed').map(o => o.observerId));
  const signedUp = new Set(signups.map(s => s.observeeId));
  return {
    numerator: observerIds.size,
    denominator: signedUp.size,
    rate: pct(observerIds.size, signedUp.size),
    observers: mockProfessors.filter(p => observerIds.has(p.professor_id)),
  };
};
 
/* =========================================
   3. RECOMMENDATION ENGINE KPI
========================================= */
 
// 3a. List sufficiency rate: total observer matches / # of sign-ups (= average list size per sign-up)
export const computeListSufficiency = (signups) => {
  const totalMatches = signups.reduce((sum, s) => sum + (s.matchesCount || 0), 0);
  const avg = signups.length ? Math.round((totalMatches / signups.length) * 10) / 10 : 0;
  return {
    totalMatches,
    signups: signups.length,
    average: avg,
    rateOfTarget: pct(avg, TARGET_LIST_SIZE),
    fullLists: signups.filter(s => s.matchFlag === 'OK').length,
    insufficient: signups.filter(s => s.matchFlag === 'INSUFFICIENT OBSERVERS').length,
    none: signups.filter(s => s.matchFlag === 'NO ELIGIBLE OBSERVER').length,
  };
};
 
/* =========================================
   4. SURVEY & OBSERVATION COMPLETION KPI
========================================= */
 
// 4a. Missing Observation Count: approved (confirmed) appointments that did not go through.
// Counted as missing when either party reports it did not happen, or when the observation
// deadline has passed without BOTH the observer and the observee confirming it took place.
export const computeMissingObservations = (observations, observationDeadline, today = new Date()) => {
  const deadlinePassed = observationDeadline ? today > new Date(`${observationDeadline}T23:59:59`) : false;
 
  const missing = observations
    .map(o => {
      if (o.status === 'Missed') return { ...o, reason: `Reported not held by ${o.missedReportedBy || 'a participant'}` };
      if (deadlinePassed && o.status !== 'Completed') {
        const waitingOn = [!o.observerConfirmed && 'observer', !o.observeeConfirmed && 'observee'].filter(Boolean).join(' & ');
        return { ...o, reason: `Deadline passed without pair-confirmation (waiting on ${waitingOn})` };
      }
      return null;
    })
    .filter(Boolean);
 
  return {
    count: missing.length,
    missing,
    approved: observations.length,
    pairConfirmed: observations.filter(o => o.status === 'Completed').length,
    awaiting: observations.filter(o => o.status !== 'Completed' && o.status !== 'Missed').length,
    deadlinePassed,
  };
};
 
// 4b. Survey Completion Rate: Profs who completed the ENTIRE process / # of sign-ups.
// Process = Sign up AND sent request(s) AND had 1 request confirmed AND was observed AND submitted the survey.
export const computeSurveyCompletion = (signups, requests, observations, surveySubmissions) => {
  const stages = signups.map(s => {
    const id = s.observeeId;
    const sentRequest = requests.some(r => r.observeeId === id);
    const obs = observations.find(o => o.observeeId === id);
    const confirmed = Boolean(obs) || requests.some(r => r.observeeId === id && r.status === 'Confirmed');
    const observed = obs?.status === 'Completed';
    const surveyed = surveySubmissions.some(sub => sub.professor_id === id);
    return { id, name: s.observeeName, signedUp: true, sentRequest, confirmed, observed, surveyed };
  });
 
  const funnel = [
    { key: 'signedUp', label: 'Signed up' },
    { key: 'sentRequest', label: 'Sent request(s)' },
    { key: 'confirmed', label: '1 request confirmed' },
    { key: 'observed', label: 'Was observed' },
    { key: 'surveyed', label: 'Submitted survey' },
  ].map((step, i, all) => ({
    ...step,
    // cumulative: a prof only counts at a step if they also passed every earlier step
    count: stages.filter(p => all.slice(0, i + 1).every(prev => p[prev.key])).length,
  }));
 
  const completed = funnel[funnel.length - 1].count;
  return { numerator: completed, denominator: signups.length, rate: pct(completed, signups.length), funnel, stages };
};
 
/* =========================================
   ALL KPIs
========================================= */
export const computeAllKpis = ({ signups, requests, observations, surveySubmissions, deadlines, today }) => {
  const overdue = computeOverdue(signups);
  return {
    eligibility: computeEligibilityAccuracy(signups, observations),
    overdue,
    participation: computeParticipation(signups, overdue.due),
    utilization: computeObserverUtilization(signups, observations),
    sufficiency: computeListSufficiency(signups),
    missing: computeMissingObservations(observations, deadlines?.observation, today),
    survey: computeSurveyCompletion(signups, requests, observations, surveySubmissions),
  };
};