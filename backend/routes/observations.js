// 4. Observations  +  the observation-scoped routes of 5. Observer Matches
//
// An observation is identified by its course section: /api/observations/:course_code/:section_number/:term
// (URL-encode the spaces: /api/observations/CS%202117/001/Fall%202026).
const express = require("express");
const { env } = require("../config/env");
const { CourseSection, Observation, ObserverMatch, Professor } = require("../models");
const { isAc, requireAc } = require("../middleware/auth");
const { badRequest, conflict, forbidden, notFound } = require("../middleware/errors");
const {
  sectionKey, keyFilter, loadTermContext, resolveTerm, observeeOf, isSignupClosed, isObservationPeriodOver, todayISO, toISODate,
} = require("../services/context");
const { presentObservation, presentMatch, nameOf, flagFor } = require("../services/presenters");
const { candidatesFor, violationsFor } = require("../services/matching");
const { RULES } = require("../matching/matchmaker");
const { assertTransition } = require("../services/observationStateMachine");
const { isMeetingDay, meetingOf, toMinutes, clockText, to12h, formatTiming } = require("../services/eligibility");
const { getTemplate } = require("../services/templates");
const { notify, notifyCommittee } = require("../services/notifications");

const router = express.Router();
const KEY = "/:course_code/:section_number/:term";
const label = (o) => `${o.course_code}, ${o.term}`;

/** Loads the observation in the URL plus the term context; works out the caller's role. */
async function load(req) {
  const filter = keyFilter(req.params);
  const observation = await Observation.findOne(filter);
  if (!observation) throw notFound("Observation not found.");
  const ctx = await loadTermContext(filter.term);
  const observee = observeeOf(ctx, observation);
  const role = {
    observee: req.user.email === observee,
    observer: Boolean(observation.observer_email) && req.user.email === observation.observer_email,
    ac: isAc(req),
  };
  return { observation, ctx, observee, role };
}

async function respond(res, observation, req, status = 200, meta) {
  const ctx = await loadTermContext(observation.term);
  res.status(status).json({ data: presentObservation(observation.toObject(), ctx, req.user), ...(meta ? { meta } : {}) });
}

/** Generates (or regenerates) the suggested observer list for one observation. */
async function generateList(observation, ctx) {
  // Replace earlier suggestions that were never acted on; keep anything already requested/answered.
  await ObserverMatch.deleteMany({ ...keyFilter(observation), status: "suggested" });
  const kept = await ObserverMatch.find(keyFilter(observation)).lean();
  const existing = new Set(kept.map((m) => m.observer_email));
  const stillOpen = kept.filter((m) => ["requested", "accepted"].includes(m.status)).length;
  const room = Math.max(0, env.maxObserversPerList - stillOpen);
  const result = candidatesFor(ctx, observation, { exclude: existing });
  const fresh = result.candidates.slice(0, room);
  if (fresh.length) {
    await ObserverMatch.insertMany(fresh.map((c) => ({ ...keyFilter(observation), observer_email: c.email, status: "suggested" })));
  }
  const listSize = stillOpen + fresh.length;
  observation.match_flag = flagFor(listSize);
  observation.list_generated_date = new Date();
  if (!observation.observer_email) observation.status = listSize ? "signed_up" : "unmatched";
  await observation.save();
  return { ...result, flag: observation.match_flag, eligibleCount: result.eligibleCount + stillOpen };
}

// ---------------------------------------------------------------- GET /api/observations
// Filters: term, observee_email, observer_email, status. Professors only see observations they are part of.
router.get("/", async (req, res) => {
  const term = req.query.term ? await resolveTerm(req.query.term) : null;
  const ctx = await loadTermContext(term);
  let list = ctx.observations;
  const observeeEmail = req.query.observee_email && String(req.query.observee_email).toLowerCase();
  const observerEmail = req.query.observer_email && String(req.query.observer_email).toLowerCase();
  if (observeeEmail) list = list.filter((o) => observeeOf(ctx, o) === observeeEmail);
  if (observerEmail) list = list.filter((o) => o.observer_email === observerEmail);
  if (req.query.status) {
    const statuses = String(req.query.status).split(",");
    list = list.filter((o) => statuses.includes(o.status));
  }
  if (!isAc(req)) list = list.filter((o) => o.observer_email === req.user.email || observeeOf(ctx, o) === req.user.email);
  res.json({ data: list.map((o) => presentObservation(o, ctx, req.user)) });
});

