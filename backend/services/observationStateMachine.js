// Observation status guard. The idea (an adjacency list of legal transitions, checked
// independently of the HTTP layer, 409 on an illegal move) comes from the add-backend
// branch's observationStateMachine.js; the statuses are the ones the Mongo seed data uses.
const { conflict, badRequest } = require("../middleware/errors");

const OBSERVATION_STATUSES = [
  "signed_up", // signed up; observer list not chosen yet
  "unmatched", // list generated but no eligible observers
  "matched", // final observer selected; date not set
  "scheduled", // date set
  "awaiting_confirmation", // one of the pair confirmed it happened
  "completed", // both confirmed
  "missed", // reported as not held
  "deferred", // could not complete this cycle (rolled over)
];

const ALLOWED = {
  signed_up: ["unmatched", "matched", "deferred"],
  unmatched: ["signed_up", "matched", "deferred"],
  matched: ["scheduled", "missed", "deferred"],
  scheduled: ["scheduled", "awaiting_confirmation", "completed", "missed", "deferred"],
  awaiting_confirmation: ["completed", "missed", "deferred"],
  missed: ["scheduled", "deferred"],
  completed: [],
  deferred: [],
};

function assertTransition(from, to) {
  if (!OBSERVATION_STATUSES.includes(to)) throw badRequest(`Unknown status "${to}".`);
  if (!(ALLOWED[from] || []).includes(to)) throw conflict(`Cannot change an observation from "${from}" to "${to}".`);
}

const MATCH_STATUSES = ["suggested", "requested", "accepted", "declined", "confirmed", "cancelled"];

module.exports = { OBSERVATION_STATUSES, ALLOWED, assertTransition, MATCH_STATUSES };
