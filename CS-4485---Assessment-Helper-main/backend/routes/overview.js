// The professor's home screen in one request.
const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const { requireTerm } = require('../services/lookup');
const { loadOverview } = require('../services/overview');

const router = express.Router();

/**
 * GET /api/overview?term=Fall 2026     (term defaults to the current cycle)
 * -> { cycle, evaluation, asObservee: { nextAction, ... }, asObserver: { pendingRequests, duties }, unreadNotifications }
 * nextAction.code is a stable value for the frontend to switch on; nextAction.message is ready-to-show English.
 */
router.get('/', asyncHandler(async (req, res) => {
  const term = req.query.term ? requireTerm(req.query.term) : (await currentCycle()).term;
  res.json(await loadOverview(req.user, term));
}));

module.exports = router;
