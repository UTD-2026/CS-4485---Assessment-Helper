// 5. Observer Matches (list + respond). The observation-scoped match routes live in routes/observations.js.
const express = require("express");
const { ObserverMatch, Observation } = require("../models");
const { isAc, requireAc } = require("../middleware/auth");
const { badRequest, conflict, forbidden, notFound } = require("../middleware/errors");
const { keyFilter, loadTermContext, resolveTerm, observeeOf, sectionKey } = require("../services/context");
const { candidatesFor } = require("../services/matching");
const { presentMatch, flagFor } = require("../services/presenters");
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

// POST /api/observer-matches/generate  Body: { term?, dry_run? }  (committee)
// From main ("Generate / Top Up Observer Lists"): builds or tops up the list for every sign-up in the
// term that is still waiting for an observer. Open requests are never touched; unanswered suggestions
// are rebuilt from the current rules; sign-ups with nobody eligible become "unmatched".
// dry_run: true previews the result without saving anything.
router.post("/generate", requireAc, async (req, res) => {
  if (req.body?.dry_run !== undefined && typeof req.body.dry_run !== "boolean") throw badRequest("dry_run must be a boolean.");
  const term = await resolveTerm(req.body?.term);
  const dryRun = req.body?.dry_run === true;
  const { generateList } = require("./observations"); // required here: routes/observations.js loads this file's siblings
  const ctx = await loadTermContext(term);
  if (!ctx.cycle) throw notFound(`There is no evaluation cycle for ${term}.`);

  const waiting = await Observation.find({ term, observer_email: null, status: { $in: ["signed_up", "unmatched"] } });
  const results = [];
  for (const observation of waiting) {
    let flag;
    let listSize;
    if (dryRun) {
      const kept = ctx.matches.filter((m) => sectionKey(m) === sectionKey(observation) && m.status !== "suggested");
      const open = kept.filter((m) => ["requested", "accepted"].includes(m.status)).length;
      const preview = candidatesFor(ctx, observation, { exclude: new Set(kept.map((m) => m.observer_email)) });
      listSize = open + preview.candidates.length;
      flag = flagFor(listSize);
    } else {
      const fresh = await loadTermContext(term); // each list changes the workload counts for the next
      const result = await generateList(observation, fresh);
      flag = result.flag;
      listSize = (await ObserverMatch.countDocuments({ ...keyFilter(observation), status: { $in: ["suggested", "requested", "accepted"] } }));
    }
    results.push({ course_code: observation.course_code, section_number: observation.section_number, term, flag, list_size: listSize });
  }
  const count = (f) => results.filter((r) => r.flag === f).length;
  res.status(dryRun ? 200 : 201).json({
    data: results,
    meta: { term, dry_run: dryRun, processed: results.length, ok: count("OK"), insufficient: count("INSUFFICIENT_OBSERVERS"), none: count("NO_ELIGIBLE_OBSERVER") },
  });
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
