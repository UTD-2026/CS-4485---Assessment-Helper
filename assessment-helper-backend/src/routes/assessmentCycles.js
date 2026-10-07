// Assessment Committee (AC) routes.
//
// The AC facilitates evaluations by kicking off the process each
// semester, tracking the three deadlines (signup, observation period,
// survey), running Observer Selection after signups close, and sending
// reminder notifications. See README's "Assessment Committee workflow"
// section for the full state diagram.

const express = require('express');
const { query } = require('../config/db');
const { ensureEvaluationCyclesForAssessmentCycle } = require('../services/evaluationCycleService');
const { generateAndPersistCandidates } = require('../services/matchingService');
const notificationService = require('../services/notificationService');

const router = express.Router();

const STATUS_SEQUENCE = ['OPEN_FOR_SIGNUP', 'OBSERVER_SELECTION', 'OBSERVATION_PERIOD', 'SURVEY_PERIOD', 'CLOSED'];

async function requireAcMember(req, res, next) {
    const acTeacherId = req.header('X-Actor-Id');
    if (!acTeacherId) {
        return res.status(400).json({ error: 'X-Actor-Id header identifying the AC member is required.' });
    }
    const result = await query('SELECT teacher_id, is_ac_member FROM teacher WHERE teacher_id = $1', [acTeacherId]);
    if (result.rowCount === 0 || !result.rows[0].is_ac_member) {
        return res.status(403).json({ error: 'Only Assessment Committee members may perform this action.' });
    }
    req.acTeacherId = acTeacherId;
    next();
}

/**
 * evaluation_cycle and observation_assignment are keyed by (term, year),
 * not by assessment_cycle_id (schema v3), so several routes below need
 * the semester behind a given :id before they can query those tables.
 */
async function getCycleTermYear(assessmentCycleId) {
    const result = await query('SELECT term, year FROM assessment_cycle WHERE assessment_cycle_id = $1', [assessmentCycleId]);
    if (result.rowCount === 0) {
        const err = new Error('Assessment cycle not found.');
        err.statusCode = 404;
        throw err;
    }
    return result.rows[0];
}

/**
 * POST /api/assessment-cycles
 * body: { term: 'SPRING'|'SUMMER'|'FALL', year, signupDeadline, observationPeriodDeadline, surveyDeadline }
 * Kicks off a new semester-wide cycle and immediately computes every
 * active teacher's due/overdue status for it.
 */
