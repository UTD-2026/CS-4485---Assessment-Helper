// Matchmaking API — exposes the eligibility-based observer-matching
// engine. Superseded from teacher-based focus-area matching: candidates
// are now generated per SIGNUP, because eligibility depends on the
// specific course section (department + course level + meeting time)
// the Observee signed up with, not just the Observee as a person.

const express = require('express');
const { findEligibleObservers, generateAndPersistCandidates } = require('../services/matchingService');

const router = express.Router();

/**
 * POST /api/matchmaking/recommend
 * body: { signupId: string }
 *
 * Preview endpoint: computes and returns the ranked eligible-observer
 * list for a signup WITHOUT persisting it. Useful for a "what would
 * this look like" check before the AC officially runs Observer
 * Selection for the whole cycle.
 */
router.post('/recommend', async (req, res, next) => {
    try {
        const { signupId } = req.body || {};
        if (!signupId || typeof signupId !== 'string') {
            return res.status(400).json({ error: 'signupId (string) is required in the request body.' });
        }
        const result = await findEligibleObservers(signupId);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/matchmaking/generate/:signupId
 *
 * Persists the candidate list to observer_candidate, flags
 * has_sufficient_observers on the signup, and logs any ineligible
 * evaluations for the Evaluation Eligibility Accuracy KPI. This is what
 * the AC's "Observer Selection" button calls per signup — see
 * POST /api/assessment-cycles/:id/run-observer-selection for the bulk
 * version that calls this for every signup in a cycle at once.
 */
router.post('/generate/:signupId', async (req, res, next) => {
    try {
        const result = await generateAndPersistCandidates(req.params.signupId);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
