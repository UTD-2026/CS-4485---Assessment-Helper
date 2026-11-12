const express = require("express");
const { Professor, EvaluationCycle, Survey } = require("../models");
const {
  ApiError,
  asyncRoute,
  sendData,
  requireObject,
  rejectUnknownFields,
  normalizeEmail,
  normalizeTerm,
  requireString,
} = require("./apiHelpers");

const router = express.Router();

// Demo mode has no authenticated session yet, so the UI supplies the selected
// database professor's email. This route must be protected by auth before release.
router.get("/status", asyncRoute(async (request, response) => {
  const email = normalizeEmail(request.query.professor_email, "professor_email");
  const term = normalizeTerm(request.query.term);
  if (!(await Professor.exists({ email }))) throw new ApiError(404, "Professor not found.");
  return sendData(response, { submitted: Boolean(await Survey.exists({ professor_email: email, term })) });
}));

router.post("/", asyncRoute(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ["professor_email", "term", "process_ok", "difficulties", "improvements", "has_attachment"]);
  const professor_email = normalizeEmail(request.body.professor_email, "professor_email");
  const term = normalizeTerm(request.body.term);
  if (!(await Professor.exists({ email: professor_email }))) throw new ApiError(404, "Professor not found.");
  const cycle = await EvaluationCycle.findOne({ term }).lean();
  if (!cycle) throw new ApiError(404, "Evaluation cycle not found.");
  const deadline = new Date(cycle.feedback_deadline);
  deadline.setUTCHours(23, 59, 59, 999);
  if (new Date() > deadline) throw new ApiError(409, "The survey deadline has passed.");
  if (typeof request.body.process_ok !== "boolean") throw new ApiError(400, "process_ok must be a boolean.");
  if (typeof request.body.has_attachment !== "boolean") throw new ApiError(400, "has_attachment must be a boolean.");
  const difficulties = requireString(request.body.difficulties ?? "", "difficulties", { allowEmpty: true });
  const improvements = requireString(request.body.improvements ?? "", "improvements", { allowEmpty: true });

  // Identity is retained only to enforce one submission and report completion.
  // Reporting responses below never returns this email.
  const survey = await Survey.create({
    professor_email,
    term,
    process_rating: request.body.process_ok ? 5 : 1,
    positive_feedback: improvements,
    negative_feedback: difficulties,
    uploaded_file: request.body.has_attachment ? "provided" : null,
    submitted_date: new Date(),
  });
  return sendData(response, { submitted: true, submitted_date: survey.submitted_date }, 201);
}));

router.get("/responses", asyncRoute(async (request, response) => {
  const filter = {};
  if (request.query.term !== undefined) filter.term = normalizeTerm(request.query.term);
  const surveys = await Survey.find(filter)
    .select("-professor_email -_id -__v")
    .sort({ submitted_date: 1 })
    .lean();
  return sendData(response, surveys.map((survey, index) => ({
    response_id: `anonymous-${index + 1}`,
    process_ok: survey.process_rating >= 3,
    difficulties: survey.negative_feedback || "",
    improvements: survey.positive_feedback || "",
    has_attachment: Boolean(survey.uploaded_file),
    submitted_date: survey.submitted_date,
  })));
}));

module.exports = router;
