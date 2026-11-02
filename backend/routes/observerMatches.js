// 5. Observer Matches (list + respond). The observation-scoped match routes live in routes/observations.js.
const express = require("express");
const { ObserverMatch, Observation } = require("../models");
const { isAc } = require("../middleware/auth");
const { badRequest, conflict, forbidden, notFound } = require("../middleware/errors");
const { keyFilter, loadTermContext, resolveTerm, observeeOf } = require("../services/context");
const { presentMatch } = require("../services/presenters");
const { notify } = require("../services/notifications");

const router = express.Router();

// GET /api/observer-matches?term=&observer_email=&status=  (+ observee_email)
// Professors only see matches where they are the observer or the observee.
router.get("/", async (req, res) => {
  const term = req.query.term ? await resolveTerm(req.query.term) : null;
  const ctx = await loadTermContext(term);
  let list = ctx.matches;
  if (req.query.observer_email) list = list.filter((m) => m.observer_email === String(req.query.observer_email).toLowerCase());
  if (req.query.observee_email) list = list.filter((m) => observeeOf(ctx, m) === String(req.query.observee_email).toLowerCase());
  if (req.query.status) {
    const statuses = String(req.query.status).split(",");
    list = list.filter((m) => statuses.includes(m.status));
  }
  if (!isAc(req)) {
    // Observers do not see lists that have not been sent to them yet.
    list = list.filter((m) => observeeOf(ctx, m) === req.user.email || (m.observer_email === req.user.email && m.status !== "suggested"));
  }
  res.json({ data: list.map((m) => presentMatch(m, ctx)) });
});

// PATCH /api/observer-matches/:course_code/:section_number/:term/:observer_email/response
// Body: { response: "accept" | "decline" }   (the requested observer)
router.patch("/:course_code/:section_number/:term/:observer_email/response", async (req, res) => {
  const filter = { ...keyFilter(req.params), observer_email: req.params.observer_email.toLowerCase() };
  if (req.user.email !== filter.observer_email) throw forbidden("Only the requested observer can respond.");
  const answer = String(req.body?.response || req.body?.status || "").toLowerCase();
  const status = { accept: "accepted", accepted: "accepted", decline: "declined", declined: "declined" }[answer];
  if (!status) throw badRequest('response must be "accept" or "decline".');

  const match = await ObserverMatch.findOne(filter);
  if (!match) throw notFound("Observer request not found.");
  if (match.status !== "requested") throw conflict(`This request is already ${match.status}.`);
  const observation = await Observation.findOne(keyFilter(req.params)).lean();
  if (observation?.observer_email) throw conflict("The observee already selected an observer.");

  match.status = status;
  match.responded_date = new Date();
  await match.save();

  const ctx = await loadTermContext(filter.term);
  const observee = observeeOf(ctx, match);
  await notify(observee, `${req.user.name} has ${status} your request to observe ${match.course_code}.`, "request");
  res.json({ data: presentMatch(match.toObject(), ctx) });
});

module.exports = router;
