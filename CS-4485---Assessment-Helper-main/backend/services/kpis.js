// Executive-dashboard KPIs (Assessment Committee). computeDashboard() is a PURE function over plain arrays,
// so the demos can run it on the team's seed data with no database at all.
//
// Definitions (carried over from the committee's KPI list):
//   Overdue Evaluation Count          professors overdue at the start of the cycle who have not finished yet
//   Assessment Participation Rate     signups / (professors due-or-overdue at the start, plus anyone who completed)
//   Observer Utilization Rate         distinct confirmed observers / signups
//   List Sufficiency Rate             share of signups (where observer selection ran) that found >= 1 eligible observer
//   Evaluation Eligibility Accuracy   share of observer pairings on file that satisfy all four eligibility rules
//                                     (a live audit of every suggested / requested / confirmed pairing)
//   Missing Observation Count         confirmed pairs whose observation did not happen (status "missed")
//   Survey Completion Rate            professors with a completed observation who also submitted the survey / signups
const { CourseSection, EligibilityViolation, EvaluationCycle, Observation, ObserverMatch, Professor, Survey } = require('../models');
const { baselineBefore, dueStatusFor } = require('./dueStatus');
const { departmentOf, evaluateEligibility } = require('./eligibility');
const { cyclePhase } = require('./cycles');
const { now } = require('./clock');
const { getCycleOr404, sectionKey } = require('./lookup');

const rate = (n, d) => (d === 0 ? 0 : Number((n / d).toFixed(4)));
const countBy = (items, fn) => items.reduce((m, x) => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());

/** email -> Date[] of that professor's COMPLETED observation dates, across all terms. */
function completedHistory({ sections, observations }) {
  const sectionByKey = new Map(sections.map((s) => [sectionKey(s), s]));
  const history = new Map();
  for (const o of observations) {
    if (o.status !== 'completed' || !o.observation_date) continue;
    const section = sectionByKey.get(sectionKey(o));
    if (!section) continue;
    const email = o.observee_email || section.instructor_email;
    if (!history.has(email)) history.set(email, []);
    history.get(email).push(new Date(o.observation_date));
  }
  return history;
}

/** email -> due-status result for `term`, judged from each professor's last evaluation BEFORE that term. */
function dueStatuses({ professors, sections, observations, term }) {
  const history = completedHistory({ sections, observations });
  const result = new Map();
  for (const p of professors) {
    const baseline = baselineBefore(p, history.get(p.email) || [], term);
    result.set(p.email, dueStatusFor(p, baseline, term));
  }
  return result;
}

