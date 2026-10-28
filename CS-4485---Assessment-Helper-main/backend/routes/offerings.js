const express = require('express');
const { asyncHandler, badRequest } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const courseBook = require('../services/courseBook');
const { normalizeEmail, requireTerm } = require('../services/lookup');
const { paginate, parsePaging } = require('../services/paging');

const router = express.Router();

/**
 * GET /api/course-offerings?term=Fall 2026&department=CS&level=3&instructorEmail=...&q=3345&page=1&pageSize=25
 * The course sections on offer, from Course Book when that is switched on and reachable, otherwise from the local data.
 * `source` says which ("local", "coursebook", "cache", "stale-cache", "local-fallback") and `warning` says why when it is
 * not the first choice. Paged.
 */
router.get('/', asyncHandler(async (req, res) => {
  const term = req.query.term ? requireTerm(req.query.term) : (await currentCycle()).term;
  let level;
  if (req.query.level !== undefined) {
    if (!/^[1-9]$/.test(req.query.level)) throw badRequest('level must be one digit, 1 to 9 (the thousands digit of the course number).');
    level = Number(req.query.level);
  }
  const paging = parsePaging(req.query);
  const result = await courseBook.loadOfferings(term);
  const filtered = courseBook.filterOfferings(result.offerings, {
    department: req.query.department,
    level,
    instructorEmail: req.query.instructorEmail ? normalizeEmail(req.query.instructorEmail) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
  }).sort((a, b) => a.courseCode.localeCompare(b.courseCode) || a.sectionNumber.localeCompare(b.sectionNumber));
  const { items, pagination } = paginate(filtered, paging);
  res.json({
    term, source: result.source, warning: result.warning, offerings: items, pagination,
  });
}));

module.exports = router;
