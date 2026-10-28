const express = require('express');
const { Notification } = require('../models');
const { asyncHandler, badRequest, notFound } = require('../middleware/errors');
const { now } = require('../services/clock');
const { isObjectId } = require('../services/ids');
const { describe, parsePaging } = require('../services/paging');

const router = express.Router();

/** GET /api/notifications?unread=true&limit=50 -> your notifications, newest first */
router.get('/', asyncHandler(async (req, res) => {
  const filter = { recipient_email: req.user.email };
  if (req.query.unread === 'true') filter.read_at = null;
  const unreadCount = await Notification.countDocuments({ recipient_email: req.user.email, read_at: null });
  // `page` / `pageSize` switch on the paging convention; without them the old `limit` (default 50, at most 200) still applies.
  if (req.query.page !== undefined || req.query.pageSize !== undefined) {
    const paging = parsePaging(req.query);
    const total = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter).sort({ created_at: -1 }).skip(paging.skip).limit(paging.pageSize).lean();
    return res.json({ unreadCount, notifications, pagination: describe(paging, total) });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const notifications = await Notification.find(filter).sort({ created_at: -1 }).limit(limit).lean();
  return res.json({ unreadCount, notifications });
}));

/** POST /api/notifications/read-all */
router.post('/read-all', asyncHandler(async (req, res) => {
  const result = await Notification.updateMany({ recipient_email: req.user.email, read_at: null }, { $set: { read_at: now() } });
  res.json({ marked: result.modifiedCount });
}));

/** POST /api/notifications/:id/read */
router.post('/:id/read', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw badRequest('id must be a 24-character hex id.');
  const result = await Notification.updateOne({ _id: req.params.id, recipient_email: req.user.email }, { $set: { read_at: now() } });
  if (result.matchedCount !== 1) throw notFound('Notification not found.');
  res.json({ ok: true });
}));

module.exports = router;
