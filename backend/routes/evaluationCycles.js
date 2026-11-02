// 3. Evaluation Cycles
const express = require("express");
const { EvaluationCycle } = require("../models");
const { requireAc } = require("../middleware/auth");
const { badRequest, conflict, notFound } = require("../middleware/errors");
const { getCycles, getCurrentTerm, loadTermContext, presentProfessor, toISODate, observeeOf } = require("../services/context");
const { isValidTerm } = require("../services/terms");
const { getTemplate, saveTemplate } = require("../services/templates");
const { notify } = require("../services/notifications");

const router = express.Router();
const DEADLINES = ["signup_deadline", "observation_deadline", "feedback_deadline"];

const presentCycle = (c) => ({
  term: c.term,
  signup_deadline: toISODate(c.signup_deadline),
  observation_deadline: toISODate(c.observation_deadline),
  feedback_deadline: toISODate(c.feedback_deadline),
});

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
  const s = out.signup_deadline, o = out.observation_deadline, fb = out.feedback_deadline;
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
  res.status(201).json({ data: presentCycle(cycle.toObject()) });
});

// PATCH /api/evaluation-cycles/:term  (committee: update deadlines; professors in the cycle are notified)
router.patch("/:term", requireAc, async (req, res) => {
  const cycle = await EvaluationCycle.findOne({ term: req.params.term });
  if (!cycle) throw notFound("Evaluation cycle not found.");
  const updates = readDeadlines(req.body, true);
  if (!Object.keys(updates).length) throw badRequest(`Nothing to update. Allowed fields: ${DEADLINES.join(", ")}.`);
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
  await notify([...participants], `Deadlines updated for ${cycle.term}: sign-up ${c.signup_deadline}, observations ${c.observation_deadline}, survey ${c.feedback_deadline}.`, "deadline");
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
  res.json({ data: list, meta: { term: req.params.term, due: list.filter((p) => p.evaluation_status.status === "due").length, overdue: list.filter((p) => p.evaluation_status.status === "overdue").length } });
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
