// 9. Rank changes (extension: not in the API Endpoints doc)
// A professor reports a rank change (e.g. Assistant -> Associate); the Assessment Committee approves or rejects it.
// Approving updates Professor.hire_level, which feeds the due rule and observer eligibility.
const express = require("express");
const mongoose = require("mongoose");
const { Professor, RankChangeRequest, RANKS } = require("../models");
const { isAc, requireAc } = require("../middleware/auth");
const { badRequest, conflict, forbidden, notFound } = require("../middleware/errors");
const { normalizeLevel, levelLabel } = require("../services/dueStatus");
const { notify, notifyCommittee } = require("../services/notifications");

const router = express.Router();

const MAX_REASON = 2000;

function present(r, profByEmail) {
  const prof = profByEmail?.get(r.professor_email);
  return {
    id: String(r._id),
    professor_email: r.professor_email,
    professor_name: prof?.name ?? null,
    department: prof?.department ?? null,
    current_level: r.current_level,
    current_level_label: levelLabel(r.current_level),
    requested_level: r.requested_level,
    requested_level_label: levelLabel(r.requested_level),
    recorded_level: r.recorded_level,
    recorded_level_label: r.recorded_level ? levelLabel(r.recorded_level) : null,
    reason: r.reason,
    status: r.status,
    submitted_date: r.submitted_date,
    reviewed_by: r.reviewed_by,
    reviewed_by_name: r.reviewed_by ? profByEmail?.get(r.reviewed_by)?.name ?? null : null,
    reviewed_date: r.reviewed_date,
    review_note: r.review_note || "",
  };
}

async function directory(emails) {
  const list = await Professor.find({ email: { $in: [...new Set(emails.filter(Boolean))] } }).select("email name department").lean();
  return new Map(list.map((p) => [p.email, p]));
}

const readLevel = (value, field) => {
  const level = normalizeLevel(value);
  if (!RANKS.includes(level)) throw badRequest(`${field} must be assistant, associate or full.`);
  return level;
};

// GET /api/rank-changes?status=pending|approved|rejected
// Committee: every request. Professor: their own requests only.
router.get("/", async (req, res) => {
  const filter = isAc(req) ? {} : { professor_email: req.user.email };
  if (req.query.status) {
    if (!["pending", "approved", "rejected"].includes(req.query.status)) throw badRequest("status must be pending, approved or rejected.");
    filter.status = req.query.status;
  }
  const rows = await RankChangeRequest.find(filter).sort({ submitted_date: -1 }).lean();
  const profs = await directory(rows.flatMap((r) => [r.professor_email, r.reviewed_by]));
  res.json({ data: rows.map((r) => present(r, profs)), meta: { count: rows.length } });
});

// POST /api/rank-changes   Body: { current_level, requested_level, reason }
// One pending request per professor at a time.
router.post("/", async (req, res) => {
  const b = req.body || {};
  const current = readLevel(b.current_level, "current_level");
  const requested = readLevel(b.requested_level, "requested_level");
  if (current === requested) throw badRequest("The rank you are changing to must be different from your current rank.");
  const reason = String(b.reason ?? "").trim();
  if (!reason) throw badRequest("Please give a reason for the rank change.");
  if (reason.length > MAX_REASON) throw badRequest(`The reason must be ${MAX_REASON} characters or fewer.`);

  const pending = await RankChangeRequest.exists({ professor_email: req.user.email, status: "pending" });
  if (pending) throw conflict("You already have a rank change waiting for the committee's review.");

  const doc = await RankChangeRequest.create({
    professor_email: req.user.email,
    current_level: current,
    requested_level: requested,
    recorded_level: normalizeLevel(req.user.hire_level) || null,
    reason,
  });
  await notifyCommittee(`${req.user.name} submitted a rank change: ${levelLabel(current)} → ${levelLabel(requested)}.`);
  const profs = await directory([req.user.email]);
  res.status(201).json({ data: present(doc.toObject(), profs) });
});

// PATCH /api/rank-changes/:id/decision   (committee)  Body: { decision: "approve" | "reject", note? }
router.patch("/:id/decision", requireAc, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound("The specified rank change was not found.");
  const decision = req.body?.decision;
  if (!["approve", "reject"].includes(decision)) throw badRequest('decision must be "approve" or "reject".');
  const note = String(req.body?.note ?? "").trim().slice(0, MAX_REASON);

  const existing = await RankChangeRequest.findById(req.params.id).lean();
  if (!existing) throw notFound("The specified rank change was not found.");
  if (existing.professor_email === req.user.email) throw forbidden("You cannot review your own rank change.");

  // Only a pending request can be decided (the filter makes two reviewers clicking at once safe).
  const status = decision === "approve" ? "approved" : "rejected";
  const updated = await RankChangeRequest.findOneAndUpdate(
    { _id: existing._id, status: "pending" },
    { $set: { status, reviewed_by: req.user.email, reviewed_date: new Date(), review_note: note } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw conflict(`This rank change was already ${existing.status}.`);

  if (status === "approved") {
    await Professor.updateOne({ email: updated.professor_email }, { $set: { hire_level: updated.requested_level } });
  }
  const verb = status === "approved" ? "approved" : "not approved";
  await notify(
    updated.professor_email,
    `Your rank change to ${levelLabel(updated.requested_level)} was ${verb} by the Assessment Committee.${note ? ` Note: ${note}` : ""}`,
    "rank_change",
  );

  const profs = await directory([updated.professor_email, updated.reviewed_by]);
  res.json({ data: present(updated, profs) });
});

module.exports = router;