// ---------------------------------------------------------------- GET one
router.get(KEY, async (req, res) => {
  const { observation, ctx, role } = await load(req);
  if (!role.ac && !role.observee && !role.observer) throw forbidden();
  res.json({ data: presentObservation(observation.toObject(), ctx, req.user) });
});

// ---------------------------------------------------------------- POST (course sign-up)
// Body: { course_code, section_number, term? (default: current term) }
// The professor signs up one of their own sections; the observer list is generated right away.
router.post("/", async (req, res) => {
  const term = await resolveTerm(req.body?.term);
  const { course_code, section_number } = req.body || {};
  if (!course_code || !section_number) throw badRequest("course_code and section_number are required.");
  const section = await CourseSection.findOne({ course_code, section_number, term }).lean();
  if (!section) throw notFound(`Course section not found: ${course_code} ${section_number} (${term}).`);
  if (section.instructor_email !== req.user.email && !isAc(req)) throw forbidden("You can only sign up a section you teach.");

  const ctx = await loadTermContext(term);
  if (!ctx.cycle) throw badRequest(`There is no evaluation cycle for ${term}.`);
  if (isSignupClosed(ctx.cycle) && !isAc(req)) {
    const at = ctx.cycle.signup_deadline_time ? ` at ${ctx.cycle.signup_deadline_time}` : "";
    throw conflict(`Sign-up for ${term} closed on ${toISODate(ctx.cycle.signup_deadline)}${at}.`);
  }
  if (await Observation.exists({ course_code, section_number, term })) throw conflict("This section is already signed up.");
  if (ctx.observations.some((o) => observeeOf(ctx, o) === section.instructor_email)) {
    throw conflict(`${nameOf(ctx, section.instructor_email)} is already signed up for ${term}.`);
  }

  const observation = await Observation.create({ course_code, section_number, term, status: "signed_up", signup_date: new Date() });
  const fresh = await loadTermContext(term);
  await generateList(observation, fresh);
  await respond(res, observation, req, 201);
});

