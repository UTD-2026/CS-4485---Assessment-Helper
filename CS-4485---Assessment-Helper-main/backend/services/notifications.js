// In-app notifications. The project rule is "free / open source only", so nothing here sends real email:
// every notification is recorded in the `notifications` collection and the frontend shows it.
// To add email later, change only the body of notify() - every call site stays the same.
const { Notification } = require('../models');
const { now } = require('./clock');

const NOTIFICATION_TYPES = [
  'DUE_REMINDER',
  'OVERDUE_REMINDER',
  'OBSERVER_LIST_READY',
  'SURVEY_REMINDER',
  'REQUEST_RECEIVED',
  'REQUEST_ACCEPTED',        // two-step mode: an observer said yes; the observee still has to pick
  'REQUEST_CONFIRMED',
  'REQUEST_DECLINED',        // sent to observers who were stood down because another observer confirmed first
  'REQUEST_EXPIRED',         // TA Q&A: 48-hour invitation expiry
  'OBSERVATION_SCHEDULED',
  'SIGNATURE_NEEDED',
  'OBSERVATION_COMPLETED',
  'OBSERVATION_MISSED',
  'SIGNED_TEMPLATE_UPLOADED',
];

/**
 * @param section  (optional) the course section the message is about: any object with course_code, section_number and term
 * @param term     (optional) for messages that are about a whole term rather than one section
 */
async function notify({
  recipientEmail, type, message, section, term,
}) {
  if (!NOTIFICATION_TYPES.includes(type)) throw new Error(`Unknown notification type "${type}"`);
  const doc = {
    recipient_email: recipientEmail, type, message, created_at: now(), read_at: null,
  };
  if (section) {
    doc.course_code = section.course_code;
    doc.section_number = section.section_number;
    doc.term = section.term;
  } else if (term) {
    doc.term = term;
  }
  const created = await Notification.create(doc);
  return created.toObject ? created.toObject() : created;
}

/** Send the same notification to many people; one failure never stops the rest. */
async function notifyMany(recipientEmails, {
  type, message, section, term,
}) {
  const results = [];
  for (const recipientEmail of recipientEmails) {
    try {
      await notify({
        recipientEmail, type, message, section, term,
      });
      results.push({ recipientEmail, ok: true });
    } catch (err) {
      results.push({ recipientEmail, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  notify,
  notifyMany,
  NOTIFICATION_TYPES,
};
