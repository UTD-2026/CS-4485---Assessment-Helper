// Signup routes — mounted at /api/signups.
// "For now, we can assume that each Observee will sign up to be
// observed for just 1 course."

const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

/**
 * POST /api/signups
 * body: { assessmentCycleId, observeeTeacherId, courseSectionId }
 */
router.post('/', async (req, res, next) => {
    try {
        const { assessmentCycleId, observeeTeacherId, courseSectionId } = req.body || {};
        if (!assessmentCycleId || !observeeTeacherId || !courseSectionId) {
            return res.status(400).json({ error: 'assessmentCycleId, observeeTeacherId, and courseSectionId are required.' });
        }

        const sectionCheck = await query('SELECT instructor_id FROM course_section WHERE section_id = $1', [courseSectionId]);
        if (sectionCheck.rowCount === 0) {
            return res.status(404).json({ error: 'Course section not found.' });
        }
        if (sectionCheck.rows[0].instructor_id !== observeeTeacherId) {
            return res.status(400).json({ error: 'You can only sign up with a course section you are the instructor of record for.' });
        }

        const cycleCheck = await query('SELECT status FROM assessment_cycle WHERE assessment_cycle_id = $1', [assessmentCycleId]);
        if (cycleCheck.rowCount === 0) return res.status(404).json({ error: 'Assessment cycle not found.' });
        if (cycleCheck.rows[0].status !== 'OPEN_FOR_SIGNUP') {
            return res.status(409).json({ error: `Signup is closed for this cycle (status: ${cycleCheck.rows[0].status}).` });
        }

        const insertResult = await query(
            `INSERT INTO signup (assessment_cycle_id, observee_teacher_id, course_section_id)
             VALUES ($1, $2, $3) RETURNING *`,
            [assessmentCycleId, observeeTeacherId, courseSectionId]
        );
        res.status(201).json(insertResult.rows[0]);
    } catch (err) {
        if (err.code === '23505') { // unique_violation
            return res.status(409).json({ error: 'You have already signed up for this assessment cycle.' });
        }
        next(err);
    }
});

/**
 * GET /api/signups/:signupId/candidates
 * "For my selected course: the System should show the list of 5
 * possible Observers."
 */
router.get('/:signupId/candidates', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT oc.rank, t.teacher_id, t.full_name, t.email, t.department
             FROM observer_candidate oc
             JOIN teacher t ON t.teacher_id = oc.candidate_teacher_id
             WHERE oc.signup_id = $1
             ORDER BY oc.rank`,
            [req.params.signupId]
        );
        res.json({ candidates: result.rows });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
