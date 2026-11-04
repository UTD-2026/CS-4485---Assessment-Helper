const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { EvaluationCycle, Professor } = require("../models");
const {
  ApiError,
  asyncRoute,
  sendData,
  requireObject,
  rejectUnknownFields,
  normalizeTerm,
  sortTermsDescending,
  parseDate,
  ensureDateOrder,
} = require("./apiHelpers");
const { getCompletedEvaluationTerms, getStatusForTerm } = require("./professors");

const router = express.Router();
const CYCLE_FIELDS = ["term", "signup_deadline", "observation_deadline", "feedback_deadline"];
const DEADLINE_FIELDS = ["signup_deadline", "observation_deadline", "feedback_deadline"];
const templatesDirectory = path.join(__dirname, "..", "templates");

function asDateFields(body) {
  return {
    signup_deadline: parseDate(body.signup_deadline, "signup_deadline"),
    observation_deadline: parseDate(body.observation_deadline, "observation_deadline"),
    feedback_deadline: parseDate(body.feedback_deadline, "feedback_deadline"),
  };
}

router.get(
  "/",
  asyncRoute(async (request, response) => {
    const cycles = await EvaluationCycle.find({}).lean();
    cycles.sort(sortTermsDescending);
    return sendData(response, cycles);
  })
);

router.get(
  "/:term/due-professors",
  asyncRoute(async (request, response) => {
    const term = normalizeTerm(request.params.term);
    const cycle = await EvaluationCycle.findOne({ term }).lean();
    if (!cycle) throw new ApiError(404, "Evaluation cycle not found.");

    const [professors, completedTerms] = await Promise.all([
      Professor.find({}).select("-password_hash").lean(),
      getCompletedEvaluationTerms(),
    ]);
    const evaluated = await Promise.all(
      professors.map((professor) => getStatusForTerm(professor, term, completedTerms))
    );
    const dueProfessors = evaluated.filter((entry) => entry.status !== "not_due");
    const breakdown = {};
    for (const entry of dueProfessors) {
      const level = entry.professor.hire_level;
      breakdown[level] ||= { due: 0, overdue: 0 };
      breakdown[level][entry.status] += 1;
    }

    return sendData(response, {
      term,
      count: dueProfessors.length,
      breakdown_by_hire_level: breakdown,
      professors: dueProfessors,
    });
  })
);

router.get(
  "/:term/template",
  asyncRoute(async (request, response) => {
    const term = normalizeTerm(request.params.term);
    if (!(await EvaluationCycle.exists({ term }))) {
      throw new ApiError(404, "Evaluation cycle not found.");
    }

    const templatePath = path.join(templatesDirectory, `${term}.json`);
    let contents;
    try {
      contents = await fs.readFile(templatePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new ApiError(404, `No evaluation template file exists for ${term}.`);
      }
      throw error;
    }

    let template;
    try {
      template = JSON.parse(contents);
    } catch {
      throw new ApiError(500, `The evaluation template file for ${term} is invalid JSON.`);
    }
    return sendData(response, template);
  })
);

router.get(
  "/:term",
  asyncRoute(async (request, response) => {
    const term = normalizeTerm(request.params.term);
    const cycle = await EvaluationCycle.findOne({ term }).lean();
    if (!cycle) throw new ApiError(404, "Evaluation cycle not found.");
    return sendData(response, cycle);
  })
);

router.post(
  "/",
  asyncRoute(async (request, response) => {
    requireObject(request.body);
    rejectUnknownFields(request.body, CYCLE_FIELDS);
    const term = normalizeTerm(request.body.term);
    const dates = asDateFields(request.body);
    ensureDateOrder(dates.signup_deadline, dates.observation_deadline, dates.feedback_deadline);
    const cycle = await EvaluationCycle.create({ term, ...dates });
    return sendData(response, cycle, 201);
  })
);

router.patch(
  "/:term",
  asyncRoute(async (request, response) => {
    const term = normalizeTerm(request.params.term);
    requireObject(request.body);
    rejectUnknownFields(request.body, DEADLINE_FIELDS);
    if (!Object.keys(request.body).length) {
      throw new ApiError(400, "Provide at least one deadline to update.");
    }

    const existing = await EvaluationCycle.findOne({ term }).lean();
    if (!existing) throw new ApiError(404, "Evaluation cycle not found.");
    const dates = {
      signup_deadline: "signup_deadline" in request.body
        ? parseDate(request.body.signup_deadline, "signup_deadline")
        : existing.signup_deadline,
      observation_deadline: "observation_deadline" in request.body
        ? parseDate(request.body.observation_deadline, "observation_deadline")
        : existing.observation_deadline,
      feedback_deadline: "feedback_deadline" in request.body
        ? parseDate(request.body.feedback_deadline, "feedback_deadline")
        : existing.feedback_deadline,
    };
    ensureDateOrder(dates.signup_deadline, dates.observation_deadline, dates.feedback_deadline);

    const cycle = await EvaluationCycle.findOneAndUpdate(
      { term },
      { $set: dates },
      { new: true, runValidators: true }
    ).lean();
    return sendData(response, cycle);
  })
);

module.exports = router;
