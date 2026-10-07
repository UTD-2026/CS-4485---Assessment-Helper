// Step 6: Observation workflow endpoints.
//
// POST /api/observations                    — create a PROPOSED assignment
// POST /api/observations/:id/transition      — move an assignment through
//                                               the state machine, with
//                                               guard clauses + audit log
// GET  /api/observations/:id/history         — read the full audit trail

const express = require('express');
const { getClient, query } = require('../config/db');
const { requireActor, recordTransition } = require('../middleware/auditLog');
const { assertValidTransition, timestampColumnFor, InvalidTransitionError } = require('../services/observationStateMachine');
const { markEvaluationCycleCompleted } = require('../services/evaluationCycleService');
const observationRecordService = require('../services/observationRecordService');

const router = express.Router();

/**
 * POST /api/observations
 * body: { observeeTeacherId, term, year, observerTeacherId, courseSectionId? }
 * Creates a brand-new assignment in the PROPOSED state (the only valid
 * starting state in the pipeline). This is a manual/AC-override path —
 * the normal path is POST /api/observation-requests/:id/select, which
 * creates the assignment from a confirmed request automatically.
 */
router.post('/', requireActor, async (req, res, next) => {
    const { observeeTeacherId, term, year, observerTeacherId, courseSectionId } = req.body || {};

    if (!observeeTeacherId || !term || !year || !observerTeacherId) {
        return res.status(400).json({ error: 'observeeTeacherId, term, year, and observerTeacherId are required.' });
    }
    if (observeeTeacherId === observerTeacherId) {
        return res.status(400).json({ error: 'observeeTeacherId and observerTeacherId must be different teachers.' });
    }

    const client = await getClient();
    try {
        await client.query('BEGIN');

        const cycleCheck = await client.query(
            'SELECT 1 FROM evaluation_cycle WHERE teacher_id = $1 AND term = $2 AND year = $3',
            [observeeTeacherId, term, year]
        );
        if (cycleCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'No evaluation_cycle found for this observee/semester — run kickoff first.' });
        }

        const insertResult = await client.query(
            `INSERT INTO observation_assignment
                (term, year, observee_teacher_id, observer_teacher_id, course_section_id, status)
             VALUES ($1,$2,$3,$4,$5,'PROPOSED')
             RETURNING *`,
            [term, year, observeeTeacherId, observerTeacherId, courseSectionId || null]
        );
        const assignment = insertResult.rows[0];

        await recordTransition(client, {
            assignmentId: assignment.assignment_id,
            changedBy: req.actorId,
            fromStatus: null,
            toStatus: 'PROPOSED',
            note: 'Assignment created.',
        });

        await client.query('COMMIT');
        res.status(201).json(assignment);
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

/**
 * POST /api/observations/:id/transition
 * body: { toStatus: 'CONFIRMED' | 'SUBMITTED' | 'COMPLETED' | 'CANCELLED', note? }
 *
 * Applies a guarded state transition inside a single DB transaction:
 * 1. Lock and read the current row (FOR UPDATE) to avoid a race between
 *    two concurrent transition requests.
 * 2. Validate the transition against the state machine.
 * 3. Update status (+ the relevant timestamp column) and write the audit
 *    row. Both happen in the same transaction, so a crash between them
 *    is impossible — either the whole transition commits or none of it does.
 */
router.post('/:id/transition', requireActor, async (req, res, next) => {
    const { id } = req.params;
    const { toStatus, note } = req.body || {};

    if (!toStatus) {
        return res.status(400).json({ error: 'toStatus is required.' });
    }

    const client = await getClient();
    try {
        await client.query('BEGIN');

        const current = await client.query(
            'SELECT * FROM observation_assignment WHERE assignment_id = $1 FOR UPDATE',
            [id]
        );
        if (current.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: `Observation assignment ${id} not found.` });
        }

        const fromStatus = current.rows[0].status;
        assertValidTransition(fromStatus, toStatus); // throws InvalidTransitionError on violation

        const timestampColumn = timestampColumnFor(toStatus);
        const setClause = timestampColumn
            ? `status = $1, ${timestampColumn} = now()`
            : 'status = $1';

        const updateResult = await client.query(
            `UPDATE observation_assignment SET ${setClause} WHERE assignment_id = $2 RETURNING *`,
            [toStatus, id]
        );

        await recordTransition(client, {
            assignmentId: id,
            changedBy: req.actorId,
            fromStatus,
            toStatus,
            note,
        });

        // "Once an Observation happens... Our signatures indicate that an
        // Observation actually happened" — reaching COMPLETED closes out
        // the teacher's evaluation_cycle for this semester too.
        if (toStatus === 'COMPLETED') {
            await markEvaluationCycleCompleted(current.rows[0].observee_teacher_id, current.rows[0].term, current.rows[0].year, client);
        }

        await client.query('COMMIT');
        res.json(updateResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof InvalidTransitionError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        next(err);
    } finally {
        client.release();
    }
});

