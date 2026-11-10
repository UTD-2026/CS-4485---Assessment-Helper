// 1. Professors
const express = require("express");
const { Professor } = require("../models");
const { isAc } = require("../middleware/auth");
const { badRequest, forbidden, notFound } = require("../middleware/errors");
const { loadTermContext, presentProfessor, resolveTerm } = require("../services/context");
const { normalizeLevel } = require("../services/dueStatus");

const router = express.Router();
const MAJORS = ["BE", "CE", "CS", "EE", "ME", "SE"];

// GET /api/professors?term=  (each professor includes evaluation_status for the term; default = current term)
router.get("/", async (req, res) => {
  const term = await resolveTerm(req.query.term);
  const ctx = await loadTermContext(term);
  let list = ctx.professors.map((p) => presentProfessor(p, ctx.due.get(p.email)));
  if (req.query.department) list = list.filter((p) => p.department === req.query.department);
  if (req.query.major) list = list.filter((p) => p.major === String(req.query.major).toUpperCase());
  list.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ data: list, meta: { term } });
});

// GET /api/professors/:email
router.get("/:email", async (req, res) => {
  const professor = await Professor.findOne({ email: req.params.email.toLowerCase() }).select("-password_hash").lean();
  if (!professor) throw notFound("The specified professor was not found.");
  res.json({ data: presentProfessor(professor) });
});

// PATCH /api/professors/:email  (committee: any field below; a professor: their own name only)
router.patch("/:email", async (req, res) => {
  const email = req.params.email.toLowerCase();
  const self = req.user.email === email;
  if (!self && !isAc(req)) throw forbidden();

  const allowed = isAc(req) ? ["name", "department", "major", "hire_level", "is_ac_member", "last_observed"] : ["name"];
  const updates = {};
  for (const field of allowed) if (req.body?.[field] !== undefined) updates[field] = req.body[field];
  if (!Object.keys(updates).length) throw badRequest(`Nothing to update. Allowed fields: ${allowed.join(", ")}.`);
  if (updates.major !== undefined) {
    updates.major = String(updates.major).trim().toUpperCase();
    if (!MAJORS.includes(updates.major)) throw badRequest(`major must be one of ${MAJORS.join(", ")}.`);
  }
  if (updates.hire_level !== undefined) {
    updates.hire_level = normalizeLevel(updates.hire_level);
    if (!["assistant", "associate", "full"].includes(updates.hire_level)) throw badRequest("hire_level must be assistant, associate or full.");
  }

  const professor = await Professor.findOneAndUpdate({ email }, { $set: updates }, { returnDocument: "after", runValidators: true })
    .select("-password_hash").lean();
  if (!professor) throw notFound("The specified professor was not found.");
  res.json({ data: presentProfessor(professor) });
});

// GET /api/professors/:email/evaluation-status?term=
router.get("/:email/evaluation-status", async (req, res) => {
  const email = req.params.email.toLowerCase();
  const term = await resolveTerm(req.query.term);
  const ctx = await loadTermContext(term);
  const professor = ctx.profByEmail.get(email);
  if (!professor) throw notFound("The specified professor was not found.");
  const signedUp = ctx.observations.some((o) => ctx.sectionByKey.get(`${o.course_code}|${o.section_number}|${o.term}`)?.instructor_email === email);
  res.json({ data: { email, term, hire_level: professor.hire_level, signed_up: signedUp, ...ctx.due.get(email) } });
});

module.exports = router;
