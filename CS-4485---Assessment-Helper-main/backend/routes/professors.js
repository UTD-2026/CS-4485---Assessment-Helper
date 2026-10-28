const express = require('express');
const { CourseSection, Observation, Professor } = require('../models');
const { publicProfessor, requireAc } = require('../middleware/auth');
const { asyncHandler, forbidden, notFound } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const { dueStatuses } = require('../services/kpis');
const { loadFacultyEligibility } = require('../services/facultyEligibility');
const { normalizeEmail, requireTerm } = require('../services/lookup');
const { paginate, parsePaging } = require('../services/paging');

const router = express.Router();

async function resolveTerm(queryTerm) {
  return queryTerm ? requireTerm(queryTerm) : (await currentCycle()).term;
}

async function dueFor(term) {
  const [professors, sections, observations] = await Promise.all([Professor.find({}).lean(), CourseSection.find({}).lean(), Observation.find({}).lean()]);
  return { professors, due: dueStatuses({ professors, sections, observations, term }) };
}

/**
 * GET /api/professors?department=CS&hireLevel=assistant&term=Fall 2026   (AC only)
 * Everyone, each with their due / overdue status for the term (defaults to the current cycle).
 */
router.get('/', requireAc, asyncHandler(async (req, res) => {
  const term = await resolveTerm(req.query.term);
  const { professors, due } = await dueFor(term);
  const rows = professors
    .filter((p) => (!req.query.department || p.department === req.query.department) && (!req.query.hireLevel || p.hire_level === req.query.hireLevel))
    .map((p) => ({ ...publicProfessor(p), due: due.get(p.email) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const paging = parsePaging(req.query);
  if (paging.requested) {
    const { items, pagination } = paginate(rows, paging);
    return res.json({ term, count: rows.length, professors: items, pagination });
  }
  return res.json({ term, count: rows.length, professors: rows });
}));

function assertSelfOrAc(req, email) {
  if (req.user.email !== email && !req.user.is_ac_member) throw forbidden('You can only view your own record.');
}

/** GET /api/professors/:email  (yourself, or any professor if you are AC) */
router.get('/:email', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.params.email);
  assertSelfOrAc(req, email);
  const professor = await Professor.findOne({ email }).lean();
  if (!professor) throw notFound('Professor not found.');
  res.json({ professor: publicProfessor(professor) });
}));

/** GET /api/professors/:email/due-status?term=Fall 2026 -> {status: not_due|due|overdue, anniversary, dueWindow, baselineTerm} */
router.get('/:email/due-status', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.params.email);
  assertSelfOrAc(req, email);
  const term = await resolveTerm(req.query.term);
  const { professors, due } = await dueFor(term);
  const professor = professors.find((p) => p.email === email);
  if (!professor) throw notFound('Professor not found.');
  res.json({ term, professor: publicProfessor(professor), ...due.get(email) });
}));

/**
 * GET /api/professors/:email/eligibility?term=Fall 2026   (yourself, or any professor if you are AC)
 * Is this professor due (or overdue) for an observation, in plain words, and what stops them signing up right now?
 * Carries the rule version so a report can say which rules produced the answer.
 */
router.get('/:email/eligibility', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.params.email);
  assertSelfOrAc(req, email);
  const term = await resolveTerm(req.query.term);
  const { rows, phase, ruleVersion } = await loadFacultyEligibility(term);
  const row = rows.find((r) => r.email === email);
  if (!row) throw notFound('Professor not found.');
  res.json({ term, phase, ruleVersion, eligibility: row });
}));

module.exports = router;
