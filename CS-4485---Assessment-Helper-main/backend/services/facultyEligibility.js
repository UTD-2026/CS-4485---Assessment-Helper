// "Who is eligible to be evaluated this cycle, and why?"  (TA feedback: eligibility status/reason, due/overdue status, rule version.)
//
// Two different questions share the word "eligible" in this project, so the names are kept apart:
//   * eligible FACULTY   (this file)       is this professor due, or overdue, for an observation in this cycle?
//   * eligible OBSERVERS (services/eligibility.js)  may this colleague observe that professor? (the four matching rules)
const { EVALUATION_RULES, RULE_VERSION } = require('../config/rules');
const { env } = require('../config/env');
const { CourseSection, Observation, Professor } = require('../models');
const { cyclePhase } = require('./cycles');
const { dueStatuses } = require('./kpis');
const { findForSections, getCycleOr404, observeeEmailOf, sectionKey } = require('./lookup');

const LABEL = { assistant: 'Assistant', associate: 'Associate', full: 'Full' };
const labelOf = (professor) => LABEL[professor.hire_level] || professor.hire_level;

/** One sentence the committee can read: what rule applied and why this answer came out. */
function explain(professor, due, term) {
  const rule = EVALUATION_RULES[professor.hire_level];
  const cadence = rule && rule.yearsBetween === 1 ? 'every year' : `every ${rule ? rule.yearsBetween : '?'} years`;
  const head = `${labelOf(professor)} professor: observed ${cadence}.`;
  if (!due.baselineTerm) return `${head} No completed observation is on record, so ${professor.name} is overdue.`;
  const window = due.dueWindow.join(' and ');
  if (due.status === 'due') return `${head} Last observed ${due.baselineTerm}; due in ${window}, which includes ${term}.`;
  if (due.status === 'overdue') return `${head} Last observed ${due.baselineTerm}; the due window (${window}) has passed, so the observation is overdue.`;
  return `${head} Last observed ${due.baselineTerm}; next due ${due.anniversary}.`;
}

/** Everything eligibility needs for one term, loaded once. */
async function loadFacultyEligibility(term) {
  const cycle = await getCycleOr404(term);
  const [professors, sections, observations] = await Promise.all([Professor.find({}).lean(), CourseSection.find({}).lean(), Observation.find({}).lean()]);
  const due = dueStatuses({ professors, sections, observations, term });
  const termSections = sections.filter((s) => s.term === term);
  const termObs = (await findForSections(Observation, termSections));
  const sectionByKey = new Map(termSections.map((s) => [sectionKey(s), s]));
  const signedUp = new Set(termObs.map((o) => observeeEmailOf(o, sectionByKey.get(sectionKey(o)))));
  const taught = new Map();
  for (const s of termSections) taught.set(s.instructor_email, (taught.get(s.instructor_email) || 0) + 1);
  const phase = cyclePhase(cycle);

  const rows = professors.map((p) => {
    const d = due.get(p.email);
    const blockers = [];
    if (!taught.has(p.email)) blockers.push('NO_SECTIONS_THIS_TERM');
    if (signedUp.has(p.email)) blockers.push('ALREADY_SIGNED_UP');
    if (env.enforceSignupDeadline && phase !== 'SIGNUP') blockers.push('SIGNUP_CLOSED');
    return {
      email: p.email,
      name: p.name,
      department: p.department,
      hireLevel: p.hire_level,
      hireLevelLabel: labelOf(p),
      status: d.status,
      eligibleForCycle: d.status !== 'not_due',
      reason: explain(p, d, term),
      baselineTerm: d.baselineTerm,
      anniversary: d.anniversary,
      dueWindow: d.dueWindow,
      sectionsThisTerm: taught.get(p.email) || 0,
      signedUp: signedUp.has(p.email),
      canSignUp: blockers.length === 0,
      blockers,
      ruleVersion: RULE_VERSION,
    };
  });
  return { term, phase, ruleVersion: RULE_VERSION, rows };
}

module.exports = { explain, loadFacultyEligibility, labelOf };
