const express = require('express');
const { requireAc } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');
const { meetingOf } = require('../services/eligibility');
const { generateSuggestions, previewEligibility } = require('../services/matching');
const { sectionKey } = require('../services/lookup');

const router = express.Router();

/**
 * GET /api/matching/preview/:sectionId  (AC)
 * Explains the matching for one signup WITHOUT saving anything: every other professor with their verdict
 * (eligible, or the first rule they break and why), the eligible pool, and what the 5-or-all rule would pick.
 */
router.get('/preview/:sectionId', requireAc, asyncHandler(async (req, res) => {
  const { observation, section, observee, evaluations, eligible, chosen, mode, flag } = await previewEligibility(req.params.sectionId);
  res.json({
    sectionId: sectionKey(observation),
    observee: { email: observee.email, name: observee.name },
    section: { courseCode: section.course_code, ...meetingOf(section), term: section.term },
    eligibleCount: eligible.length,
    flag,
    mode,
    wouldShow: chosen.map((e) => e.candidate.email),
    evaluations: evaluations.map((e) => ({
      email: e.candidate.email, name: e.candidate.name, department: e.candidate.department,
      eligible: e.eligible, violation: e.violation, detail: e.detail,
    })),
  });
}));

/** POST /api/matching/generate/:sectionId (AC) -> (re)build the observer list for one signup and save it */
router.post('/generate/:sectionId', requireAc, asyncHandler(async (req, res) => {
  res.json(await generateSuggestions(req.params.sectionId));
}));

module.exports = router;
