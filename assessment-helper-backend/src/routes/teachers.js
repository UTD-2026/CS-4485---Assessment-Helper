// Teacher/Observee self-service views: due status, observation history,
// and teaching load (used to populate the signup course picker).
// Mounted at /api/teachers.

const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

/**
 * GET /api/teachers/:teacherId/evaluation-status
 * "The semester that I am due for observation."
 */
router.get('/:teacherId/evaluation-status', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT ec.status, ec.anniversary_term, ec.anniversary_year,
                    ac.assessment_cycle_id, ac.term, ac.year, ac.signup_deadline,
                    ac.observation_period_deadline, ac.survey_deadline
             FROM evaluation_cycle ec
             JOIN assessment_cycle ac ON ac.term = ec.term AND ac.year = ec.year
             WHERE ec.teacher_id = $1
             ORDER BY ac.year DESC, CASE ac.term WHEN 'FALL' THEN 2 WHEN 'SUMMER' THEN 1 ELSE 0 END DESC`,
            [req.params.teacherId]
        );
        res.json({ evaluationHistory: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/teachers/:teacherId/observations
 * "Observations that somebody gave me in the past semesters [and] that
 * somebody would give me this semester."
 */
router.get('/:teacherId/observations', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT oa.assignment_id, oa.status, oa.proposed_at, oa.confirmed_at, oa.submitted_at, oa.completed_at,
                    observer.teacher_id AS observer_teacher_id, observer.full_name AS observer_name,
                    cs.course_number, cs.section_number, cs.semester
             FROM observation_assignment oa
             JOIN teacher observer ON observer.teacher_id = oa.observer_teacher_id
             LEFT JOIN course_section cs ON cs.section_id = oa.course_section_id
             WHERE oa.observee_teacher_id = $1
             ORDER BY oa.proposed_at DESC`,
            [req.params.teacherId]
        );
        res.json({ observationsReceived: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/teachers/:teacherId/teaching-load?term=FALL&year=2026
 * "All the classes that I teach in that semester along with days & times."
 */
router.get('/:teacherId/teaching-load', async (req, res, next) => {
    try {
        const { term, year } = req.query;
        if (!term || !year) {
            return res.status(400).json({ error: 'term and year query parameters are required.' });
        }
        const result = await query(
            `SELECT section_id, course_number, course_title, section_number, meeting_days, start_time, end_time, department, course_level
             FROM course_section
             WHERE instructor_id = $1 AND term = $2 AND year = $3
             ORDER BY course_number, section_number`,
            [req.params.teacherId, term, year]
        );
        res.json({ sections: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/teachers/:teacherId/observer-requests
 * "Once the Signup deadline ends: I should be able to see all
 * observation requests with Other Observees' selected days/times.
 * Able to see all the accepted confirmations." (Observer's own view —
 * a convenience alias over /api/observation-requests/observer/:teacherId.)
 */
router.get('/:teacherId/observer-requests', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT r.request_id, r.status, r.requested_days, r.requested_time, r.created_at,
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

module.exports = router;