// ---------------------------------------------------------------- PATCH (schedule)
// Body: { observation_date: "YYYY-MM-DD", observation_time?: "8:30 AM" | "08:30" }  (observee or committee)
router.patch(KEY, async (req, res) => {
  const { observation, ctx, observee, role } = await load(req);
  if (!role.observee && !role.ac) throw forbidden("Only the observee can schedule the observation.");
  const date = String(req.body?.observation_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("observation_date (YYYY-MM-DD) is required.");
  if (!observation.observer_email) throw conflict("Select an observer before scheduling.");

  const section = ctx.sectionByKey.get(sectionKey(observation));
  const meeting = meetingOf(section?.timing);
  if (!isMeetingDay(date, section?.timing)) throw badRequest(`${date} is not a day this class meets (${section?.timing}).`);
  if (date < todayISO()) throw badRequest("The observation date cannot be in the past.");
  if (ctx.cycle && date > toISODate(ctx.cycle.observation_deadline)) {
    throw badRequest(`The observation date must be on or before the observation deadline (${toISODate(ctx.cycle.observation_deadline)}).`);
  }
  let time = meeting.start === null ? null : clockText(meeting.start);
  if (req.body?.observation_time) {
    const asked = toMinutes(String(req.body.observation_time).split("-")[0].trim());
    if (asked === null || (meeting.start !== null && asked !== meeting.start)) {
      throw badRequest(`The observation time must be the class start time (${time}).`);
    }
  }

  assertTransition(observation.status, "scheduled");
  observation.observation_date = new Date(`${date}T00:00:00.000Z`);
  observation.observation_time = time;
  observation.status = "scheduled";
  await observation.save();

  const observeeName = nameOf(ctx, observee);
  const observerName = nameOf(ctx, observation.observer_email);
  const when = `${date} at ${to12h(time)} during class (${formatTiming(section?.timing)})`;
  await notify(observee, `Meeting Set: Your observation with ${observerName} is scheduled for ${when}.`, "schedule");
  await notify(observation.observer_email, `Meeting Set: You are scheduled to observe ${observeeName} on ${when}.`, "schedule");
  await respond(res, observation, req);
});

// ---------------------------------------------------------------- PATCH .../status
// Body: { status, reason? }
//   observee/observer: status "deferred" + reason  (could not complete this cycle; committee is notified)
//   committee: any legal transition
router.patch(`${KEY}/status`, async (req, res) => {
  const { observation, ctx, observee, role } = await load(req);
  const to = String(req.body?.status || "");
  const reason = String(req.body?.reason || "").trim();
  if (!role.ac) {
    if (!role.observee && !role.observer) throw forbidden();
    if (to !== "deferred") throw forbidden("Participants can only report that the observation could not be completed (status \"deferred\").");
  }
  if (to === "deferred" && !reason) throw badRequest("Please give a reason why the observation could not be completed.");
  assertTransition(observation.status, to);
  observation.status = to;
  if (to === "deferred") {
    observation.deferral_reason = reason;
    observation.deferred_by = req.user.email;
    const whose = role.observee ? "their observation" : `the observation of ${nameOf(ctx, observee)}`;
    await notifyCommittee(`Observation Deferred: ${req.user.name} reported that ${whose} (${label(observation)}) could not be completed this cycle. Reason: "${reason}"`);
  }
  await observation.save();
  await respond(res, observation, req);
});

// ---------------------------------------------------------------- PATCH .../form
// Body (any combination):
//   { ratings: {[criterionId]: {rating, notes}}, draft: true }   observer saves progress ("Save & Return")
//   { ratings, submit: true }                                    observer submits the evaluation
//   { observer_signed: true }                                    observer: "Evaluation Completed"
//   { observee_signed: true }                                    observee: "I Was Observed"
// When both have signed, the observation is completed and the observee's last_observed is updated.
router.patch(`${KEY}/form`, async (req, res) => {
  const { observation, ctx, observee, role } = await load(req);
  const body = req.body || {};
  const past = ctx.cycle && isObservationPeriodOver(ctx.cycle);
  const active = ["scheduled", "awaiting_confirmation"].includes(observation.status);
  const observeeName = nameOf(ctx, observee);

  if (body.ratings !== undefined || body.submit) {
    if (!role.observer) throw forbidden("Only the assigned observer can fill in the evaluation.");
    if (!active) throw conflict("The evaluation can only be filled in once the observation is scheduled.");
    if (observation.evaluation_submitted_date) throw conflict("The evaluation was already submitted.");
    if (body.ratings !== null && typeof body.ratings !== "object") throw badRequest("ratings must be an object.");
    if (body.submit) {
      if (past) throw conflict("The observation deadline has passed.");
      const template = await getTemplate(observation.term);
      const items = Array.isArray(body.items) && body.items.length ? body.items : template.criteria;
      const missing = items.filter((c) => {
        const a = body.ratings?.[c.id] || {};
        return !String(a.notes || "").trim() || (!String(c.ratingScale).includes("Text") && !a.rating);
      });
      if (missing.length) throw badRequest(`Please answer every criterion (${missing.length} incomplete).`);
      observation.ratings = body.ratings;
      observation.evaluation_items = items.map(({ id, criteria, ratingScale }) => ({ id, criteria, ratingScale }));
      observation.evaluation_submitted_date = new Date();
      observation.evaluation_draft = null;
      observation.evaluation_draft_saved = null;
      await notify(req.user.email, `Evaluation Submitted: Your evaluation of ${observeeName} (${observation.course_code}) was submitted successfully. You can view it under My Evaluations.`, "evaluation");
      await notify(observee, `Evaluation Received: ${req.user.name} submitted the evaluation for your ${observation.course_code} class. You can view it under My Evaluations.`, "evaluation");
    } else if (body.draft) {
      observation.evaluation_draft = body.ratings || {};
      observation.evaluation_draft_saved = new Date();
    } else {
      throw badRequest('Send "draft": true to save progress or "submit": true to submit.');
    }
  }

  if (body.observer_signed) {
    if (!role.observer) throw forbidden("Only the assigned observer can confirm as observer.");
    if (!active) throw conflict("Only a scheduled observation can be confirmed.");
    if (!observation.evaluation_submitted_date) throw conflict("Please submit the evaluation form before marking the evaluation as completed.");
    if (past) throw conflict("The observation deadline has passed.");
    observation.observer_signed_date = observation.observer_signed_date || new Date();
  }
  if (body.observee_signed) {
    if (!role.observee) throw forbidden("Only the observee can confirm they were observed.");
    if (!active) throw conflict("Only a scheduled observation can be confirmed.");
    observation.observee_signed_date = observation.observee_signed_date || new Date();
  }
  if (body.observer_signed || body.observee_signed) {
    if (observation.observer_signed_date && observation.observee_signed_date) {
      observation.status = "completed";
      await Professor.updateOne({ email: observee }, { $set: { last_observed: observation.observation_date || new Date() } });
      await notify([observee, observation.observer_email], "Observation Completed: Both parties successfully confirmed the observation!", "completed");
    } else {
      observation.status = "awaiting_confirmation";
    }
  }
  observation.markModified("ratings");
  observation.markModified("evaluation_draft");
  await observation.save();
  await respond(res, observation, req);
});

// ---------------------------------------------------------------- PATCH .../missed
// Body: { reason? }  (observer, observee or committee)
router.patch(`${KEY}/missed`, async (req, res) => {
  const { observation, ctx, observee, role } = await load(req);
  if (!role.observee && !role.observer && !role.ac) throw forbidden();
  assertTransition(observation.status, "missed");
  observation.status = "missed";
  observation.missed_reason = String(req.body?.reason || "").trim() || null;
  observation.missed_reported_by = req.user.email;
  observation.missed_date = new Date();
  await observation.save();
  const other = role.observer ? observee : observation.observer_email;
  await notify(other, `Observation Not Held: ${req.user.name} reported that the observation for ${label(observation)} did not take place.`, "missed");
  const whose = role.observee ? "their observation" : `the observation of ${nameOf(ctx, observee)}`;
  await notifyCommittee(`Missed Observation: ${req.user.name} reported that ${whose} (${label(observation)}) did not take place.`);
  await respond(res, observation, req);
});

// ================================================================ 5. Observer Matches (observation-scoped)

// POST .../generate-observer-list  (committee)
router.post(`${KEY}/generate-observer-list`, requireAc, async (req, res) => {
  const { observation, ctx } = await load(req);
  if (observation.observer_email) throw conflict("An observer has already been selected for this observation.");
  const result = await generateList(observation, ctx);
  const fresh = await loadTermContext(observation.term);
  const matches = fresh.matches.filter((m) => sectionKey(m) === sectionKey(observation)).map((m) => presentMatch(m, fresh));
  res.status(201).json({ data: { observation: presentObservation(observation.toObject(), fresh, req.user), candidates: matches, eligible_count: result.eligibleCount, flag: result.flag } });
});

// POST .../release-observer-list  (committee)
router.post(`${KEY}/release-observer-list`, requireAc, async (req, res) => {
  const { observation, ctx, observee } = await load(req);
  const count = ctx.matches.filter((m) => sectionKey(m) === sectionKey(observation)).length;
  if (!count) throw conflict("There are no candidates to release. Generate the list or assign an observer manually.");
  observation.list_released_date = observation.list_released_date || new Date();
  await observation.save();
  await notify(observee, `Action Required: The Assessment Committee has released your list of potential observers for ${observation.course_code}. You may now send requests.`, "list");
  await respond(res, observation, req);
});

// POST .../observer-requests  (observee)  Body: { observer_emails: [...] } or { observer_email }
router.post(`${KEY}/observer-requests`, async (req, res) => {
  const { observation, ctx, role } = await load(req);
  if (!role.observee) throw forbidden("Only the observee can send observer requests.");
  if (observation.observer_email) throw conflict("An observer has already been selected.");
  const listReleased = Boolean(observation.list_released_date) || ctx.matches.some((m) => sectionKey(m) === sectionKey(observation) && m.status !== "suggested");
  if (!listReleased) throw conflict("The committee has not released your observer list yet.");
  const emails = [].concat(req.body?.observer_emails || req.body?.observer_email || []).map((e) => String(e).toLowerCase());
  if (!emails.length) throw badRequest("observer_emails is required.");

  const updated = [];
  for (const email of emails) {
    const match = await ObserverMatch.findOne({ ...keyFilter(observation), observer_email: email });
    if (!match) throw badRequest(`${email} is not on your observer list.`);
    if (match.status !== "suggested") throw conflict(`A request to ${nameOf(ctx, email)} was already sent (${match.status}).`);
    match.status = "requested";
    match.requested_date = new Date();
    await match.save();
    updated.push(match.toObject());
    await notify(email, `${req.user.name} sent you a request to observe ${observation.course_code}.`, "request");
  }
  const fresh = await loadTermContext(observation.term);
  res.status(201).json({ data: updated.map((m) => presentMatch(m, fresh)) });
});

// POST .../select-observer  Body: { observer_email }
//   observee: picks one observer who accepted; the other requests are cancelled
//   committee: manual assignment (any eligible-or-not colleague) when the list is insufficient
router.post(`${KEY}/select-observer`, async (req, res) => {
  const { observation, ctx, observee, role } = await load(req);
  if (!role.observee && !role.ac) throw forbidden();
  if (observation.observer_email) throw conflict("An observer has already been selected.");
  const email = String(req.body?.observer_email || "").toLowerCase();
  if (!email) throw badRequest("observer_email is required.");
  if (email === observee) throw badRequest("A professor cannot observe themself.");
  if (!ctx.profByEmail.has(email)) throw badRequest(`Professor not found: ${email}`);

  let match = await ObserverMatch.findOne({ ...keyFilter(observation), observer_email: email });
  const manual = !role.observee || !match || match.status !== "accepted";
  if (manual && !role.ac) throw conflict("You can only select an observer who accepted your request.");
  if (!match) match = new ObserverMatch({ ...keyFilter(observation), observer_email: email, requested_date: new Date() });
  match.status = "confirmed";
  match.responded_date = match.responded_date || new Date();
  await match.save();

  const others = await ObserverMatch.find({ ...keyFilter(observation), observer_email: { $ne: email }, status: { $in: ["suggested", "requested", "accepted"] } });
  for (const other of others) {
    if (other.status === "accepted") {
      await notify(other.observer_email, `${nameOf(ctx, observee)} finalized their observer match. Your offer to observe ${observation.course_code} was respectfully declined. Thank you for volunteering!`, "request");
    }
    other.status = "cancelled";
    await other.save();
  }

  assertTransition(observation.status, "matched");
  observation.observer_email = email;
  observation.status = "matched";
  observation.selected_manually = manual;
  if (manual) observation.match_flag = "OK";
  await observation.save();

  // Committee overrides may break the matching rules; tell the committee which ones (from main's /assign).
  const warnings = manual ? violationsFor(ctx, observation, email).map((code) => ({ code, label: RULES[code] })) : [];

  if (manual) {
    await notify(email, `System Assignment: You have been manually assigned by the Committee to observe ${nameOf(ctx, observee)} (${observation.course_code}).`, "assignment");
    await notify(observee, `System Update: The Committee has manually assigned ${nameOf(ctx, email)} as your observer for ${observation.course_code}. Head to 'Observee Status' to schedule the date.`, "assignment");
  } else {
    await notify(email, `${req.user.name} confirmed you as their official observer for ${observation.course_code}! They will set a specific date soon.`, "assignment");
  }
  await respond(res, observation, req, 200, manual ? { warnings } : undefined);
});

module.exports = router;
module.exports.generateList = generateList;
