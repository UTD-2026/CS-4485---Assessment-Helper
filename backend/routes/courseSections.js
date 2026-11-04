const express = require("express");
const { CourseSection, EvaluationCycle, Professor } = require("../models");
const {
  ApiError,
  asyncRoute,
  sendData,
  requireObject,
  rejectUnknownFields,
  requireString,
  normalizeEmail,
  normalizeTerm,
  routeSectionKey,
} = require("./apiHelpers");

const router = express.Router();
const CREATE_FIELDS = [
  "course_code",
  "section_number",
  "term",
  "timing",
  "instructor_email",
];
const PATCH_FIELDS = ["timing", "instructor_email"];

function validateTiming(value) {
  const timing = requireString(value, "timing", {
    pattern: /^(MW|TT) \d{2}:\d{2}-\d{2}:\d{2}$/,
  });
  const times = timing.match(/\d{2}:\d{2}/g);
  const validTime = (part) => {
    const [hour, minute] = part.split(":").map(Number);
    return hour <= 23 && minute <= 59;
  };
  if (!validTime(times[0]) || !validTime(times[1]) || times[0] >= times[1]) {
    throw new ApiError(400, "timing must contain a valid start and end time.");
  }
  return timing;
}

async function validateRelationships(term, instructorEmail) {
  if (!(await EvaluationCycle.exists({ term }))) {
    throw new ApiError(400, `Evaluation cycle not found: ${term}.`);
  }
  if (!(await Professor.exists({ email: instructorEmail }))) {
    throw new ApiError(400, `Professor not found: ${instructorEmail}.`);
  }
}

router.get(
  "/",
  asyncRoute(async (request, response) => {
    const filter = {};
    if (request.query.term !== undefined) filter.term = normalizeTerm(request.query.term);
    if (request.query.instructor_email !== undefined) {
      filter.instructor_email = normalizeEmail(request.query.instructor_email, "instructor_email");
    }
    const sections = await CourseSection.find(filter)
      .sort({ term: -1, course_code: 1, section_number: 1 })
      .lean();
    return sendData(response, sections);
  })
);

router.get(
  "/:course_code/:section_number/:term",
  asyncRoute(async (request, response) => {
    const key = routeSectionKey(request);
    const section = await CourseSection.findOne(key).lean();
    if (!section) throw new ApiError(404, "Course section not found.");
    return sendData(response, section);
  })
);

router.post(
  "/",
  asyncRoute(async (request, response) => {
    requireObject(request.body);
    rejectUnknownFields(request.body, CREATE_FIELDS);
    const course_code = requireString(request.body.course_code, "course_code");
    const section_number = requireString(request.body.section_number, "section_number", {
      pattern: /^\d{3}$/,
    });
    const term = normalizeTerm(request.body.term);
    const timing = validateTiming(request.body.timing);
    const instructor_email = normalizeEmail(request.body.instructor_email, "instructor_email");
    await validateRelationships(term, instructor_email);

    const section = await CourseSection.create({
      course_code,
      section_number,
      term,
      timing,
      instructor_email,
    });
    return sendData(response, section, 201);
  })
);

router.patch(
  "/:course_code/:section_number/:term",
  asyncRoute(async (request, response) => {
    const key = routeSectionKey(request);
    requireObject(request.body);
    rejectUnknownFields(request.body, PATCH_FIELDS);
    if (!Object.keys(request.body).length) {
      throw new ApiError(400, "Provide timing or instructor_email to update.");
    }

    const updates = {};
    if ("timing" in request.body) updates.timing = validateTiming(request.body.timing);
    if ("instructor_email" in request.body) {
      updates.instructor_email = normalizeEmail(request.body.instructor_email, "instructor_email");
    }
    const existing = await CourseSection.findOne(key).select("instructor_email").lean();
    if (!existing) throw new ApiError(404, "Course section not found.");
    if (updates.instructor_email) {
      await validateRelationships(key.term, updates.instructor_email);
    }

    const section = await CourseSection.findOneAndUpdate(
      key,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    if (!section) throw new ApiError(404, "Course section not found.");
    return sendData(response, section);
  })
);

module.exports = router;
