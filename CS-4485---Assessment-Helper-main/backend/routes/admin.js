const express = require('express');
const { AuditLog } = require('../models');
const { asyncHandler, badRequest } = require('../middleware/errors');
const { expireStaleRequests, markMissedObservations, runAllSweeps } = require('../jobs/sweeps');
const { audit } = require('../services/audit');
const courseBook = require('../services/courseBook');
const { parseIsoDay } = require('../services/dates');
const { normalizeEmail, requireTerm } = require('../services/lookup');
const { describe, parsePaging } = require('../services/paging');
const { anonymizeLegacySurveys } = require('../services/surveys');

const router = express.Router();

/** POST /api/admin/jobs/run (AC) -> run both sweeps now (expire stale requests; mark missed observations) */
router.post('/jobs/run', asyncHandler(async (req, res) => {
  const summary = await runAllSweeps();
  await audit(req.user, 'jobs.run', { type: 'jobs', detail: { expiredRequests: summary.expiredRequests, missedObservations: summary.missedObservations } });
  res.json(summary);
}));
router.post('/jobs/expire-requests', asyncHandler(async (req, res) => res.json(await expireStaleRequests())));
router.post('/jobs/mark-missed', asyncHandler(async (req, res) => res.json(await markMissedObservations())));

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/admin/audit-log (AC)
 *   ?actor=email  &action=observation.signed  &actionPrefix=observation.  &targetType=observation  &targetId=<sectionId>
 *   &term=Fall 2026  &from=2026-10-01  &to=2026-10-31  &page=1&pageSize=25
 * Who did what and when, newest first. Survey submissions are deliberately not in here (they are anonymous).
 */
router.get('/audit-log', asyncHandler(async (req, res) => {
  const q = req.query;
  const paging = parsePaging(q);
  const filter = {};
  if (q.actor) filter.actor_email = normalizeEmail(q.actor);
  if (q.action) filter.action = String(q.action);
  else if (q.actionPrefix) filter.action = { $regex: `^${escapeRegex(String(q.actionPrefix))}` };
  if (q.targetType) filter.target_type = String(q.targetType);
  if (q.targetId) filter.target_id = String(q.targetId);
  if (q.term) filter.term = requireTerm(q.term);
  if (q.from || q.to) {
    const from = q.from ? parseIsoDay(q.from) : null;
    const to = q.to ? parseIsoDay(q.to) : null;
    if ((q.from && !from) || (q.to && !to)) throw badRequest('from and to must be real dates written YYYY-MM-DD.');
    filter.at = {};
    if (from) filter.at.$gte = from;
    if (to) filter.at.$lte = new Date(to.getTime() + 86400000 - 1); // the whole "to" day
  }
  const total = await AuditLog.countDocuments(filter);
  const entries = await AuditLog.find(filter).sort({ at: -1 }).skip(paging.skip).limit(paging.pageSize).lean();
  res.json({ entries, pagination: describe(paging, total) });
}));

/** GET /api/admin/course-book/status (AC) -> mode, timeout/retry/cache settings, last error (no secrets) */
router.get('/course-book/status', (req, res) => {
  res.json(courseBook.status());
});

/** POST /api/admin/course-book/refresh (AC)  { "term": "Fall 2026" } (optional) -> forget the cached answer so the next call asks again */
router.post('/course-book/refresh', asyncHandler(async (req, res) => {
  const term = req.body && req.body.term ? requireTerm(req.body.term) : null;
  courseBook.clearCache(term);
  await audit(req.user, 'coursebook.cache-cleared', { type: 'course_book', id: term });
  res.json({ cleared: term || 'all', status: courseBook.status() });
}));

/**
 * POST /api/admin/surveys/anonymize-legacy (AC)
 * Moves answers that older surveys stored next to a name (the seed has some) into anonymous responses and blanks them from
 * the completion record. Safe to run again.
 */
router.post('/surveys/anonymize-legacy', asyncHandler(async (req, res) => {
  const result = await anonymizeLegacySurveys();
  await audit(req.user, 'surveys.anonymized-legacy', { type: 'surveys', detail: { moved: result.moved } }); // counts only, never which rows
  res.json(result);
}));

module.exports = router;
