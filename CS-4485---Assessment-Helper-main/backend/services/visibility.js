// Who may read the observation REPORT (the filled-in form: its ratings, comments and the signed PDF).
//
// From the committee's Q&A:
//   "Assessment committee will also be able to see after observer and observee signs.
//    Observee sees report after observer signs for them also to sign."
//
//   observer    always (it is their own work, from the first draft)
//   observee    once the OBSERVER has signed (that is when the observee is asked to sign too)
//   committee   once BOTH have signed (the observation is completed)
//
// A person can hold more than one role (a committee member who is also the observee); the most generous one applies.
// Everything else about an observation (its status, date, who is involved) stays visible to participants and the committee;
// only the report content is withheld, and the answer says why, so the frontend can show "Waiting for the observer to sign".

const { loadObservation, sectionKey } = require('./lookup');
const { summarize } = require('./observationRecords');

const REASONS = {
  NOT_A_PARTICIPANT: 'Only the observer, the observee and the Assessment Committee are involved in this observation.',
  AWAITING_OBSERVER_SIGNATURE: 'The report is shared with the observee after the observer has signed it.',
  AWAITING_BOTH_SIGNATURES: 'The report is shared with the Assessment Committee after the observer and the observee have both signed.',
};

const bothSigned = (o) => o.status === 'completed' || Boolean(o.observer_signed_date && o.observee_signed_date);
const observerSigned = (o) => o.status === 'completed' || Boolean(o.observer_signed_date);

/**
 * @param user          the logged-in professor document
 * @param observation   the observation document
 * @param observeeEmail the professor who was observed
 * @returns {{canView:boolean, roles:string[], reason:string|null, message:string|null}}
 */
function reportAccess(user, observation, observeeEmail) {
  const roles = [];
  if (user.email === observation.observer_email) roles.push('observer');
  if (user.email === observeeEmail) roles.push('observee');
  if (user.is_ac_member) roles.push('committee');

  const can = (roles.includes('observer'))
    || (roles.includes('observee') && observerSigned(observation))
    || (roles.includes('committee') && bothSigned(observation));
  if (can) return { canView: true, roles, reason: null, message: null };

  let reason = 'NOT_A_PARTICIPANT';
  if (roles.includes('observee')) reason = 'AWAITING_OBSERVER_SIGNATURE';
  else if (roles.includes('committee')) reason = 'AWAITING_BOTH_SIGNATURES';
  return { canView: false, roles, reason, message: REASONS[reason] };
}

/**
 * The observation as this person may see it. When the report is hidden, `record`, `ratings` and `summary` are removed
 * (nobody learns the scores from the status alone) and `report` explains why. Always adds `report`:
 *   { canView, reason, message, started, observerSigned, observeeSigned }
 */
function viewObservation(user, observation, observeeEmail) {
  // Fields that older rows lack are always present, so a screen can rely on the shape
  observation = {
    observation_time: null, missed_reported_by: null, missed_reason: null, missed_date: null, ...observation,
  };
  const access = reportAccess(user, observation, observeeEmail);
  const report = {
    canView: access.canView,
    reason: access.reason,
    message: access.message,
    started: Boolean(observation.record),
    observerSigned: Boolean(observation.observer_signed_date),
    observeeSigned: Boolean(observation.observee_signed_date),
  };
  if (access.canView) return { ...observation, report };
  const hidden = { ...observation, report };
  delete hidden.record;
  delete hidden.ratings;
  delete hidden.summary;
  return hidden;
}

/** For routes that only hold the observation document: looks up the observee, adds the summary, applies the rule. */
async function presentObservation(user, observation) {
  const { observee } = await loadObservation(sectionKey(observation));
  const withSummary = observation.record ? { ...observation, summary: summarize(observation.record.criteria) } : observation;
  return viewObservation(user, withSummary, observee.email);
}

module.exports = {
  reportAccess, viewObservation, presentObservation, bothSigned, observerSigned,
};
