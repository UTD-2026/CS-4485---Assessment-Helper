const express = require("express");
const {
  Professor,
  CourseSection,
  EvaluationCycle,
  Observation,
} = require("../models");
const {
  ApiError,
  asyncRoute,
  sendData,
  requireObject,
  rejectUnknownFields,
  normalizeEmail,
  termIndex,
  sortTermsDescending,
} = require("./apiHelpers");

const router = express.Router();
const PROFESSOR_PATCH_FIELDS = [
  "name",
  "department",
  "hire_level",
  "last_observed",
  "is_ac_member",
];

async function getCompletedEvaluationTerms() {
  const completed = await Observation.find({ status: /^completed$/i })
    .select("course_code section_number term observation_date")
    .lean();
  const sections = await CourseSection.find({})
    .select("course_code section_number term instructor_email")
    .lean();

  const instructorBySection = new Map(
    sections.map((section) => [
      `${section.course_code}|${section.section_number}|${section.term}`,
      section.instructor_email.toLowerCase(),
    ])
  );
  const latestTermByProfessor = new Map();

  for (const observation of completed) {
    const key = `${observation.course_code}|${observation.section_number}|${observation.term}`;
    const email = instructorBySection.get(key);
    if (!email) continue;

    const current = latestTermByProfessor.get(email);
    if (!current || termIndex(observation.term) > termIndex(current)) {
      latestTermByProfessor.set(email, observation.term);
    }
  }

  return latestTermByProfessor;
}

function fallbackTermFromLastObserved(lastObserved) {
  if (!lastObserved) return null;
  const date = new Date(lastObserved);
  if (Number.isNaN(date.getTime())) return null;
  const season = date.getUTCMonth() < 6 ? "Spring" : "Fall";
  return `${season} ${date.getUTCFullYear()}`;
}

function evaluationInterval(hireLevel) {
  return hireLevel.toLowerCase() === "assistant" ? 2 : 4;
}

function formatTerm(index) {
  const year = Math.floor(index / 2);
  const season = index % 2 === 0 ? "Spring" : "Fall";
  return `${season} ${year}`;
}

function makeEvaluationStatus(professor, evaluatedTerm, assessedTerm) {
  const assessedIndex = termIndex(assessedTerm);
  const evaluatedIndex = evaluatedTerm ? termIndex(evaluatedTerm) : null;
  const dueIndex = evaluatedIndex === null
    ? assessedIndex
    : evaluatedIndex + evaluationInterval(professor.hire_level);
  const semestersOverdue = Math.max(0, assessedIndex - dueIndex);
  const status = dueIndex < assessedIndex
    ? "overdue"
    : dueIndex === assessedIndex
      ? "due"
      : "not_due";

  return {
    professor: {
      email: professor.email,
      name: professor.name,
      department: professor.department,
      hire_level: professor.hire_level,
      last_observed: professor.last_observed,
      is_ac_member: professor.is_ac_member,
    },
    assessed_term: assessedTerm,
    last_evaluation_term: evaluatedTerm,
    next_due_term: formatTerm(dueIndex),
    status,
    semesters_overdue: semestersOverdue,
  };
}

async function getStatusForTerm(professor, term, completedTerms) {
  const evaluatedTerm = completedTerms.get(professor.email.toLowerCase()) ||
    fallbackTermFromLastObserved(professor.last_observed);
  return makeEvaluationStatus(professor, evaluatedTerm, term);
}

router.get(
  "/",
  asyncRoute(async (request, response) => {
    const professors = await Professor.find({})
      .select("-password_hash")
      .sort({ name: 1 })
      .lean();
    return sendData(response, professors);
  })
);

router.get(
  "/:email/evaluation-status",
  asyncRoute(async (request, response) => {
    const email = normalizeEmail(request.params.email);
    const professor = await Professor.findOne({ email }).select("-password_hash").lean();
    if (!professor) throw new ApiError(404, "Professor not found.");

    const cycles = await EvaluationCycle.find({}).select("term").lean();
    cycles.sort(sortTermsDescending);
    if (!cycles.length) throw new ApiError(404, "No evaluation cycles are available.");

    const completedTerms = await getCompletedEvaluationTerms();
    return sendData(
      response,
      await getStatusForTerm(professor, cycles[0].term, completedTerms)
    );
  })
);

router.get(
  "/:email",
  asyncRoute(async (request, response) => {
    const email = normalizeEmail(request.params.email);
    const professor = await Professor.findOne({ email }).select("-password_hash").lean();
    if (!professor) throw new ApiError(404, "Professor not found.");
    return sendData(response, professor);
  })
);

router.patch(
  "/:email",
  asyncRoute(async (request, response) => {
    const email = normalizeEmail(request.params.email);
    requireObject(request.body);
    rejectUnknownFields(request.body, PROFESSOR_PATCH_FIELDS);
    if (!Object.keys(request.body).length) {
      throw new ApiError(400, "Provide at least one professor field to update.");
    }

    const updates = { ...request.body };
    for (const field of ["name", "department", "hire_level"]) {
      if (field in updates) {
        if (typeof updates[field] !== "string" || !updates[field].trim()) {
          throw new ApiError(400, `${field} must be a non-empty string.`);
        }
        updates[field] = updates[field].trim();
      }
    }
    if ("last_observed" in updates) {
      if (updates.last_observed === null) {
        // null is a valid value for a professor who has not yet been observed.
      } else if (typeof updates.last_observed !== "string" || Number.isNaN(Date.parse(updates.last_observed))) {
        throw new ApiError(400, "last_observed must be a valid date or null.");
      } else {
        updates.last_observed = new Date(updates.last_observed);
      }
    }
    if ("is_ac_member" in updates && typeof updates.is_ac_member !== "boolean") {
      throw new ApiError(400, "is_ac_member must be a boolean.");
    }

    const professor = await Professor.findOneAndUpdate(
      { email },
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password_hash");
    if (!professor) throw new ApiError(404, "Professor not found.");
    return sendData(response, professor);
  })
);

module.exports = { router, getCompletedEvaluationTerms, makeEvaluationStatus, getStatusForTerm };
