// Analytics for the Assessment Committee. Mounted at /api/admin/analytics (login + AC check already applied).
const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const { requireTerm } = require('../services/lookup');
const { loadWorkload } = require('../services/workload');

const router = express.Router();

/**
 * GET /api/admin/analytics/observer-workload?term=Fall 2026
 * Per professor: requests received / confirmed / declined / expired / stood down, observations assigned and completed,
 * acceptance rate and average time to answer; plus totals and the busiest observers.
 */
router.get('/observer-workload', asyncHandler(async (req, res) => {
  const term = req.query.term ? requireTerm(req.query.term) : (await currentCycle()).term;
  res.json(await loadWorkload(term));
}));

module.exports = router;