router.post('/', requireAcMember, async (req, res, next) => {
    try {
        const { term, year, signupDeadline, observationPeriodDeadline, surveyDeadline } = req.body || {};
        if (!term || !year || !signupDeadline || !observationPeriodDeadline || !surveyDeadline) {
            return res.status(400).json({
                error: 'term, year, signupDeadline, observationPeriodDeadline, and surveyDeadline are required.',
            });
        }

        const insertResult = await query(
            `INSERT INTO assessment_cycle (term, year, signup_deadline, observation_period_deadline, survey_deadline, kicked_off_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [term, year, signupDeadline, observationPeriodDeadline, surveyDeadline, req.acTeacherId]
        );
        const assessmentCycle = insertResult.rows[0];

        const cycleResults = await ensureEvaluationCyclesForAssessmentCycle(assessmentCycle.assessment_cycle_id);

        res.status(201).json({ assessmentCycle, evaluationCyclesCreated: cycleResults.length });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/assessment-cycles/:id/advance-status
 * Moves the cycle to the next stage in OPEN_FOR_SIGNUP -> OBSERVER_SELECTION
 * -> OBSERVATION_PERIOD -> SURVEY_PERIOD -> CLOSED. Rejects skipping stages.
 */
router.post('/:id/advance-status', requireAcMember, async (req, res, next) => {
    try {
        const result = await query('SELECT * FROM assessment_cycle WHERE assessment_cycle_id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Assessment cycle not found.' });

        const current = result.rows[0];
        const currentIndex = STATUS_SEQUENCE.indexOf(current.status);
        if (currentIndex === STATUS_SEQUENCE.length - 1) {
            return res.status(409).json({ error: 'Cycle is already CLOSED.' });
        }
        const nextStatus = STATUS_SEQUENCE[currentIndex + 1];

        const updateResult = await query(
            'UPDATE assessment_cycle SET status = $1 WHERE assessment_cycle_id = $2 RETURNING *',
            [nextStatus, req.params.id]
        );
        res.json(updateResult.rows[0]);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/assessment-cycles/:id/due-report
 * "Have the ability to see the list of Professors who are due & overdue
 * this semester" — broken down by hiring level for the executive
 * dashboard's "Faculty due for evaluation" view.
 */
router.get('/:id/due-report', async (req, res, next) => {
    try {
        const { term, year } = await getCycleTermYear(req.params.id);
        const result = await query(
            `SELECT t.teacher_id, t.full_name, t.email, t.hiring_level, ec.status
             FROM evaluation_cycle ec
             JOIN teacher t ON t.teacher_id = ec.teacher_id
             WHERE ec.term = $1 AND ec.year = $2 AND ec.status IN ('DUE', 'OVERDUE')
             ORDER BY t.hiring_level, ec.status, t.full_name`,
            [term, year]
        );
        res.json({ faculty: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/assessment-cycles/:id/send-due-reminders
 * body: { reminderType: 'DUE_REMINDER' | 'OVERDUE_REMINDER' }
 * "Should be able to send notification/email reminding the above Profs
 * about whether they are due or over-due."
 */
router.post('/:id/send-due-reminders', requireAcMember, async (req, res, next) => {
    try {
        const { reminderType } = req.body || {};
        const targetStatus = reminderType === 'OVERDUE_REMINDER' ? 'OVERDUE' : 'DUE';

        const { term, year } = await getCycleTermYear(req.params.id);
        const result = await query(
            `SELECT teacher_id FROM evaluation_cycle WHERE term = $1 AND year = $2 AND status = $3`,
            [term, year, targetStatus]
        );
        const recipientIds = result.rows.map((r) => r.teacher_id);

        const message = targetStatus === 'OVERDUE'
            ? 'Your teaching evaluation is now overdue. Please sign up as soon as possible.'
            : 'You are due for a teaching evaluation this semester. Please sign up before the deadline.';

        const sendResults = await notificationService.sendBatch(recipientIds, {
            assessmentCycleId: req.params.id,
            type: targetStatus === 'OVERDUE' ? 'OVERDUE_REMINDER' : 'DUE_REMINDER',
            message,
        });

        res.json({ recipientCount: recipientIds.length, sendResults });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/assessment-cycles/:id/signups
 * "Should be able to see all the signup requests, which should have
 * Course #, Section#, Meeting days & time, Observee Name, Observee email ID."
 */
router.get('/:id/signups', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT s.signup_id, s.status, s.observer_candidate_count, s.has_sufficient_observers,
                    t.teacher_id AS observee_teacher_id, t.full_name AS observee_name, t.email AS observee_email,
                    cs.course_number, cs.section_number, cs.meeting_days, cs.start_time, cs.end_time
             FROM signup s
             JOIN teacher t ON t.teacher_id = s.observee_teacher_id
             JOIN course_section cs ON cs.section_id = s.course_section_id
             WHERE s.assessment_cycle_id = $1
             ORDER BY t.full_name`,
            [req.params.id]
        );
        res.json({ signups: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/assessment-cycles/:id/run-observer-selection
 * "After signup deadline is over, AC should be able to click a button to
 * do Observer Selection." Generates the eligible-observer candidate
 * list for every still-SUBMITTED signup in this cycle.
 */
router.post('/:id/run-observer-selection', requireAcMember, async (req, res, next) => {
    try {
        const signupsResult = await query(
            `SELECT signup_id FROM signup WHERE assessment_cycle_id = $1 AND status = 'SUBMITTED'`,
            [req.params.id]
        );

        const results = [];
        for (const { signup_id: signupId } of signupsResult.rows) {
            try {
                const outcome = await generateAndPersistCandidates(signupId);
                results.push(outcome);
            } catch (err) {
                results.push({ signupId, error: err.message });
            }
        }

        await query(`UPDATE assessment_cycle SET status = 'OBSERVER_SELECTION' WHERE assessment_cycle_id = $1`, [req.params.id]);

        res.json({
            processed: results.length,
            insufficientCount: results.filter((r) => r.isSufficient === false).length,
            results,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/assessment-cycles/:id/insufficient-observers
 * "System should show the ALERT for Observees with NO / insufficient
 * Observers."
 */
router.get('/:id/insufficient-observers', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT s.signup_id, s.observer_candidate_count, t.teacher_id, t.full_name, t.email
             FROM signup s
             JOIN teacher t ON t.teacher_id = s.observee_teacher_id
             WHERE s.assessment_cycle_id = $1 AND s.has_sufficient_observers = FALSE
             ORDER BY s.observer_candidate_count ASC`,
            [req.params.id]
        );
        res.json({ alertCount: result.rowCount, signups: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/assessment-cycles/:id/notify-observer-lists-ready
 * "System should show each Observee signup and the corresponding list of
 * 5 Observers and a Button to send notifications to each Observee that
 * their list is ready."
 */
router.post('/:id/notify-observer-lists-ready', requireAcMember, async (req, res, next) => {
    try {
        const result = await query(
            `SELECT s.signup_id, s.observee_teacher_id
             FROM signup s
             WHERE s.assessment_cycle_id = $1 AND s.status = 'OBSERVERS_GENERATED' AND s.has_sufficient_observers = TRUE`,
            [req.params.id]
        );

        const sendResults = await notificationService.sendBatch(
            result.rows.map((r) => r.observee_teacher_id),
            {
                assessmentCycleId: req.params.id,
                type: 'OBSERVER_LIST_READY',
                message: 'Your observer candidate list is ready. Please review and send requests before the observation-period deadline.',
            }
        );

        res.json({ notified: sendResults.length, sendResults });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/assessment-cycles/:id/notify-survey
 * "After observation-period deadline is over, AC should be able to send
 * notification to all Observees requesting them to take part in the
 * end-of-process survey."
 */
router.post('/:id/notify-survey', requireAcMember, async (req, res, next) => {
    try {
        const { term, year } = await getCycleTermYear(req.params.id);
        const result = await query(
            `SELECT DISTINCT observee_teacher_id
             FROM observation_assignment
             WHERE term = $1 AND year = $2 AND status IN ('SUBMITTED', 'COMPLETED')`,
            [term, year]
        );

        const sendResults = await notificationService.sendBatch(
            result.rows.map((r) => r.observee_teacher_id),
            {
                assessmentCycleId: req.params.id,
                type: 'SURVEY_REMINDER',
                message: 'Please complete the end-of-process survey before the survey deadline.',
            }
        );

        await query(`UPDATE assessment_cycle SET status = 'SURVEY_PERIOD' WHERE assessment_cycle_id = $1`, [req.params.id]);

        res.json({ notified: sendResults.length, sendResults });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
