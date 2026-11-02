// In-app notifications (no email delivery yet).
const { Notification, Professor } = require("../models");

async function notify(recipients, message, type = "info") {
  const list = [...new Set([].concat(recipients).filter(Boolean))];
  if (!list.length) return;
  await Notification.insertMany(list.map((recipient_email) => ({ recipient_email, message, type })));
}

/** Send to every Assessment Committee member. */
async function notifyCommittee(message, type = "committee") {
  const members = await Professor.find({ is_ac_member: true }).select("email").lean();
  await notify(members.map((m) => m.email), message, type);
}

module.exports = { notify, notifyCommittee };