/**
 * POST /api/observations/:id/sign
 * body: { role: 'OBSERVEE' | 'OBSERVER' }
 *
 * "They have a copy of the observation template... I have to sign it,
 * the Observer also signs it. Our signatures indicate that an
 * Observation actually happened, irrespective of whether I agree with
 * the ratings that the Observer gave." Records one party's signature
 * timestamp; either party may sign in either order. No file upload is
 * required here — the signed artifact IS the in-app observation_records
 * document (see observationRecordService); an Observee who wants to
 * attach something does so on their end-of-process survey instead (see
 * Mongo's survey_responses).
 *
 * "Once an observation is signed, NOBODY gets to edit it" — so the first
 * signature (by either party) locks the observation_records document
 * for this assignment. Locking is idempotent, so a second signature
 * just leaves it locked.
 */
router.post('/:id/sign', requireActor, async (req, res, next) => {
    try {
        const { role } = req.body || {};
        if (!['OBSERVEE', 'OBSERVER'].includes(role)) {
            return res.status(400).json({ error: "role must be 'OBSERVEE' or 'OBSERVER'." });
        }
        const column = role === 'OBSERVEE' ? 'observee_signed_at' : 'observer_signed_at';

        const result = await query(
            `UPDATE observation_assignment SET ${column} = now() WHERE assignment_id = $1 RETURNING *`,
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Observation assignment not found.' });

        await observationRecordService.lockRecord(req.params.id);

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/observations/:id/record
 * body: { formId, criteriaValues? }
 * Creates the in-app observation record for this assignment, snapshotting
 * the given evaluation form's current title/version/fields. This is what
 * gives the Observer "a copy of the Observation Template" to take notes
 * directly in, per the TA Q&A.
 */
router.post('/:id/record', requireActor, async (req, res, next) => {
    try {
        const { formId, criteriaValues } = req.body || {};
        if (!formId) {
            return res.status(400).json({ error: 'formId is required.' });
        }
        const record = await observationRecordService.createRecord(req.params.id, formId, criteriaValues || {});
        res.status(201).json(record);
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        next(err);
    }
});

/**
 * PUT /api/observations/:id/record
 * body: { criteriaValues }
 * Updates the Observer's notes on an unsigned record. 409s once the
 * record is locked — "Once an observation is signed, NOBODY gets to
 * edit it."
 */
router.put('/:id/record', requireActor, async (req, res, next) => {
    try {
        const { criteriaValues } = req.body || {};
        if (!criteriaValues || typeof criteriaValues !== 'object') {
            return res.status(400).json({ error: 'criteriaValues object is required.' });
        }
        const record = await observationRecordService.updateRecord(req.params.id, criteriaValues);
        res.json(record);
    } catch (err) {
        if (err instanceof observationRecordService.RecordLockedError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        next(err);
    }
});

/**
 * GET /api/observations/:id/record
 * Returns the in-app observation record (template copy + notes) for an
 * assignment — the "In-app view of copy of the Observation Template"
 * required by the TA Q&A.
 */
router.get('/:id/record', async (req, res, next) => {
    try {
        const record = await observationRecordService.getRecord(req.params.id);
        if (!record) return res.status(404).json({ error: 'No observation record found for this assignment.' });
        res.json(record);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/observations/:id/could-not-complete
 * body: { reason: string }
 *
 * "IF, by any chance, the observation could not be done within that
 * cycle, I, as the Observee, should have the ability to update the
 * System." Flags the assignment and cancels it via the state machine
 * (CANCELLED is reachable from every non-terminal state), preserving
 * the reason for the Missing Observation Count KPI.
 */
router.post('/:id/could-not-complete', requireActor, async (req, res, next) => {
    const client = await getClient();
    try {
        const { reason } = req.body || {};
        await client.query('BEGIN');

        const current = await client.query('SELECT * FROM observation_assignment WHERE assignment_id = $1 FOR UPDATE', [req.params.id]);
        if (current.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Observation assignment not found.' });
        }
        const fromStatus = current.rows[0].status;
        assertValidTransition(fromStatus, 'CANCELLED');

        const updateResult = await client.query(
            `UPDATE observation_assignment
             SET status = 'CANCELLED', could_not_complete = TRUE, could_not_complete_reason = $2
             WHERE assignment_id = $1 RETURNING *`,
            [req.params.id, reason || null]
        );

        await recordTransition(client, {
            assignmentId: req.params.id,
            changedBy: req.actorId,
            fromStatus,
            toStatus: 'CANCELLED',
            note: reason ? `Could not complete: ${reason}` : 'Marked could-not-complete by Observee.',
        });

        await client.query('COMMIT');
        res.json(updateResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof InvalidTransitionError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        next(err);
    } finally {
        client.release();
    }
});

/**
 * GET /api/observations/:id/history
 * Returns the append-only audit trail for one assignment, oldest first —
 * "who changed what state and when."
 */
router.get('/:id/history', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT audit_id, assignment_id, changed_by, from_status, to_status, note, changed_at
             FROM observation_audit_log
             WHERE assignment_id = $1
             ORDER BY changed_at ASC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
