// Executive dashboard (AC only). Every route takes ?term=Fall 2026 and defaults to the current cycle.
// GET /api/admin/dashboard-stats returns everything at once; the sub-routes return one KPI group each
// (same names the earlier version used).
const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const { loadDashboard } = require('../services/kpis');
const { requireTerm } = require('../services/lookup');

const router = express.Router();

async function stats(req) {
  const term = req.query.term ? requireTerm(req.query.term) : (await currentCycle()).term;
  return loadDashboard(term);
}

router.get('/', asyncHandler(async (req, res) => res.json(await stats(req))));

router.get('/faculty-due-for-evaluation', asyncHandler(async (req, res) => {
  const d = await stats(req);
  res.json({ term: d.term, ...d.facultyDueForEvaluation });
}));

router.get('/overdue-evaluations', asyncHandler(async (req, res) => {
  const d = await stats(req);
  res.json({
    term: d.term,
    ...d.overdueEvaluations,
    evaluationEligibilityAccuracy: d.eligibility.evaluationEligibilityAccuracy,
  });
}));

router.get('/eligibility-violations', asyncHandler(async (req, res) => {
  const d = await stats(req);
  res.json({ term: d.term, ...d.eligibility });
}));

router.get('/unmatched-faculty', asyncHandler(async (req, res) => {
  const d = await stats(req);
  res.json({ term: d.term, ...d.unmatchedFaculty });
}));

router.get('/outstanding-observations', asyncHandler(async (req, res) => {
  const d = await stats(req);
  res.json({ term: d.term, ...d.outstandingObservations });
}));

router.get('/participation', asyncHandler(async (req, res) => {
  const d = await stats(req);
  res.json({ term: d.term, ...d.participation });
}));

router.get('/survey-completion', asyncHandler(async (req, res) => {
  const d = await stats(req);
  res.json({ term: d.term, ...d.surveyCompletion });
}));

module.exports = router;
