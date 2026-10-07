// Step 7 (revised): Executive Dashboard KPI Aggregation Endpoints.
//
// Every route here takes an assessmentCycleId (query param, defaulting
// to the most recently created cycle) so KPIs are always reported for
// one specific semester, matching how the Assessment Committee actually
// works ("this semester's due list", "this semester's KPIs").
//
// evaluation_cycle is keyed by (teacher_id, term, year) rather than a
// surrogate ID (schema v3), so every query below resolves the requested
// assessment_cycle's (term, year) up front and joins/filters on that
// composite pair instead of a cycle_id.

const express = require('express');
const { query } = require('../config/db');
const { getDb } = require('../config/mongo');

const router = express.Router();

async function resolveAssessmentCycle(req) {
    const result = req.query.assessmentCycleId
        ? await query('SELECT * FROM assessment_cycle WHERE assessment_cycle_id = $1', [req.query.assessmentCycleId])
        : await query('SELECT * FROM assessment_cycle ORDER BY created_at DESC LIMIT 1');
    if (result.rowCount === 0) {
        const err = new Error('No matching assessment cycle exists.');
        err.statusCode = 404;
        throw err;
    }
    return result.rows[0]; // { assessment_cycle_id, term, year, ... }
}

/**
 * GET /api/admin/dashboard-stats/faculty-due-for-evaluation
 * "Faculty due for evaluation – breakdown based on hire-level."
 */
