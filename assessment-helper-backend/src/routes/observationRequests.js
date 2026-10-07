// Observation-request workflow: the Observee sends requests to some or
// all of their 5 candidate observers; each candidate confirms or
// declines; once at least one has confirmed, the Observee selects
// exactly one, which materializes the final observation_assignment
// (and the system sends graceful declines to everyone else).

const express = require('express');
const { query, getClient } = require('../config/db');
const { evaluateEligibility } = require('../services/eligibilityService');
const { recordTransition } = require('../middleware/auditLog');
const notificationService = require('../services/notificationService');

const router = express.Router();

/**
 * POST /api/observation-requests
 * body: { signupId, observerTeacherIds: string[] }
 *
 * "the functionality to choose all or a subset of people from this list
 * to send a request (that request should show my selected days/times
 * and these dates should be before the observation-period deadline)."
 * Re-validates eligibility for every requested observer as a defense-
 * in-depth check (candidates should already be eligible, but a stale
 * candidate list — e.g. the observer's schedule changed — is logged
 * rather than silently accepted).
 */
router.post('/', async (req, res, next) => {
    try {
        const { signupId, observerTeacherIds } = req.body || {};
        if (!signupId || !Array.isArray(observerTeacherIds) || observerTeacherIds.length === 0) {
            return res.status(400).json({ error: 'signupId and a non-empty observerTeacherIds array are required.' });
        }

        const signupResult = await query(
            `SELECT s.signup_id, s.observee_teacher_id, s.status,
                    cs.department, cs.course_level, cs.meeting_days, cs.start_time, cs.end_time, cs.term, cs.year
             FROM signup s
             JOIN course_section cs ON cs.section_id = s.course_section_id
             WHERE s.signup_id = $1`,
            [signupId]
        );
        if (signupResult.rowCount === 0) return res.status(404).json({ error: 'Signup not found.' });
        const signup = signupResult.rows[0];

        const observeeResult = await query('SELECT teacher_id, full_name FROM teacher WHERE teacher_id = $1', [signup.observee_teacher_id]);
        const observee = observeeResult.rows[0];

        const created = [];
        const rejected = [];

        for (const observerTeacherId of observerTeacherIds) {
            const candidateResult = await query('SELECT teacher_id, full_name, department FROM teacher WHERE teacher_id = $1', [observerTeacherId]);
            if (candidateResult.rowCount === 0) {
                rejected.push({ observerTeacherId, reason: 'TEACHER_NOT_FOUND' });
                continue;
            }
            const candidateSectionsResult = await query(
                `SELECT course_level, meeting_days, start_time, end_time FROM course_section
                 WHERE instructor_id = $1 AND term = $2 AND year = $3`,
                [observerTeacherId, signup.term, signup.year]
            );

            const { eligible, violation } = evaluateEligibility({
                observee,
                candidate: candidateResult.rows[0],
                courseSection: signup,
                candidateSections: candidateSectionsResult.rows,
            });

            if (!eligible) {
                await query(
                    `INSERT INTO eligibility_violation_log (signup_id, attempted_observer_id, violation_type, context)
                     VALUES ($1, $2, $3, 'Rejected at request-creation time (stale candidate list)')`,
                    [signupId, observerTeacherId, violation]
                );
                rejected.push({ observerTeacherId, reason: violation });
                continue;
            }

            try {
                const insertResult = await query(
                    `INSERT INTO observation_request (signup_id, observer_teacher_id, requested_days, requested_start_time, requested_end_time)
                     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                    [signupId, observerTeacherId, signup.meeting_days, signup.start_time, signup.end_time]
                );
                created.push(insertResult.rows[0]);
                await notificationService.send({
                    recipientTeacherId: observerTeacherId,
                    type: 'REQUEST_RECEIVED',
                    message: `${observee.full_name} has requested you as an observer.`,
                });
            } catch (err) {
                if (err.code === '23505') {
                    rejected.push({ observerTeacherId, reason: 'DUPLICATE_REQUEST' });
                } else {
                    throw err;
                }
            }
        }

        if (created.length > 0) {
            await query(`UPDATE signup SET status = 'REQUESTS_SENT' WHERE signup_id = $1`, [signupId]);
        }

        res.status(201).json({ created, rejected });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/observation-requests/observer/:teacherId
 * "Once the Signup deadline ends: I should be able to see all
 * observation requests with Other Observees' selected days/times."
 */
router.get('/observer/:teacherId', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT r.request_id, r.status, r.requested_days, r.requested_start_time, r.requested_end_time, r.expires_at, r.created_at,
                    observee.teacher_id AS observee_teacher_id, observee.full_name AS observee_name,
                    cs.course_number, cs.section_number
             FROM observation_request r
             JOIN signup s ON s.signup_id = r.signup_id
             JOIN teacher observee ON observee.teacher_id = s.observee_teacher_id
             JOIN course_section cs ON cs.section_id = s.course_section_id
             WHERE r.observer_teacher_id = $1
             ORDER BY r.created_at DESC`,
            [req.params.teacherId]
        );
        res.json({ requests: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/observation-requests/:id/respond
 * body: { response: 'CONFIRM' | 'DECLINE' }
 * "Able to confirm 1 or 2 or 3 observation requests."
 *
 * TA Q&A updates baked in here:
 * - "Typical expectation is people respond within 48 hours ... invitations
 *   should expire after 48 hours." A PENDING request past its expires_at
 *   is lazily flipped to EXPIRED and the response is rejected (410) — the
 *   sweep job (src/jobs/expireObservationRequests.js) catches requests
 *   nobody ever responds to; this is the belt for the one somebody tries
 *   to answer right after expiring.
 * - "once the Observee gets a confirmation, the system should
 *   automatically send a graceful cancellation email to the other
 *   observers in that subset." The first CONFIRM auto-cancels every
 *   other still-PENDING request for the same signup, in the same
 *   transaction, and each cancelled observer gets a notification.
 */
router.post('/:id/respond', async (req, res, next) => {
    const { response } = req.body || {};
    if (!['CONFIRM', 'DECLINE'].includes(response)) {
        return res.status(400).json({ error: "response must be 'CONFIRM' or 'DECLINE'." });
    }

    const client = await getClient();
    try {
        await client.query('BEGIN');

        const requestResult = await client.query('SELECT * FROM observation_request WHERE request_id = $1 FOR UPDATE', [req.params.id]);
        if (requestResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Request not found.' });
        }
        const request = requestResult.rows[0];

        if (request.status === 'PENDING' && new Date(request.expires_at) < new Date()) {
            await client.query(`UPDATE observation_request SET status = 'EXPIRED' WHERE request_id = $1`, [req.params.id]);
            await client.query('COMMIT');
            return res.status(410).json({ error: 'This request expired 48 hours after it was sent and can no longer be answered.' });
        }

        if (request.status !== 'PENDING') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `Request already has status ${request.status}.` });
        }

        const newStatus = response === 'CONFIRM' ? 'OBSERVER_CONFIRMED' : 'OBSERVER_DECLINED';
        const updateResult = await client.query(
            `UPDATE observation_request SET status = $1, responded_at = now() WHERE request_id = $2 RETURNING *`,
            [newStatus, req.params.id]
        );

        let autoCancelledObserverIds = [];
        let observeeTeacherId = null;

        if (newStatus === 'OBSERVER_CONFIRMED') {
            const signupResult = await client.query('SELECT observee_teacher_id FROM signup WHERE signup_id = $1', [request.signup_id]);
            observeeTeacherId = signupResult.rows[0].observee_teacher_id;
            await client.query(`UPDATE signup SET status = 'OBSERVER_CONFIRMED' WHERE signup_id = $1`, [request.signup_id]);

            const cancelResult = await client.query(
                `UPDATE observation_request SET status = 'CANCELLED', responded_at = now()
                 WHERE signup_id = $1 AND request_id <> $2 AND status = 'PENDING'
                 RETURNING observer_teacher_id`,
                [request.signup_id, request.request_id]
            );
            autoCancelledObserverIds = cancelResult.rows.map((r) => r.observer_teacher_id);
        }

        await client.query('COMMIT');

        if (newStatus === 'OBSERVER_CONFIRMED') {
            await notificationService.send({
                recipientTeacherId: observeeTeacherId,
                type: 'REQUEST_CONFIRMED',
                message: 'An observer has confirmed your observation request. Please select your final observer.',
            });
            for (const observerId of autoCancelledObserverIds) {
                await notificationService.send({
                    recipientTeacherId: observerId,
                    type: 'REQUEST_DECLINED',
                    message: 'Thank you for your time — the Observee already received a confirmation from another observer for this request.',
                });
            }
        }

        res.json({ ...updateResult.rows[0], autoCancelledCount: autoCancelledObserverIds.length });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        next(err);
    } finally {
        client.release();
    }
});

/**
 * POST /api/observation-requests/:id/select
 * "IF a request is confirmed by 1 or more Observers, then the System
 * should give me the ability to accept one of them AND send graceful
 * declines to others... the system should remember my choice of
 * confirmed Observer." This is the single point where an
 * observation_assignment (and the Step-6 state machine) is created.
 */
router.post('/:id/select', async (req, res, next) => {
    const client = await getClient();
    try {
        await client.query('BEGIN');

        const requestResult = await client.query(
            `SELECT r.*, s.observee_teacher_id, s.course_section_id, s.assessment_cycle_id, ac.term, ac.year
             FROM observation_request r
             JOIN signup s ON s.signup_id = r.signup_id
             JOIN assessment_cycle ac ON ac.assessment_cycle_id = s.assessment_cycle_id
             WHERE r.request_id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (requestResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Request not found.' });
        }
        const selected = requestResult.rows[0];
        if (selected.status !== 'OBSERVER_CONFIRMED') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Only a confirmed request can be selected.' });
        }

        // Confirm this teacher's evaluation_cycle row exists for this
        // semester — evaluation_cycle is now keyed naturally by
        // (teacher_id, term, year), so there's no surrogate cycle_id to
        // look up, just a existence check.
        const cycleResult = await client.query(
            `SELECT 1 FROM evaluation_cycle WHERE teacher_id = $1 AND term = $2 AND year = $3`,
            [selected.observee_teacher_id, selected.term, selected.year]
        );
        if (cycleResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'No evaluation_cycle found for this observee/semester — run kickoff first.' });
        }

        // Create the assignment (state machine starts at PROPOSED, then
        // immediately advances to CONFIRMED since the observer already
        // committed during the request stage).
        const assignmentResult = await client.query(
            `INSERT INTO observation_assignment
                (term, year, signup_id, source_request_id, observee_teacher_id, observer_teacher_id, course_section_id, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'PROPOSED') RETURNING *`,
            [selected.term, selected.year, selected.signup_id, selected.request_id, selected.observee_teacher_id, selected.observer_teacher_id, selected.course_section_id]
        );
        const assignment = assignmentResult.rows[0];

        await recordTransition(client, {
            assignmentId: assignment.assignment_id,
            changedBy: selected.observee_teacher_id,
            fromStatus: null,
            toStatus: 'PROPOSED',
            note: 'Created from a confirmed observation_request.',
        });
        await client.query(
            `UPDATE observation_assignment SET status = 'CONFIRMED', confirmed_at = now() WHERE assignment_id = $1`,
            [assignment.assignment_id]
        );
        await recordTransition(client, {
            assignmentId: assignment.assignment_id,
            changedBy: selected.observee_teacher_id,
            fromStatus: 'PROPOSED',
            toStatus: 'CONFIRMED',
            note: 'Observee selected this observer from their confirmed requests.',
        });

        await client.query(`UPDATE observation_request SET status = 'SELECTED' WHERE request_id = $1`, [selected.request_id]);

        // Gracefully decline every other request for this signup.
        const othersResult = await client.query(
            `UPDATE observation_request SET status = 'NOT_SELECTED'
             WHERE signup_id = $1 AND request_id <> $2 AND status IN ('PENDING', 'OBSERVER_CONFIRMED')
             RETURNING observer_teacher_id`,
            [selected.signup_id, selected.request_id]
        );

        await client.query(`UPDATE signup SET status = 'COMPLETED' WHERE signup_id = $1`, [selected.signup_id]);

        await client.query('COMMIT');

        for (const { observer_teacher_id: otherObserverId } of othersResult.rows) {
            await notificationService.send({
                recipientTeacherId: otherObserverId,
                type: 'REQUEST_DECLINED',
                message: 'Thank you for confirming — the Observee selected a different observer for this cycle.',
            });
        }

        res.json({ assignment, declinedOthers: othersResult.rowCount });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

module.exports = router;
