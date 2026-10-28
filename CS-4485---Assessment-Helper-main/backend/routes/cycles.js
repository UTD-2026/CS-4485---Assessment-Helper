// Assessment Committee workflow, one cycle (= one term) at a time.
//   AC creates the cycle (three deadlines)  ->  reminds the due/overdue professors  ->  professors sign up
//   ->  after the signup deadline the AC runs Observer Selection  ->  tells everyone their list is ready
//   ->  observations happen  ->  AC sends the survey reminder.
const express = require('express');
const {
  CourseSection, EvaluationCycle, Observation, ObserverMatch, Professor, Survey,
} = require('../models');
const { requireAc } = require('../middleware/auth');
const { asyncHandler, badRequest, conflict } = require('../middleware/errors');
const { cyclePhase, currentCycle, describeCycle, sortCycles } = require('../services/cycles');
const { parseIsoDay, toIsoDay } = require('../services/dates');
const { loadDueReport } = require('../services/kpis');
const {
  findForSections, getCycleOr404, observeeEmailOf, onlyInSections, requireTerm, sectionKey,
} = require('../services/lookup');
const { meetingOf } = require('../services/eligibility');
const { audit } = require('../services/audit');
const { loadFacultyEligibility } = require('../services/facultyEligibility');
const { candidateFlag, runObserverSelection } = require('../services/matching');
const { paginate, parsePaging } = require('../services/paging');
const { notifyMany } = require('../services/notifications');
const { loadSignupRows } = require('../services/reports');
const { now } = require('../services/clock');

const router = express.Router();

// API field name -> database column
const DEADLINE_FIELDS = [
  ['signupDeadline', 'signup_deadline'],
  ['observationDeadline', 'observation_deadline'],
  ['feedbackDeadline', 'feedback_deadline'],
];

/** Reads the three deadlines from the request body (YYYY-MM-DD), falling back to the existing cycle. Returns database columns. */
function readDeadlines(body, base = {}) {
  const out = {};
  for (const [field, column] of DEADLINE_FIELDS) {
    const raw = body[field] !== undefined ? body[field] : (base[column] ? toIsoDay(base[column]) : undefined);
    const day = parseIsoDay(raw);
    if (!day) throw badRequest(`${field} must be a real date written YYYY-MM-DD.`);
    out[column] = day;
  }
  if (!(out.signup_deadline < out.observation_deadline && out.observation_deadline < out.feedback_deadline)) {
    throw badRequest('Deadlines must be in order: signupDeadline < observationDeadline < feedbackDeadline.');
  }
  return out;
}

/** GET /api/cycles -> every cycle (oldest first) with its current phase */
router.get('/', asyncHandler(async (req, res) => {
  const cycles = sortCycles(await EvaluationCycle.find({}).lean());
  res.json({ cycles: cycles.map((c) => describeCycle(c)) });
}));

/** GET /api/cycles/current -> the cycle people are working in right now */
router.get('/current', asyncHandler(async (req, res) => {
  res.json({ cycle: describeCycle(await currentCycle()) });
}));

router.get('/:term', asyncHandler(async (req, res) => {
  res.json({ cycle: describeCycle(await getCycleOr404(requireTerm(req.params.term))) });
}));

/** POST /api/cycles  (AC)  { term, signupDeadline, observationDeadline, feedbackDeadline }  dates as YYYY-MM-DD */
router.post('/', requireAc, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const term = requireTerm(body.term);
  const deadlines = readDeadlines(body);
  const already = () => conflict(`A cycle for ${term} already exists. Use PUT /api/cycles/${encodeURIComponent(term)} to change its deadlines.`);
  if (await EvaluationCycle.exists({ term })) throw already(); // the unique index below is the backstop for a race
  try {
    const created = await EvaluationCycle.create({ term, ...deadlines });
    await audit(req.user, 'cycle.created', { type: 'cycle', id: term, term });
    res.status(201).json({ cycle: describeCycle(created.toObject ? created.toObject() : created) });
  } catch (err) {
    if (err && err.code === 11000) throw already();
    throw err;
  }
}));

/** PUT /api/cycles/:term  (AC)  change any of the three deadlines (e.g. extend signup) */
router.put('/:term', requireAc, asyncHandler(async (req, res) => {
  const term = requireTerm(req.params.term);
  const existing = await getCycleOr404(term);
  const deadlines = readDeadlines(req.body || {}, existing);
  const updated = await EvaluationCycle.findOneAndUpdate({ term }, { $set: deadlines }, { returnDocument: 'after' }).lean();
  await audit(req.user, 'cycle.updated', { type: 'cycle', id: term, term, detail: Object.fromEntries(Object.entries(deadlines).map(([k, v]) => [k, toIsoDay(v)])) });
  res.json({ cycle: describeCycle(updated) });
}));