router.get('/faculty-due-for-evaluation', async (req, res, next) => {
    try {
        const cycle = await resolveAssessmentCycle(req);
        const result = await query(
            `SELECT t.hiring_level, ec.status, COUNT(*)::int AS teacher_count
             FROM evaluation_cycle ec
             JOIN teacher t ON t.teacher_id = ec.teacher_id
             WHERE ec.term = $1 AND ec.year = $2 AND ec.status IN ('DUE', 'OVERDUE')
             GROUP BY t.hiring_level, ec.status
             ORDER BY t.hiring_level, ec.status`,
            [cycle.term, cycle.year]
        );
        res.json({ assessmentCycleId: cycle.assessment_cycle_id, breakdown: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/dashboard-stats/overdue-evaluations
 * Overdue Evaluation Count + Evaluation Eligibility Accuracy.
 *
 * Eligibility Accuracy is computed from the matching engine's own
 * eligibility checks: every candidate the engine ever evaluated (per
 * signup) is either eligible or logged as one of the four violation
 * types (SAME_PROFESSOR, DIFFERENT_DEPARTMENT, DIFFERENT_LEVEL,
 * SCHEDULE_CONFLICT). Accuracy = eligible / (eligible + violations).
 */
router.get('/overdue-evaluations', async (req, res, next) => {
    try {
        const cycle = await resolveAssessmentCycle(req);

        const overdue = await query(
            `SELECT COUNT(*)::int AS overdue_count FROM evaluation_cycle WHERE term = $1 AND year = $2 AND status = 'OVERDUE'`,
            [cycle.term, cycle.year]
        );

        const eligibleTotals = await query(
            `SELECT COALESCE(SUM(s.total_eligible_count), 0)::int AS total_eligible
             FROM signup s WHERE s.assessment_cycle_id = $1`,
            [cycle.assessment_cycle_id]
        );
        const violationTotals = await query(
            `SELECT COUNT(*)::int AS total_violations
             FROM eligibility_violation_log v
             JOIN signup s ON s.signup_id = v.signup_id
             WHERE s.assessment_cycle_id = $1`,
            [cycle.assessment_cycle_id]
        );

        const totalEligible = eligibleTotals.rows[0].total_eligible;
        const totalViolations = violationTotals.rows[0].total_violations;
        const totalEvaluated = totalEligible + totalViolations;

        res.json({
            assessmentCycleId: cycle.assessment_cycle_id,
            overdueEvaluationCount: overdue.rows[0].overdue_count,
            evaluationEligibilityAccuracy: totalEvaluated === 0 ? 1 : Number((totalEligible / totalEvaluated).toFixed(4)),
            violationBreakdownAvailableAt: `/api/admin/dashboard-stats/eligibility-violations?assessmentCycleId=${cycle.assessment_cycle_id}`,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/dashboard-stats/eligibility-violations
 * Supporting detail for the accuracy KPI above — counts by violation type.
 */
router.get('/eligibility-violations', async (req, res, next) => {
    try {
        const cycle = await resolveAssessmentCycle(req);
        const result = await query(
            `SELECT v.violation_type, COUNT(*)::int AS count
             FROM eligibility_violation_log v
             JOIN signup s ON s.signup_id = v.signup_id
             WHERE s.assessment_cycle_id = $1
             GROUP BY v.violation_type
             ORDER BY count DESC`,
            [cycle.assessment_cycle_id]
        );
        res.json({ assessmentCycleId: cycle.assessment_cycle_id, byViolationType: result.rows });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/dashboard-stats/unmatched-faculty
 * "Unmatched faculty report": profs whose signup produced no/insufficient
 * observers, plus due/overdue profs who have not signed up at all.
 */
router.get('/unmatched-faculty', async (req, res, next) => {
    try {
        const cycle = await resolveAssessmentCycle(req);

        const insufficientMatches = await query(
            `SELECT s.signup_id, t.teacher_id, t.full_name, t.hiring_level, s.observer_candidate_count
             FROM signup s
             JOIN teacher t ON t.teacher_id = s.observee_teacher_id
             WHERE s.assessment_cycle_id = $1 AND s.has_sufficient_observers = FALSE
             ORDER BY s.observer_candidate_count ASC`,
            [cycle.assessment_cycle_id]
        );

        const notYetSignedUp = await query(
            `SELECT t.teacher_id, t.full_name, t.hiring_level, ec.status
             FROM evaluation_cycle ec
             JOIN teacher t ON t.teacher_id = ec.teacher_id
             WHERE ec.term = $1 AND ec.year = $2
               AND ec.status IN ('DUE', 'OVERDUE')
               AND NOT EXISTS (
                    SELECT 1 FROM signup s WHERE s.assessment_cycle_id = $3 AND s.observee_teacher_id = ec.teacher_id
               )
             ORDER BY t.hiring_level, t.full_name`,
            [cycle.term, cycle.year, cycle.assessment_cycle_id]
        );

        res.json({
            assessmentCycleId: cycle.assessment_cycle_id,
            noOrInsufficientObservers: insufficientMatches.rows,
            dueButNotSignedUp: notYetSignedUp.rows,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/dashboard-stats/outstanding-observations
 * "Outstanding Observation Report - breakdown based on hire-level" +
 * Missing Observation Count.
 */
router.get('/outstanding-observations', async (req, res, next) => {
    try {
        const cycle = await resolveAssessmentCycle(req);

        const byHiringLevel = await query(
            `SELECT t.hiring_level, oa.status, COUNT(*)::int AS count
             FROM observation_assignment oa
             JOIN teacher t ON t.teacher_id = oa.observee_teacher_id
             WHERE oa.term = $1 AND oa.year = $2 AND oa.status <> 'COMPLETED'
             GROUP BY t.hiring_level, oa.status
             ORDER BY t.hiring_level, oa.status`,
            [cycle.term, cycle.year]
        );

        // "# of approved observation appointments that did not go through
        // for some reason. Pair-confirmation should help determine this
        // portion" -> assignments that had reached CONFIRMED (the pair was
        // confirmed) but were later flagged could_not_complete.
        const missing = await query(
            `SELECT COUNT(*)::int AS missing_count
             FROM observation_assignment oa
             WHERE oa.term = $1 AND oa.year = $2 AND oa.could_not_complete = TRUE AND oa.confirmed_at IS NOT NULL`,
            [cycle.term, cycle.year]
        );

        res.json({
            assessmentCycleId: cycle.assessment_cycle_id,
            outstandingByHiringLevel: byHiringLevel.rows,
            missingObservationCount: missing.rows[0].missing_count,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/dashboard-stats/participation
 * Assessment Participation Rate + Observer Utilization Rate +
 * List Sufficiency Rate, all scoped to one assessment cycle.
 */
router.get('/participation', async (req, res, next) => {
    try {
        const cycle = await resolveAssessmentCycle(req);

        const due = await query(
            `SELECT COUNT(*)::int AS due_count FROM evaluation_cycle
             WHERE term = $1 AND year = $2 AND status IN ('DUE', 'OVERDUE', 'COMPLETED')`,
            [cycle.term, cycle.year]
        );
        const signedUp = await query(
            `SELECT COUNT(*)::int AS signup_count FROM signup WHERE assessment_cycle_id = $1`,
            [cycle.assessment_cycle_id]
        );
        const observers = await query(
            `SELECT COUNT(DISTINCT observer_teacher_id)::int AS observer_count
             FROM observation_assignment
             WHERE term = $1 AND year = $2`,
            [cycle.term, cycle.year]
        );
        const listSufficiency = await query(
            `SELECT COALESCE(AVG(observer_candidate_count), 0)::float AS avg_matches,
                    COALESCE(AVG(CASE WHEN has_sufficient_observers THEN 1 ELSE 0 END), 0)::float AS sufficient_rate
             FROM signup WHERE assessment_cycle_id = $1`,
            [cycle.assessment_cycle_id]
        );

        const dueCount = due.rows[0].due_count;
        const signupCount = signedUp.rows[0].signup_count;

        res.json({
            assessmentCycleId: cycle.assessment_cycle_id,
            assessmentParticipationRate: dueCount === 0 ? 0 : Number((signupCount / dueCount).toFixed(4)),
            observerUtilizationRate: signupCount === 0 ? 0 : Number((observers.rows[0].observer_count / signupCount).toFixed(4)),
            averageObserverMatchesPerSignup: Number(listSufficiency.rows[0].avg_matches.toFixed(2)),
            listSufficiencyRate: Number(listSufficiency.rows[0].sufficient_rate.toFixed(4)),
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/dashboard-stats/survey-completion
 * Survey Completion Rate: "Sign up AND Sent request(s) AND Had 1 request
 * confirmed AND Was observed AND took part in the final survey" i.e.
 * # of submitted surveys / # of signups.
 *
 * The survey collection has no stored relation to observation_assignment
 * (schema v3) — a survey is about the Observee's overall semester, not
 * one specific observation record — so the join here happens in
 * application code, matching purely on (respondentTeacherId, term, year).
 */
router.get('/survey-completion', async (req, res, next) => {
    try {
        const cycle = await resolveAssessmentCycle(req);

        const signupCountResult = await query('SELECT COUNT(*)::int AS c FROM signup WHERE assessment_cycle_id = $1', [cycle.assessment_cycle_id]);
        const signupCount = signupCountResult.rows[0].c;

        const completedAssignments = await query(
            `SELECT DISTINCT observee_teacher_id
             FROM observation_assignment
             WHERE term = $1 AND year = $2 AND status = 'COMPLETED'`,
            [cycle.term, cycle.year]
        );

        let surveyedCount = 0;
        if (completedAssignments.rowCount > 0) {
            const db = getDb();
            const observeeIds = completedAssignments.rows.map((r) => r.observee_teacher_id);

            const surveys = await db.collection('survey_responses')
                .find({ respondentTeacherId: { $in: observeeIds }, role: 'OBSERVEE', term: cycle.term, year: cycle.year })
                .project({ respondentTeacherId: 1 })
                .toArray();

            surveyedCount = new Set(surveys.map((doc) => doc.respondentTeacherId)).size;
        }

        res.json({
            assessmentCycleId: cycle.assessment_cycle_id,
            signupCount,
            surveyCompletionRate: signupCount === 0 ? 0 : Number((surveyedCount / signupCount).toFixed(4)),
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/dashboard-stats
 * Index of every KPI sub-route for a single dashboard page load.
 */
router.get('/', async (req, res) => {
    const base = req.baseUrl;
    res.json({
        message: 'Pass ?assessmentCycleId=<uuid> to any route below; omit it to use the most recently created cycle.',
        routes: [
            `${base}/faculty-due-for-evaluation`,
            `${base}/overdue-evaluations`,
            `${base}/eligibility-violations`,
            `${base}/unmatched-faculty`,
            `${base}/outstanding-observations`,
            `${base}/participation`,
            `${base}/survey-completion`,
        ],
    });
});

module.exports = router;