function computeDashboard({ term, cycle, professors, sections, observations, matches, surveys, violations, at = now() }) {
  const profByEmail = new Map(professors.map((p) => [p.email, p]));
  const sectionByKey = new Map(sections.map((s) => [sectionKey(s), s]));
  const termSections = sections.filter((s) => s.term === term);
  const termSectionKeys = new Set(termSections.map(sectionKey));
  const termObs = observations.filter((o) => termSectionKeys.has(sectionKey(o)));
  const termMatches = matches.filter((m) => termSectionKeys.has(sectionKey(m)));
  const termSurveys = surveys.filter((s) => s.term === term);
  const termViolations = violations.filter((v) => v.term === term);
  const observeeOf = (o) => o.observee_email || sectionByKey.get(sectionKey(o)).instructor_email;

  const due = dueStatuses({ professors, sections, observations, term });
  const completedEmails = new Set(termObs.filter((o) => o.status === 'completed').map(observeeOf));
  const signedUpEmails = new Set(termObs.map(observeeOf));

  // --- faculty due, by hire level -------------------------------------------------------------
  const dueRows = [];
  for (const p of professors) {
    const status = due.get(p.email).status;
    if (status === 'due' || status === 'overdue') dueRows.push({ hireLevel: p.hire_level, status });
  }
  const facultyDue = [...countBy(dueRows, (r) => `${r.hireLevel}|${r.status}`)]
    .map(([k, count]) => { const [hireLevel, status] = k.split('|'); return { hireLevel, status, count }; })
    .sort((a, b) => a.hireLevel.localeCompare(b.hireLevel) || a.status.localeCompare(b.status));

  // --- overdue ---------------------------------------------------------------------------------
  const overdueAtStart = professors.filter((p) => due.get(p.email).status === 'overdue');
  const overdueNow = overdueAtStart.filter((p) => !completedEmails.has(p.email));

  // --- eligibility audit -----------------------------------------------------------------------
  const sectionsByInstructor = new Map();
  for (const s of termSections) {
    if (!sectionsByInstructor.has(s.instructor_email)) sectionsByInstructor.set(s.instructor_email, []);
    sectionsByInstructor.get(s.instructor_email).push(s);
  }
  const obsBySection = new Map(termObs.map((o) => [sectionKey(o), o]));
  const auditViolations = new Map();
  let audited = 0;
  let passed = 0;
  for (const m of termMatches) {
    const section = sectionByKey.get(sectionKey(m));
    const obs = obsBySection.get(sectionKey(m));
    const observee = obs ? profByEmail.get(observeeOf(obs)) : null;
    const candidate = profByEmail.get(m.observer_email);
    if (!section || !observee || !candidate) continue;
    audited += 1;
    const verdict = evaluateEligibility({ observee, candidate, section, candidateSections: sectionsByInstructor.get(candidate.email) || [] });
    if (verdict.eligible) passed += 1;
    else auditViolations.set(verdict.violation, (auditViolations.get(verdict.violation) || 0) + 1);
  }

  // --- unmatched / not signed up ---------------------------------------------------------------
  const noObservers = termObs.filter((o) => o.status === 'unmatched').map((o) => {
    const p = profByEmail.get(observeeOf(o));
    return { sectionId: sectionKey(o), email: p.email, name: p.name, hireLevel: p.hire_level };
  });
  const dueButNotSignedUp = professors
    .filter((p) => ['due', 'overdue'].includes(due.get(p.email).status) && !signedUpEmails.has(p.email))
    .map((p) => ({ email: p.email, name: p.name, hireLevel: p.hire_level, status: due.get(p.email).status }))
    .sort((a, b) => a.hireLevel.localeCompare(b.hireLevel) || a.name.localeCompare(b.name));

  // --- outstanding observations ----------------------------------------------------------------
  const outstanding = [...countBy(termObs.filter((o) => o.status !== 'completed'), (o) => `${profByEmail.get(observeeOf(o)).hire_level}|${o.status}`)]
    .map(([k, count]) => { const [hireLevel, status] = k.split('|'); return { hireLevel, status, count }; })
    .sort((a, b) => a.hireLevel.localeCompare(b.hireLevel) || a.status.localeCompare(b.status));
  const missing = termObs.filter((o) => o.status === 'missed').length;

  // --- participation ---------------------------------------------------------------------------
  const dueEmails = professors.filter((p) => ['due', 'overdue'].includes(due.get(p.email).status)).map((p) => p.email);
  const dueOrCompleted = new Set([...dueEmails, ...completedEmails]);
  const observers = new Set(termObs.filter((o) => o.observer_email).map((o) => o.observer_email));
  const matchCountBySection = countBy(termMatches, (m) => sectionKey(m));
  const selectionRan = termObs.filter((o) => o.status === 'unmatched' || (matchCountBySection.get(sectionKey(o)) || 0) > 0);
  const sufficient = selectionRan.filter((o) => o.status !== 'unmatched');
  const avgMatches = termObs.length ? Number((termObs.reduce((n, o) => n + (matchCountBySection.get(sectionKey(o)) || 0), 0) / termObs.length).toFixed(2)) : 0;

  // --- survey completion -----------------------------------------------------------------------
  const surveyed = termSurveys.filter((s) => completedEmails.has(s.professor_email));

  return {
    term,
    phase: cycle ? cyclePhase(cycle, at) : null,
    asOf: at.toISOString(),
    facultyDueForEvaluation: { total: dueRows.length, breakdown: facultyDue },
    overdueEvaluations: { overdueAtCycleStart: overdueAtStart.length, overdueEvaluationCount: overdueNow.length },
    eligibility: {
      evaluationEligibilityAccuracy: audited === 0 ? 1 : rate(passed, audited),
      pairingsAudited: audited,
      pairingsPassing: passed,
      byViolationType: [...auditViolations].map(([violation, count]) => ({ violation, count })).sort((a, b) => b.count - a.count),
      requestsRejectedForViolations: termViolations.length,
    },
    unmatchedFaculty: { noOrInsufficientObservers: noObservers, dueButNotSignedUp },
    outstandingObservations: { byHireLevel: outstanding, missingObservationCount: missing },
    participation: {
      signups: termObs.length,
      dueOrCompleted: dueOrCompleted.size,
      assessmentParticipationRate: rate(termObs.length, dueOrCompleted.size),
      observerUtilizationRate: rate(observers.size, termObs.length),
      averageObserverMatchesPerSignup: avgMatches,
      listSufficiencyRate: rate(sufficient.length, selectionRan.length),
    },
    surveyCompletion: { signups: termObs.length, surveyed: surveyed.length, surveyCompletionRate: rate(surveyed.length, termObs.length) },
  };
}

/** Load everything computeDashboard needs from the database. */
async function loadDashboard(term) {
  const cycle = await getCycleOr404(term);
  const [professors, sections, observations, matches, surveys, violations] = await Promise.all([
    Professor.find({}).lean(),
    CourseSection.find({}).lean(),
    Observation.find({}).lean(),
    ObserverMatch.find({}).lean(),
    Survey.find({ term }).lean(),
    EligibilityViolation.find({ term }).lean(),
  ]);
  return computeDashboard({ term, cycle, professors, sections, observations, matches, surveys, violations });
}

/** Due / overdue list for one term (AC "see the list of Professors who are due & overdue this semester"). */
async function loadDueReport(term) {
  await getCycleOr404(term);
  const [professors, sections, observations] = await Promise.all([Professor.find({}).lean(), CourseSection.find({}).lean(), Observation.find({}).lean()]);
  const due = dueStatuses({ professors, sections, observations, term });
  const termSectionKeys = new Set(sections.filter((s) => s.term === term).map(sectionKey));
  const sectionByKey = new Map(sections.map((s) => [sectionKey(s), s]));
  const signed = new Set(observations.filter((o) => termSectionKeys.has(sectionKey(o))).map((o) => o.observee_email || sectionByKey.get(sectionKey(o)).instructor_email));
  const rows = professors
    .map((p) => ({ email: p.email, name: p.name, department: p.department, hireLevel: p.hire_level, ...due.get(p.email), signedUp: signed.has(p.email) }))
    .filter((r) => r.status !== 'not_due')
    .sort((a, b) => a.status.localeCompare(b.status) || a.hireLevel.localeCompare(b.hireLevel) || a.name.localeCompare(b.name));
  return { term, count: rows.length, professors: rows };
}

module.exports = {
  completedHistory,
  dueStatuses,
  computeDashboard,
  loadDashboard,
  loadDueReport,
};
