// 8. Notifications (the signed-in user's in-app inbox / archive)
const express = require("express");
const mongoose = require("mongoose");
const { Notification } = require("../models");
const { badRequest, notFound } = require("../middleware/errors");

const router = express.Router();
const present = ({ _id, __v, ...n }) => ({ ...n, id: String(_id) });

// GET /api/notifications?archived=true|false
router.get("/", async (req, res) => {
  const filter = { recipient_email: req.user.email };
  if (req.query.archived !== undefined) filter.archived = req.query.archived === "true";
  const list = await Notification.find(filter).sort({ created_at: 1 }).limit(500).lean();
  res.json({ data: list.map(present), meta: { unread: list.filter((n) => !n.read && !n.archived).length } });
});

async function update(req, res, changes) {
  if (!mongoose.isValidObjectId(req.params.notification_id)) throw badRequest("Invalid notification id.");
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.notification_id, recipient_email: req.user.email },
    { $set: changes },
    { returnDocument: "after" }
  ).lean();
  if (!n) throw notFound("Notification not found.");
  return n;
}

// PATCH /api/notifications/:notification_id/read
router.patch("/:notification_id/read", async (req, res) => {
  res.json({ data: present(await update(req, res, { read: true })) });
});

// PATCH /api/notifications/:notification_id/archive   (204 No Content, as in the doc's example)
router.patch("/:notification_id/archive", async (req, res) => {
  await update(req, res, { archived: true, read: true });
  res.status(204).end();
});

module.exports = router;
