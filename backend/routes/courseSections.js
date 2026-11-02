// 2. Course Sections
const express = require("express");
const { CourseSection, Professor } = require("../models");
const { requireAc } = require("../middleware/auth");
const { badRequest, notFound } = require("../middleware/errors");
const { isValidTerm } = require("../services/terms");

const router = express.Router();
const clean = ({ __v, ...rest }) => rest;
const keyOf = (p) => ({ course_code: p.course_code, section_number: p.section_number, term: p.term });

// GET /api/course-sections?term=&instructor_email=
router.get("/", async (req, res) => {
  const filter = {};
  if (req.query.term) filter.term = req.query.term;
  if (req.query.instructor_email) filter.instructor_email = String(req.query.instructor_email).toLowerCase();
  const sections = await CourseSection.find(filter).sort({ term: 1, course_code: 1, section_number: 1 }).lean();
  res.json({ data: sections.map(clean) });
});

// GET /api/course-sections/:course_code/:section_number/:term
router.get("/:course_code/:section_number/:term", async (req, res) => {
  const section = await CourseSection.findOne(keyOf(req.params)).lean();
  if (!section) throw notFound("Course section not found.");
  res.json({ data: clean(section) });
});

async function validateSection(body, partial = false) {
  const required = ["course_code", "section_number", "term", "timing", "instructor_email"];
  if (!partial) {
    const missing = required.filter((f) => !body?.[f]);
    if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(", ")}.`);
  }
  if (body.term !== undefined && !isValidTerm(body.term)) throw badRequest(`Invalid term "${body.term}".`);
  if (body.instructor_email && !(await Professor.exists({ email: String(body.instructor_email).toLowerCase() }))) {
    throw badRequest(`Professor not found: ${body.instructor_email}`);
  }
}

// POST /api/course-sections  (committee)
router.post("/", requireAc, async (req, res) => {
  await validateSection(req.body);
  const { course_code, section_number, term, timing, instructor_email } = req.body;
  const section = await CourseSection.create({ course_code, section_number, term, timing, instructor_email });
  res.status(201).json({ data: clean(section.toObject()) });
});

// PATCH /api/course-sections/:course_code/:section_number/:term  (committee: timing / instructor)
router.patch("/:course_code/:section_number/:term", requireAc, async (req, res) => {
  const updates = {};
  for (const f of ["timing", "instructor_email"]) if (req.body?.[f] !== undefined) updates[f] = req.body[f];
  if (!Object.keys(updates).length) throw badRequest("Nothing to update. Allowed fields: timing, instructor_email.");
  await validateSection(updates, true);
  const section = await CourseSection.findOneAndUpdate(keyOf(req.params), { $set: updates }, { returnDocument: "after", runValidators: true }).lean();
  if (!section) throw notFound("Course section not found.");
  res.json({ data: clean(section) });
});

module.exports = router;
