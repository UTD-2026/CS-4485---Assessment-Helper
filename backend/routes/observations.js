const express = require("express");
const { Observation, CourseSection, EvaluationCycle, Professor } = require("../models");
const {
  ApiError,
  asyncRoute,
  sendData,
  requireObject,
  rejectUnknownFields,
  normalizeEmail,
  normalizeTerm,
  requireString,
  parseDate,
  routeSectionKey,
} = require("./apiHelpers");

const router = express.Router();
const OBSERVATION_FIELDS = [
  "observer_email",
  "signup_date",
  "observation_date",
  "status",
  "observer_signed_date",
  "observee_signed_date",
  "ratings",
];
const FORM_FIELDS = ["ratings", "observer_signed_date", "observee_signed_date"];

function normalizeStatus(value) {
  return requireString(value, "status", {
    pattern: /^[a-zA-Z][a-zA-Z0-9 _-]*$/,
  }).toLowerCase().replace(/\s+/g, "_");
}

function validateRatings(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "ratings must be a JSON object or null.");
  }
  return value;
}

async function normalizeObservationFields(body, { allowStatus = true } = {}) {
  const updates = {};
  if ("observer_email" in body) {
    updates.observer_email = body.observer_email === null
      ? null
      : normalizeEmail(body.observer_email, "observer_email");
    if (updates.observer_email && !(await Professor.exists({ email: updates.observer_email }))) {
      throw new ApiError(400, `Professor not found: ${updates.observer_email}.`);
    }
  }
  for (const field of ["signup_date", "observation_date", "observer_signed_date", "observee_signed_date"]) {
    if (field in body) updates[field] = parseDate(body[field], field, { allowNull: true });
  }
  if ("status" in body) {
    if (!allowStatus) throw new ApiError(400, "Use the status endpoint to change observation status.");
    updates.status = normalizeStatus(body.status);
  }
  if ("ratings" in body) updates.ratings = validateRatings(body.ratings);
  return updates;
}

async function observationKeyExists(key) {
  const sectionExists = await CourseSection.exists(key);
  if (!sectionExists) throw new ApiError(400, "A matching course section does not exist.");
  const cycleExists = await EvaluationCycle.exists({ term: key.term });
  if (!cycleExists) throw new ApiError(400, "A matching evaluation cycle does not exist.");
}

router.get(
  "/",
  asyncRoute(async (request, response) => {
    const filter = {};
    if (request.query.term !== undefined) filter.term = normalizeTerm(request.query.term);
    if (request.query.observer_email !== undefined) {
      filter.observer_email = normalizeEmail(request.query.observer_email, "observer_email");
    }
    if (request.query.status !== undefined) filter.status = normalizeStatus(request.query.status);

    if (request.query.observee_email !== undefined) {
      const observeeEmail = normalizeEmail(request.query.observee_email, "observee_email");
      const sections = await CourseSection.find({ instructor_email: observeeEmail })
        .select("course_code section_number term")
        .lean();
      if (!sections.length) return sendData(response, []);
      filter.$or = sections.map(({ course_code, section_number, term }) => ({
        course_code,
        section_number,
        term,
      }));
    }

    const observations = await Observation.find(filter)
      .sort({ term: -1, observation_date: 1 })
      .lean();
    return sendData(response, observations);
  })
);

router.get(
  "/:course_code/:section_number/:term",
  asyncRoute(async (request, response) => {
    const key = routeSectionKey(request);
    const observation = await Observation.findOne(key).lean();
    if (!observation) throw new ApiError(404, "Observation not found.");
    return sendData(response, observation);
  })
);

router.post(
  "/",
  asyncRoute(async (request, response) => {
    requireObject(request.body);
    rejectUnknownFields(request.body, [
      "course_code",
      "section_number",
      "term",
      ...OBSERVATION_FIELDS,
    ]);
    const key = {
      course_code: requireString(request.body.course_code, "course_code"),
      section_number: requireString(request.body.section_number, "section_number", {
        pattern: /^\d{3}$/,
      }),
      term: normalizeTerm(request.body.term),
    };
    await observationKeyExists(key);

    const fields = await normalizeObservationFields(request.body);
    const observation = await Observation.create({
      ...key,
      signup_date: new Date(),
      status: "signed_up",
      ...fields,
    });
    return sendData(response, observation, 201);
  })
);

router.patch(
  "/:course_code/:section_number/:term/status",
  asyncRoute(async (request, response) => {
    const key = routeSectionKey(request);
    requireObject(request.body);
    rejectUnknownFields(request.body, ["status"]);
    const status = normalizeStatus(request.body.status);
    const observation = await Observation.findOneAndUpdate(
      key,
      { $set: { status } },
      { new: true, runValidators: true }
    ).lean();
    if (!observation) throw new ApiError(404, "Observation not found.");
    return sendData(response, observation);
  })
);

router.patch(
  "/:course_code/:section_number/:term/form",
  asyncRoute(async (request, response) => {
    const key = routeSectionKey(request);
    requireObject(request.body);
    rejectUnknownFields(request.body, FORM_FIELDS);
    if (!Object.keys(request.body).length) {
      throw new ApiError(400, "Provide ratings or a signature date.");
    }
    const updates = await normalizeObservationFields(request.body, { allowStatus: false });
    const observation = await Observation.findOneAndUpdate(
      key,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    if (!observation) throw new ApiError(404, "Observation not found.");
    return sendData(response, observation);
  })
);

router.patch(
  "/:course_code/:section_number/:term/missed",
  asyncRoute(async (request, response) => {
    const key = routeSectionKey(request);
    const existing = await Observation.findOne(key).select("status").lean();
    if (!existing) throw new ApiError(404, "Observation not found.");
    if (existing.status.toLowerCase() === "completed") {
      throw new ApiError(409, "A completed observation cannot be reported as missed.");
    }
    const observation = await Observation.findOneAndUpdate(
      key,
      { $set: { status: "missed" } },
      { new: true, runValidators: true }
    ).lean();
    return sendData(response, observation);
  })
);

router.patch(
  "/:course_code/:section_number/:term",
  asyncRoute(async (request, response) => {
    const key = routeSectionKey(request);
    requireObject(request.body);
    rejectUnknownFields(request.body, OBSERVATION_FIELDS);
    if (!Object.keys(request.body).length) {
      throw new ApiError(400, "Provide observation fields to update.");
    }
    const updates = await normalizeObservationFields(request.body, { allowStatus: false });
    const observation = await Observation.findOneAndUpdate(
      key,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    if (!observation) throw new ApiError(404, "Observation not found.");
    return sendData(response, observation);
  })
);

module.exports = router;