/**
 * GET /api/cycles/:term/eligible-faculty (AC)
 *   ?status=due,overdue (default; also not_due)  &department=CS  &hireLevel=assistant  &signedUp=true|false  &q=name  &page=1&pageSize=25
 * Who is due or overdue for an observation this cycle, each with the reason in words, whether they can sign up right now
 * (and what blocks them if not), and the rule version. Paged.
 */
router.get('/:term/eligible-faculty', requireAc, asyncHandler(async (req, res) => {
  const term = requireTerm(req.params.term);
  const statuses = String(req.query.status || 'due,overdue').split(',').map((x) => x.trim()).filter(Boolean);
  if (!statuses.length || statuses.some((x) => !['due', 'overdue', 'not_due'].includes(x))) throw badRequest('status must be a comma-separated list of due, overdue, not_due.');
  if (req.query.signedUp !== undefined && !['true', 'false'].includes(req.query.signedUp)) throw badRequest('signedUp must be true or false.');
  const paging = parsePaging(req.query);
  const { rows, phase, ruleVersion } = await loadFacultyEligibility(term);
  const needle = req.query.q ? String(req.query.q).toLowerCase() : null;
  const filtered = rows
    .filter((r) => statuses.includes(r.status)
      && (!req.query.department || r.department === req.query.department)
      && (!req.query.hireLevel || r.hireLevel === req.query.hireLevel)
      && (req.query.signedUp === undefined || r.signedUp === (req.query.signedUp === 'true'))
      && (!needle || `${r.name} ${r.email}`.toLowerCase().includes(needle)))
    .sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
  const { items, pagination } = paginate(filtered, paging);
  res.json({ term, phase, ruleVersion, faculty: items, pagination });
}));

/** GET /api/cycles/:term/due-report (AC) -> everyone due or overdue this term, with whether they have signed up */
router.get('/:term/due-report', requireAc, asyncHandler(async (req, res) => {
  res.json(await loadDueReport(requireTerm(req.params.term)));
}));

/**
 * POST /api/cycles/:term/send-due-reminders (AC)  { "reminderType": "DUE_REMINDER" | "OVERDUE_REMINDER" }
 * Notifies the professors in that group who have not signed up yet.
 */
router.post('/:term/send-due-reminders', requireAc, asyncHandler(async (req, res) => {
  const term = requireTerm(req.params.term);
  const cycle = await getCycleOr404(term);
  const { reminderType } = req.body || {};
  if (!['DUE_REMINDER', 'OVERDUE_REMINDER'].includes(reminderType)) throw badRequest("reminderType must be 'DUE_REMINDER' or 'OVERDUE_REMINDER'.");
  const report = await loadDueReport(term);
  const wanted = reminderType === 'DUE_REMINDER' ? 'due' : 'overdue';
  const recipients = report.professors.filter((p) => p.status === wanted && !p.signedUp).map((p) => p.email);
  const message = `You are ${wanted} for a peer teaching observation in ${term}. Please sign up by ${toIsoDay(cycle.signup_deadline)}.`;
  await notifyMany(recipients, { type: reminderType, message, term });
  res.json({ term, reminderType, notified: recipients.length });
}));

/** GET /api/cycles/:term/signups (AC) -> every signup: course #, section #, meeting days/time, observee name + email, status */
router.get('/:term/signups', requireAc, asyncHandler(async (req, res) => {
  const term = requireTerm(req.params.term);
  await getCycleOr404(term);
  const signups = await loadSignupRows(term);
  res.json({ term, count: signups.length, signups });
}));


/**
 * POST /api/cycles/:term/run-observer-selection (AC)   [optionally { "force": true } to run before the signup deadline]
 * "After signup deadline is over, AC should be able to click a button to do Observer Selection."
 * For each open signup: fewer than 5 eligible observers -> all of them; 5 or more -> a random 5; none -> "unmatched".
 */
