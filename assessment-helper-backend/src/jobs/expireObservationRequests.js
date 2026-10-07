// Sweep job for stale observation requests (TA Q&A: 48-hour expiration).
//
// "Typical expectation is people respond within 48 hours. So, by that
// expectation, invitations should expire after 48 hours."
//
// routes/observationRequests.js's POST /:id/respond already catches the
// case where someone tries to answer a request that's already past its
// expires_at. This job is the other half: a request nobody ever
// responds to needs to flip to EXPIRED on its own, so it stops showing
// up as an outstanding invitation on the observer's dashboard and the
// Observee can see their pool of live requests shrink accordingly.
//
// Run on a schedule (cron / scheduled task runner) — e.g. hourly.
// Usage: node src/jobs/expireObservationRequests.js

require('dotenv').config();
const { pool, query } = require('../config/db');
const notificationService = require('../services/notificationService');

async function expireStaleRequests() {
    const staleResult = await query(
        `SELECT request_id, observer_teacher_id, signup_id
         FROM observation_request
         WHERE status = 'PENDING' AND expires_at < now()`
    );

    if (staleResult.rowCount === 0) {
        return { expiredCount: 0, requestIds: [] };
    }

    const requestIds = staleResult.rows.map((r) => r.request_id);

    await query(
        `UPDATE observation_request SET status = 'EXPIRED'
         WHERE request_id = ANY($1::uuid[])`,
        [requestIds]
    );

    for (const row of staleResult.rows) {
        await notificationService.send({
            recipientTeacherId: row.observer_teacher_id,
            type: 'REQUEST_EXPIRED',
            message: 'An observation request you did not respond to within 48 hours has expired.',
        });
    }

    return { expiredCount: requestIds.length, requestIds };
}

if (require.main === module) {
    expireStaleRequests()
        .then(async (summary) => {
            console.log('[expireObservationRequests] done:', summary);
            await pool.end();
            process.exit(0);
        })
        .catch((err) => {
            console.error('[expireObservationRequests] fatal error:', err);
            process.exit(1);
        });
}

module.exports = { expireStaleRequests };
