// CSV exports for the Assessment Committee ("exportable reports"). Mounted at /api/reports behind login + AC check.
// Every endpoint takes ?term=Fall 2026 (default: the current cycle) and returns a file that opens in Excel / Google Sheets.
const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const { toCsv } = require('../services/csv');
const { loadDashboard, loadDueReport } = require('../services/kpis');
const { getCycleOr404, requireTerm } = require('../services/lookup');
const { DUE_COLUMNS, KPI_COLUMNS, SIGNUP_COLUMNS, WORKLOAD_COLUMNS, kpiRows, loadObservationRows, loadSignupRows, observationColumns } = require('../services/reports');
const { loadWorkload } = require('../services/workload');

const router = express.Router();

const termOf = async (req) => {
  const term = req.query.term ? requireTerm(req.query.term) : (await currentCycle()).term;
  await getCycleOr404(term);
  return term;
};

function sendCsv(res, name, term, columns, rows) {
  const file = `${name}-${term.replace(/\s+/g, '-')}.csv`;
  res.status(200)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${file}"`)
    .set('Cache-Control', 'private, no-store')
    .set('X-Content-Type-Options', 'nosniff')
    .send(toCsv(columns, rows));
}

/** GET /api/reports/due?term=  -> professors who are due or overdue, and whether they have signed up */
router.get('/due', asyncHandler(async (req, res) => {
  const term = await termOf(req);
  sendCsv(res, 'due-report', term, DUE_COLUMNS, (await loadDueReport(term)).professors);
}));

/** GET /api/reports/signups?term=  -> every signup with the class and meeting time */
router.get('/signups', asyncHandler(async (req, res) => {
  const term = await termOf(req);
  sendCsv(res, 'signups', term, SIGNUP_COLUMNS, await loadSignupRows(term));
}));

/** GET /api/reports/observations?term=  -> every observation: people, dates, status, signatures, ratings */
router.get('/observations', asyncHandler(async (req, res) => {
  const term = await termOf(req);
  const { rows, ratingKeys } = await loadObservationRows(term);
  sendCsv(res, 'observations', term, observationColumns(ratingKeys), rows);
}));

/** GET /api/reports/workload?term=  -> how many observers were asked / said yes / were assigned */
router.get('/workload', asyncHandler(async (req, res) => {
  const term = await termOf(req);
  sendCsv(res, 'observer-workload', term, WORKLOAD_COLUMNS, (await loadWorkload(term)).professors);
}));

/** GET /api/reports/kpis?term=  -> the dashboard numbers as section / metric / value rows */
router.get('/kpis', asyncHandler(async (req, res) => {
  const term = await termOf(req);
  sendCsv(res, 'kpis', term, KPI_COLUMNS, kpiRows(await loadDashboard(term)));
}));

module.exports = router;
