// 6. Surveys (anonymous)
const express = require("express");
const { createHash } = require("node:crypto");
const { Survey } = require("../models");
const { isAc, requireAc } = require("../middleware/auth");
const { conflict, forbidden } = require("../middleware/errors");
const { loadTermContext, resolveTerm, isPastDeadline, toISODate, observeeOf } = require("../services/context");
const { notify } = require("../services/notifications");

const router = express.Router();

/** Who is expected to take the survey this term: everyone who signed up. */
async function surveyContext(term) {
  const ctx = await loadTermContext(term);
  const expected = new Set(ctx.observations.map((o) => observeeOf(ctx, o)).filter(Boolean));
  return { ctx, expected };
}

// GET /api/surveys/status?term=
// The signed-in professor's status. Committee members can add ?all=true to get WHO submitted
// (emails only, never answers) for the Survey Completion KPI.
router.get("/status", async (req, res) => {
  const term = await resolveTerm(req.query.term);
  const { ctx, expected } = await surveyContext(term);
  const submitted = await Survey.exists({ professor_email: req.user.email, term });
  const closed = ctx.cycle ? isPastDeadline(ctx.cycle.feedback_deadline) : false;
  const data = {
    term,
    deadline: ctx.cycle ? toISODate(ctx.cycle.feedback_deadline) : null,
    eligible: expected.has(req.user.email),
    submitted: Boolean(submitted),
    closed,
    can_submit: !submitted && !closed,
  };
  if (req.query.all === "true") {
    if (!isAc(req)) throw forbidden();
    const rows = await Survey.find({ term }).select("professor_email").lean();
    data.submitted_by = rows.map((r) => r.professor_email);
    data.expected_count = expected.size;
  }
  res.json({ data });
});

// POST /api/surveys   Body: { term?, process_ok, difficulties, improvements, has_attachment }
router.post("/", async (req, res) => {
  const term = await resolveTerm(req.body?.term);
  const { ctx } = await surveyContext(term);
  if (ctx.cycle && isPastDeadline(ctx.cycle.feedback_deadline)) {
    throw conflict(`The survey deadline (${toISODate(ctx.cycle.feedback_deadline)}) has passed.`);
  }
  if (await Survey.exists({ professor_email: req.user.email, term })) throw conflict("You already submitted the survey for this term.");
  const b = req.body || {};
  await Survey.create({
    professor_email: req.user.email,
    term,
    process_ok: b.process_ok === undefined ? null : Boolean(b.process_ok),
    difficulties: String(b.difficulties || "").slice(0, 5000),
    improvements: String(b.improvements || "").slice(0, 5000),
    has_attachment: Boolean(b.has_attachment),
    submitted_date: new Date(),
  });
  // Only a receipt comes back; answers cannot be read back by the submitter.
  res.status(201).json({ data: { term, submitted: true } });
});

// GET /api/surveys/responses?term=  (committee)
// Answers only: a stable random-looking response_id, no email, no date. Sorted by response_id so
// the order does not reveal who submitted when.
router.get("/responses", requireAc, async (req, res) => {
  const term = await resolveTerm(req.query.term);
  const { expected } = await surveyContext(term);
  const rows = await Survey.find({ term }).lean();
  const responses = rows.map((s) => ({
    response_id: createHash("sha256").update(String(s._id)).digest("hex").slice(0, 16),
    process_ok: s.process_ok ?? (s.process_rating == null ? null : s.process_rating >= 3),
    process_rating: s.process_rating,
    difficulties: s.difficulties || s.negative_feedback || "",
    improvements: s.improvements || "",
    positive_feedback: s.positive_feedback || "",
    has_attachment: Boolean(s.has_attachment || s.uploaded_file),
  })).sort((a, b) => a.response_id.localeCompare(b.response_id));
  res.json({ data: responses, meta: { term, submitted_count: rows.length, expected_count: expected.size } });
});

// POST /api/surveys/reminders  Body: { term? }  (committee)
// EXTENSION: not in the endpoint doc. Backs the committee's "Request End-of-Process Surveys" button:
// notifies everyone who signed up this term and has not submitted yet.
router.post("/reminders", requireAc, async (req, res) => {
  const term = await resolveTerm(req.body?.term);
  const { expected } = await surveyContext(term);
  const done = new Set((await Survey.find({ term }).select("professor_email").lean()).map((r) => r.professor_email));
  const recipients = [...expected].filter((e) => !done.has(e));
  await notify(recipients, "Action Required: The observation period has officially ended. Please complete your end-of-process feedback survey.", "survey");
  res.status(201).json({ data: { term, notified: recipients.length } });
});

module.exports = router;
