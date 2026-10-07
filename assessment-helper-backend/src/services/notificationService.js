// Notification service.
//
// The project's logistics rule is "free/open source only, no paid
// tools, no 30-day trials," so this proof of concept does not wire up a
// paid transactional-email provider. Instead every notification is
// recorded to notification_log (so the AC and each recipient can see
// what was sent and when) via a single send() function. Swapping in
// real email delivery later (e.g. nodemailer against a free SMTP
// relay) means changing only the body of send() — every call site in
// the app stays the same.

const { query } = require('../config/db');

const NOTIFICATION_TYPES = [
    'DUE_REMINDER',
    'OVERDUE_REMINDER',
    'OBSERVER_LIST_READY',
    'SURVEY_REMINDER',
    'REQUEST_RECEIVED',
    'REQUEST_CONFIRMED',
    'REQUEST_DECLINED',
    'REQUEST_EXPIRED', // TA Q&A: 48-hour invitation expiration sweep
];

/**
 * Send (log) one notification to one teacher.
 * @param {{recipientTeacherId: string, assessmentCycleId?: string, type: string, message: string}} params
 */
async function send({ recipientTeacherId, assessmentCycleId, type, message }) {
    if (!NOTIFICATION_TYPES.includes(type)) {
        throw new Error(`Unknown notification type "${type}"`);
    }
    const result = await query(
        `INSERT INTO notification_log (recipient_teacher_id, assessment_cycle_id, notification_type, message, channel)
         VALUES ($1, $2, $3, $4, 'IN_APP')
         RETURNING *`,
        [recipientTeacherId, assessmentCycleId || null, type, message]
    );
    return result.rows[0];
}

/**
 * Send the same notification to a batch of teachers (e.g. every
 * due/overdue professor in a cycle). Failures for one recipient are
 * collected rather than aborting the whole batch.
 */
async function sendBatch(recipientTeacherIds, { assessmentCycleId, type, message }) {
    const results = [];
    for (const recipientTeacherId of recipientTeacherIds) {
        try {
            const row = await send({ recipientTeacherId, assessmentCycleId, type, message });
            results.push({ recipientTeacherId, ok: true, notificationId: row.notification_id });
        } catch (err) {
            results.push({ recipientTeacherId, ok: false, error: err.message });
        }
    }
    return results;
}

module.exports = { send, sendBatch, NOTIFICATION_TYPES };