router.post('/:term/run-observer-selection', requireAc, asyncHandler(async (req, res) => {
  const term = requireTerm(req.params.term);
  const cycle = await getCycleOr404(term);
  if (cyclePhase(cycle) === 'SIGNUP' && !(req.body && req.body.force === true)) {
    throw conflict(`Signups are still open until ${toIsoDay(cycle.signup_deadline)}. Send { "force": true } to run observer selection anyway.`, { code: 'SIGNUP_STILL_OPEN' });
  }
  const summary = await runObserverSelection(term);
  await audit(req.user, 'selection.run', { type: 'cycle', id: term, term, detail: { processed: summary.processed, unmatched: summary.unmatched, insufficient: summary.insufficient } });
  res.json(summary);
}));

/**
 * GET /api/cycles/:term/insufficient-observers (AC) -> the alert list: signups where nobody was eligible (flag NO_ELIGIBLE_OBSERVER).
 * Add ?includeFew=true to also list signups with fewer than 5 eligible observers (flag INSUFFICIENT_OBSERVERS).
 */
router.get('/:term/insufficient-observers', requireAc, asyncHandler(async (req, res) => {
  const term = requireTerm(req.params.term);
  await getCycleOr404(term);
  const sections = await CourseSection.find({ term }).lean();
  const includeFew = req.query.includeFew === 'true';
  const all = onlyInSections(await Observation.find({ term }).lean(), sections);
  const alerts = all
    .map((o) => ({ o, flag: o.status === 'unmatched' ? 'NO_ELIGIBLE_OBSERVER' : (typeof o.eligible_count === 'number' ? candidateFlag(o.eligible_count) : 'OK') }))
    .filter(({ flag }) => flag === 'NO_ELIGIBLE_OBSERVER' || (includeFew && flag === 'INSUFFICIENT_OBSERVERS'));
  const people = await Professor.find({}).lean();
  res.json({
    term,
    count: alerts.length,
    signups: alerts.map(({ o, flag }) => {
      const section = sections.find((s) => sectionKey(s) === sectionKey(o));
      const p = people.find((x) => x.email === observeeEmailOf(o, section));
      return {
        sectionId: sectionKey(o), flag, eligibleCount: typeof o.eligible_count === 'number' ? o.eligible_count : 0, observeeEmail: p.email, observeeName: p.name, hireLevel: p.hire_level, courseCode: section.course_code, ...meetingOf(section),
      };
    }),
  });
}));

/** POST /api/cycles/:term/notify-observer-lists-ready (AC) -> tells each observee their list is ready (once each) */
router.post('/:term/notify-observer-lists-ready', requireAc, asyncHandler(async (req, res) => {
  const term = requireTerm(req.params.term);
  await getCycleOr404(term);
  const sections = await CourseSection.find({ term }).lean();
  const open = onlyInSections(await Observation.find({ term, status: 'signed_up', list_notified_date: null }).lean(), sections);
  const withList = new Set((await findForSections(ObserverMatch, open, { status: 'suggested' })).map(sectionKey));
  const observations = open.filter((o) => withList.has(sectionKey(o)));
  let notified = 0;
  for (const o of observations) {
    const section = sections.find((s) => sectionKey(s) === sectionKey(o));
    const email = observeeEmailOf(o, section);
    // Only the caller that flips list_notified_date from null sends the message, so a double click cannot notify twice.
    const result = await Observation.updateOne(
      {
        course_code: o.course_code, section_number: o.section_number, term: o.term, list_notified_date: null,
      },
      { $set: { list_notified_date: now() } }
    );
    if (result.modifiedCount === 1) {
      await notifyMany([email], { type: 'OBSERVER_LIST_READY', message: `Your list of possible observers for ${section.course_code} is ready. Choose who to ask.`, section });
      notified += 1;
    }
  }
  res.json({ term, notified });
}));

/** POST /api/cycles/:term/notify-survey (AC) -> asks everyone with a completed observation who has not answered to take the survey */
router.post('/:term/notify-survey', requireAc, asyncHandler(async (req, res) => {
  const term = requireTerm(req.params.term);
  const cycle = await getCycleOr404(term);
  const sections = await CourseSection.find({ term }).lean();
  const completed = onlyInSections(await Observation.find({ term, status: 'completed' }).lean(), sections);
  const answered = new Set((await Survey.find({ term }).lean()).map((s) => s.professor_email));
  const recipients = completed
    .map((o) => observeeEmailOf(o, sections.find((s) => sectionKey(s) === sectionKey(o))))
    .filter((email) => !answered.has(email));
  await notifyMany(recipients, { type: 'SURVEY_REMINDER', message: `Please take the ${term} end-of-process survey by ${toIsoDay(cycle.feedback_deadline)}.`, term });
  res.json({ term, notified: recipients.length });
}));

module.exports = router;
