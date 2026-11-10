// kpis.js
// Pure KPI calculations for the Assessment Committee dashboard.
// Every function takes the app's global state and returns plain numbers/lists,
// The same definitions run on the back end for GET /api/reports/kpis (backend/services/kpis.js).
// professors / courses come from the API (see api/adapters.js); due status is computed by the server.

import { isPastDeadline } from './deadlines.js';

export const TARGET_LIST_SIZE = 5; // the backend's matching service lists up to 5 observers per sign-up
 
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);
 
// "TR 10:00 AM - 11:15 AM" -> { days: ['T','R'], start: 600, end: 675 }  (minutes after midnight)
const toMinutes = (t = '') => {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return h * 60 + Number(m[2]);
};
const parseTiming = (timing = '') => {
  const [days = '', ...rest] = timing.trim().split(/\s+/);
  const [startText = '', endText = ''] = rest.join(' ').split('-');
  const start = toMinutes(startText);
  const end = toMinutes(endText) ?? (start === null ? null : start + 75);
  return { days: days.toUpperCase().split(''), start, end };
};

// Same weekday AND overlapping time ranges
const timingsOverlap = (a, b) => {
  const ta = parseTiming(a);
  const tb = parseTiming(b);
  if (!ta.days.some(d => tb.days.includes(d))) return false;
  if ([ta.start, ta.end, tb.start, tb.end].some(v => v === null)) return false;
  return ta.start < tb.end && tb.start < ta.end;
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
  OTHER_MAJOR: { code: 'b', label: 'Same-level professor from another major' },
  DIFFERENT_LEVEL: { code: 'c', label: 'Different-level professor (same or any major)' },
  SCHEDULE_CONFLICT: { code: 'd', label: 'Same-level, same-major professor who teaches at the requested day/time' },
};
 
// Independently re-checks one observee -> observer pairing against the eligibility rules.
// Returns the list of violated rules (empty array = correct pairing).
export const auditPairing = (observeeId, observerId, courseCode, timing, { professors = [], courses = [] } = {}) => {
  const observee = professors.find(p => p.professor_id === observeeId);
  const observer = professors.find(p => p.professor_id === observerId);
  if (!observee || !observer) return [];
 
  if (observee.professor_id === observer.professor_id) return ['SAME_PROF'];
 
  const level = courseLevel(courseCode);
  const observerCourses = courses.filter(c => c.instructor_id === observer.professor_id);
  const sameLevel = observerCourses.some(c => courseLevel(c.course_code) === level);
  const sameMajor = observer.major === observee.major;
 
  const violations = [];
  if (!sameLevel) violations.push('DIFFERENT_LEVEL');
  else if (!sameMajor) violations.push('OTHER_MAJOR');
  else if (observerCourses.some(c => timingsOverlap(c.timing, timing))) violations.push('SCHEDULE_CONFLICT');
  return violations;
};
 
// 1a. Evaluation Eligibility Accuracy
// Audits every observer that was recommended to a sign-up AND every observer that ended up confirmed.
export const computeEligibilityAccuracy = (signups, observations, directory) => {
  const audited = [];
 
  signups.forEach(s => {
    (s.eligibleObservers || []).forEach(obs => {
      audited.push({
        source: 'Recommended',
        observeeName: s.observeeName,
        observerName: obs.name,
        courseCode: s.courseCode,
        timing: s.timing,
        violations: auditPairing(s.observeeId, obs.professor_id, s.courseCode, s.timing, directory),
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
      violations: auditPairing(o.observeeId, o.observerId, o.courseCode, o.timing, directory),
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
 
// 1b. Overdue Evaluation Count (Assistant: every calendar year; Associate/Full: same semester two years later)
export const computeOverdue = (signups, professors = []) => {
  const faculty = professors;
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
export const computeObserverUtilization = (signups, observations, professors = []) => {
  const observerIds = new Set(observations.filter(o => o.status !== 'Missed').map(o => o.observerId));
  const signedUp = new Set(signups.map(s => s.observeeId));
  return {
    numerator: observerIds.size,
    denominator: signedUp.size,
    rate: pct(observerIds.size, signedUp.size),
    observers: professors.filter(p => observerIds.has(p.professor_id)),
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
export const computeMissingObservations = (observations, observationDeadline, today = new Date(), observationTime = '') => {
  const deadlinePassed = isPastDeadline(observationDeadline, observationTime, today);
 
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
export const computeAllKpis = ({ signups, requests, observations, surveySubmissions, deadlines, today, professors = [], courses = [] }) => {
  const overdue = computeOverdue(signups, professors);
  return {
    eligibility: computeEligibilityAccuracy(signups, observations, { professors, courses }),
    overdue,
    participation: computeParticipation(signups, overdue.due),
    utilization: computeObserverUtilization(signups, observations, professors),
    sufficiency: computeListSufficiency(signups),
    missing: computeMissingObservations(observations, deadlines?.observation, today, deadlines?.observationTime),
    survey: computeSurveyCompletion(signups, requests, observations, surveySubmissions),
  };
};