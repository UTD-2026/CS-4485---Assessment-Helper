const express = require('express');
const { CourseSection } = require('../models');
const { asyncHandler, forbidden } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const { normalizeEmail, requireTerm } = require('../services/lookup');
const { paginate, parsePaging } = require('../services/paging');

const router = express.Router();

/**
 * GET /api/sections?term=Fall 2026&instructorEmail=...
 * Course sections taught by someone (default: you) in a term (default: the current cycle).
 * The signup screen uses this to let a professor pick which of their classes to be observed in.
 */
router.get('/', asyncHandler(async (req, res) => {
  const instructorEmail = req.query.instructorEmail ? normalizeEmail(req.query.instructorEmail) : req.user.email;
  if (instructorEmail !== req.user.email && !req.user.is_ac_member) throw forbidden('You can only list your own course sections.');
  const term = req.query.term ? requireTerm(req.query.term) : (await currentCycle()).term;
  const sections = await CourseSection.find({ instructor_email: instructorEmail, term }).sort({ course_code: 1, section_number: 1 }).lean();
  const paging = parsePaging(req.query);
  if (paging.requested) {
    const { items, pagination } = paginate(sections, paging);
    return res.json({ term, instructorEmail, sections: items, pagination });
  }
  return res.json({ term, instructorEmail, sections });
}));

module.exports = router;
