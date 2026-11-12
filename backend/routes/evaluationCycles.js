// 3. Evaluation Cycles
const express = require("express");
const { EvaluationCycle } = require("../models");
const { requireAc } = require("../middleware/auth");
const { badRequest, conflict, notFound } = require("../middleware/errors");
const { isValidTerm } = require("../services/terms");
const { getTemplate, saveTemplate, copyLatestTemplate } = require("../services/templates");
const { notify } = require("../services/notifications");

const router = express.Router();
const { getCycles, getCurrentTerm, loadTermContext, presentProfessor, toISODate, observeeOf, deadlineClosesAt } = require("../services/context");
const DEADLINES = ["signup_deadline", "observation_deadline", "feedback_deadline"];
// Each deadline has an optional close time ("HH:MM", 24-hour). null = closes at 11:59 PM on its date.
const TIMES = DEADLINES.map((f) => `${f}_time`);

const presentCycle = (c) => ({
  term: c.term,
  signup_deadline: toISODate(c.signup_deadline),
  signup_deadline_time: c.signup_deadline_time || null,
  observation_deadline: toISODate(c.observation_deadline),
  observation_deadline_time: c.observation_deadline_time || null,
  feedback_deadline: toISODate(c.feedback_deadline),
  feedback_deadline_time: c.feedback_deadline_time || null,
});

// "2026-11-13" + "17:00" -> "2026-11-13 at 17:00"; no time -> "2026-11-13"
const withTime = (date, time) => (time ? `${date} at ${time}` : date);

function readDeadlines(body, partial) {
  const out = {};
  for (const f of DEADLINES) {
    if (body?.[f] === undefined) {
      if (!partial) throw badRequest(`Missing required field: ${f}.`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body[f]))) throw badRequest(`${f} must be a date (YYYY-MM-DD).`);
    out[f] = new Date(`${body[f]}T00:00:00.000Z`);
  }
  // Optional close times ("HH:MM", 24-hour). null or "" = close at 11:59 PM.
  for (const f of TIMES) {
    if (body?.[f] === undefined) continue;
    const t = body[f];
    if (t === null || t === "") out[f] = null;
    else if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t))) out[f] = String(t);
    else throw badRequest(`${f} must be a time (HH:MM, 24-hour) or null.`);
  }
  // Ordering uses the full closing moment, so two deadlines on the same day are compared by time.
  const at = (f) => (out[f] ? deadlineClosesAt(out[f], out[`${f}_time`]) : null);
  const s = at("signup_deadline"), o = at("observation_deadline"), fb = at("feedback_deadline");
  if (s && o && s > o) throw badRequest("The signup deadline must be on or before the observation deadline.");
  if (o && fb && o > fb) throw badRequest("The observation deadline must be on or before the feedback deadline.");
  return out;
}

// GET /api/evaluation-cycles  (meta.current_term = the term the app is working in)
router.get("/", async (req, res) => {
  const cycles = await getCycles();
  res.json({ data: cycles.map(presentCycle), meta: { current_term: await getCurrentTerm(cycles) } });
});

// GET /api/evaluation-cycles/:term
router.get("/:term", async (req, res) => {
  const cycle = await EvaluationCycle.findOne({ term: req.params.term }).lean();
  if (!cycle) throw notFound("Evaluation cycle not found.");
  res.json({ data: presentCycle(cycle) });
});

// POST /api/evaluation-cycles  (committee)
router.post("/", requireAc, async (req, res) => {
  const term = String(req.body?.term || "").trim();
  if (!isValidTerm(term)) throw badRequest('term is required, e.g. "Spring 2027".');
  if (await EvaluationCycle.exists({ term })) throw conflict(`An evaluation cycle for ${term} already exists.`);
  const cycle = await EvaluationCycle.create({ term, ...readDeadlines(req.body, false) });
  await copyLatestTemplate(term, (await getCycles()).map((c) => c.term)); // from main: start from the last term's form
  res.status(201).json({ data: presentCycle(cycle.toObject()) });
});

// PATCH /api/evaluation-cycles/:term  (committee: update deadlines; professors in the cycle are notified)
router.patch("/:term", requireAc, async (req, res) => {
  const cycle = await EvaluationCycle.findOne({ term: req.params.term });
  if (!cycle) throw notFound("Evaluation cycle not found.");
  const updates = readDeadlines(req.body, true);
  if (!Object.keys(updates).length) throw badRequest(`Nothing to update. Allowed fields: ${[...DEADLINES, ...TIMES].join(", ")}.`);
  Object.assign(cycle, updates);
  readDeadlines(presentCycle(cycle.toObject()), false); // re-check ordering with the merged values
  await cycle.save();

  const ctx = await loadTermContext(cycle.term);
  const participants = new Set();
  for (const o of ctx.observations) {
    participants.add(observeeOf(ctx, o));
    if (o.observer_email) participants.add(o.observer_email);
  }
  const c = presentCycle(cycle.toObject());
  await notify([...participants], `Deadlines updated for ${cycle.term}: sign-up ${withTime(c.signup_deadline, c.signup_deadline_time)}, observations ${withTime(c.observation_deadline, c.observation_deadline_time)}, survey ${withTime(c.feedback_deadline, c.feedback_deadline_time)}.`, "deadline");
  res.json({ data: c });
});

// GET /api/evaluation-cycles/:term/due-professors
router.get("/:term/due-professors", async (req, res) => {
  if (!isValidTerm(req.params.term)) throw badRequest(`Invalid term "${req.params.term}".`);
  const ctx = await loadTermContext(req.params.term);
  const signedUp = new Set(ctx.observations.map((o) => observeeOf(ctx, o)));
  const list = ctx.professors
    .map((p) => ({ ...presentProfessor(p, ctx.due.get(p.email)), signed_up: signedUp.has(p.email) }))
    .filter((p) => p.evaluation_status.status !== "not_due")
    .sort((a, b) => b.evaluation_status.overdue_by - a.evaluation_status.overdue_by || a.name.localeCompare(b.name));
  // count + breakdown_by_hire_level: from main
  const breakdown = {};
  for (const p of list) {
    breakdown[p.hire_level] ||= { due: 0, overdue: 0 };
    breakdown[p.hire_level][p.evaluation_status.status] += 1;
  }
  res.json({ data: list, meta: {
    term: req.params.term,
    count: list.length,
    due: list.filter((p) => p.evaluation_status.status === "due").length,
    overdue: list.filter((p) => p.evaluation_status.status === "overdue").length,
    breakdown_by_hire_level: breakdown,
  } });
});

// GET /api/evaluation-cycles/:term/template  (reads backend/templates/<term>.json)
router.get("/:term/template", async (req, res) => {
  if (!isValidTerm(req.params.term)) throw badRequest(`Invalid term "${req.params.term}".`);
  res.json({ data: await getTemplate(req.params.term) });
});

// PUT /api/evaluation-cycles/:term/template  (committee)
// EXTENSION: not in the endpoint doc (which manages templates by hand as JSON files). Added so the
// front end's Template Editor can write that same per-term JSON file instead of only changing browser state.
router.put("/:term/template", requireAc, async (req, res) => {
  if (!isValidTerm(req.params.term)) throw badRequest(`Invalid term "${req.params.term}".`);
  res.json({ data: await saveTemplate(req.params.term, req.body?.criteria, req.user.email) });
});

module.exports = router;
