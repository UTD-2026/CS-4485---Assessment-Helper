// Turns raw documents into API responses: joins names/timing in and hides what the caller may not see.
const { env } = require("../config/env");
const { sectionKey, toISODate, observeeOf } = require("./context");

const nameOf = (ctx, email) => ctx.profByEmail.get(email)?.name || email || null;

/**
 * Ratings/evaluation visibility: the observer, the observee and the committee.
 * The saved draft is only returned to the observer who wrote it.
 */
function presentObservation(o, ctx, user) {
  const observee = observeeOf(ctx, o);
  const section = ctx.sectionByKey.get(sectionKey(o));
  const isObserver = user && o.observer_email === user.email;
  const isObservee = user && observee === user.email;
  const canSeeEvaluation = Boolean(user && (user.is_ac_member || isObserver || isObservee));
  const termMatches = ctx.matches.filter((m) => sectionKey(m) === sectionKey(o));
  const listed = termMatches; // the generated candidate list (whatever happened to each request since)

  const { __v, _id, evaluation_draft, evaluation_draft_saved, ratings, evaluation_items, ...rest } = o;
  return {
    ...rest,
    id: sectionKey(o),
    observee_email: observee,
    observee_name: nameOf(ctx, observee),
    observee_department: ctx.profByEmail.get(observee)?.department || null,
    observee_hire_level: ctx.profByEmail.get(observee)?.hire_level || null,
    observer_name: o.observer_email ? nameOf(ctx, o.observer_email) : null,
    timing: section?.timing || null,
    signup_date: toISODate(o.signup_date),
    observation_date: toISODate(o.observation_date),
    observer_signed_date: toISODate(o.observer_signed_date),
    observee_signed_date: toISODate(o.observee_signed_date),
    evaluation_submitted_date: toISODate(o.evaluation_submitted_date),
    // Seed data has no flag; derive it from the candidate list size.
    match_flag: o.match_flag || (listed.length ? flagFor(listed.length) : null),
    candidate_count: listed.length,
    list_released: Boolean(o.list_released_date) || termMatches.some((m) => ["requested", "accepted", "confirmed"].includes(m.status)),
    has_evaluation: Boolean(ratings),
    ratings: canSeeEvaluation ? ratings : undefined,
    evaluation_items: canSeeEvaluation ? evaluation_items : undefined,
    evaluation_draft: isObserver ? evaluation_draft : undefined,
    evaluation_draft_saved: isObserver ? evaluation_draft_saved : undefined,
  };
}

function presentMatch(m, ctx) {
  const observee = observeeOf(ctx, m);
  const section = ctx.sectionByKey.get(sectionKey(m));
  const { __v, _id, ...rest } = m;
  return {
    ...rest,
    id: `${sectionKey(m)}|${m.observer_email}`,
    observation_id: sectionKey(m),
    observee_email: observee,
    observee_name: nameOf(ctx, observee),
    observer_name: nameOf(ctx, m.observer_email),
    observer_department: ctx.profByEmail.get(m.observer_email)?.department || null,
    timing: section?.timing || null,
    requested_date: toISODate(m.requested_date),
    responded_date: toISODate(m.responded_date),
  };
}

function flagFor(count, target = env.maxObserversPerList) {
  if (count === 0) return "NO_ELIGIBLE_OBSERVER";
  return count < target ? "INSUFFICIENT_OBSERVERS" : "OK";
}

module.exports = { presentObservation, presentMatch, flagFor, nameOf };
