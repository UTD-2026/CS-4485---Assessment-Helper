// "Who am I and what may I do?"  (TA feedback: GET /me and GET /me/permissions - the resolved app user, roles and scope after login.)
const express = require('express');
const { publicProfessor } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');
const { currentCycle, cyclePhase } = require('../services/cycles');
const { rolesOf, permissionsOf } = require('../services/permissions');

const router = express.Router();

/** GET /api/me -> { user, roles, currentTerm, phase } */
router.get('/', asyncHandler(async (req, res) => {
  let cycle = null;
  try { cycle = await currentCycle(); } catch (err) { if (err.status !== 404) throw err; }
  res.json({
    user: publicProfessor(req.user),
    roles: rolesOf(req.user),
    currentTerm: cycle ? cycle.term : null,
    phase: cycle ? cyclePhase(cycle) : null,
  });
}));

/** GET /api/me/permissions -> what this account may do, as named permissions and as the yes/no switches a screen needs */
router.get('/permissions', asyncHandler(async (req, res) => {
  res.json(permissionsOf(req.user));
}));

module.exports = router;
