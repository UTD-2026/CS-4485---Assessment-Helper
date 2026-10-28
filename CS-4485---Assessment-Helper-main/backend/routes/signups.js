const express = require('express');
const { asyncHandler, badRequest } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const { observationsOfProfessor, requireTerm, sectionKey } = require('../services/lookup');
const { createSignup } = require('../services/workflow');

const router = express.Router();

/**
 * POST /api/signups   { "sectionId": "CS 2117~001~Fall 2026" }   (one of YOUR course sections, from GET /api/sections)
 * Signs you up to be observed in that class. One signup per professor per term, until the cycle's signup deadline.
 */
router.post('/', asyncHandler(async (req, res) => {
  const { sectionId } = req.body || {};
  if (!sectionId) throw badRequest('sectionId is required.');
  const observation = await createSignup(req.user, sectionId);
  res.status(201).json({ observation });
}));

/** GET /api/signups/mine?term=Fall 2026 -> your signup for the term (or null) */
router.get('/mine', asyncHandler(async (req, res) => {
  const term = req.query.term ? requireTerm(req.query.term) : (await currentCycle()).term;
  const { sections, observations } = await observationsOfProfessor(req.user.email, term);
  const observation = observations[0] || null;
  const section = observation ? sections.find((s) => sectionKey(s) === sectionKey(observation)) : null;
  res.json({ term, observation, section, mySections: sections });
}));

module.exports = router;
