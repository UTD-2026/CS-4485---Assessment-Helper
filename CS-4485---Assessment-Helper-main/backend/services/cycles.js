// Cycle helpers: which cycle is "current", and which phase of the process it is in.
//
// A cycle has three deadlines. The phase is simply where "now" falls between them:
//   SIGNUP            until signup_deadline        professors sign up
//   OBSERVATION       until observation_deadline   observers are requested, confirmed, observations happen and are signed
//   FEEDBACK          until feedback_deadline      the end-of-process survey is open
//   CLOSED            after feedbackDeadline
// (This replaces the earlier hand-advanced stage; nobody has to remember to click "advance".)
const { EvaluationCycle } = require('../models');
const { notFound } = require('../middleware/errors');
const { endOfDeadlineDay } = require('./dates');
const { now } = require('./clock');
const { termOrdinal } = require('./terms');

function cyclePhase(cycle, at = now()) {
  if (at <= endOfDeadlineDay(cycle.signup_deadline)) return 'SIGNUP';
  if (at <= endOfDeadlineDay(cycle.observation_deadline)) return 'OBSERVATION';
  if (at <= endOfDeadlineDay(cycle.feedback_deadline)) return 'FEEDBACK';
  return 'CLOSED';
}

const sortCycles = (cycles) => cycles.slice().sort((a, b) => termOrdinal(a.term) - termOrdinal(b.term));

/**
 * The cycle people are working in right now: the earliest cycle whose feedback deadline has not yet passed
 * (so a newly created next-term cycle does not take over until the current one is finished); if every cycle
 * is over, the most recent one.
 */
async function currentCycle(at = now()) {
  const cycles = sortCycles(await EvaluationCycle.find({}).lean());
  if (!cycles.length) throw notFound('No evaluation cycles exist yet. An Assessment Committee member must create one (POST /api/cycles).');
  return cycles.find((c) => at <= endOfDeadlineDay(c.feedback_deadline)) || cycles[cycles.length - 1];
}

const describeCycle = (cycle, at = now()) => ({ ...cycle, phase: cyclePhase(cycle, at) });

module.exports = {
  cyclePhase,
  currentCycle,
  sortCycles,
  describeCycle,
};
