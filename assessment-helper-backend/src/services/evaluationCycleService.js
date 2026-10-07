// Evaluation-cycle service: turns the pure math in dueStatusCalculator
// into persisted evaluation_cycle rows, one per (teacher, assessment
// cycle). Called when an AC member kicks off a new semester cycle, and
// again whenever an observation_assignment reaches COMPLETED (to flip
// the corresponding evaluation_cycle's status).

const { query } = require('../config/db');
const { calculateDueStatus, approximateTermFromDate } = require('./dueStatusCalculator');

/**
 * The most recent semester in which this teacher COMPLETED an
 * evaluation, used as the baseline for the next due-date calculation.
 * Falls back to an approximation of their hire semester if they have
 * never completed one. Orders by the full (year, term-within-year)
 * ordinal — not just year — since a plain term-name comparison can't
 * tell SPRING/SUMMER/FALL apart correctly.
 */
async function getBaselineSemester(teacherId) {
    const result = await query(
        `SELECT ec.anniversary_term, ec.anniversary_year
         FROM evaluation_cycle ec
         WHERE ec.teacher_id = $1 AND ec.status = 'COMPLETED'
         ORDER BY ec.anniversary_year DESC,
                  CASE ec.anniversary_term WHEN 'FALL' THEN 2 WHEN 'SUMMER' THEN 1 ELSE 0 END DESC
         LIMIT 1`,
        [teacherId]
    );
    if (result.rowCount > 0) {
        return { term: result.rows[0].anniversary_term, year: result.rows[0].anniversary_year };
    }

    const teacherResult = await query('SELECT hire_date FROM teacher WHERE teacher_id = $1', [teacherId]);
    if (teacherResult.rowCount === 0) {
        throw new Error(`Teacher ${teacherId} not found`);
    }
    return approximateTermFromDate(teacherResult.rows[0].hire_date);
}

async function getActiveSchedulingRule(hiringLevel) {
    const result = await query(
        `SELECT * FROM scheduling_rule WHERE hiring_level = $1 AND is_active = TRUE LIMIT 1`,
        [hiringLevel]
    );
    if (result.rowCount === 0) {
        throw new Error(`No active scheduling_rule configured for hiring level ${hiringLevel}`);
    }
    return result.rows[0];
}

/**
 * Compute and upsert the evaluation_cycle row for one teacher within one
 * assessment cycle (semester). Idempotent — safe to call repeatedly
 * (e.g. once at kickoff, and again any time the AC wants a refreshed
 * due/overdue snapshot).
 */
async function ensureEvaluationCycle(teacherId, assessmentCycle) {
    const teacherResult = await query('SELECT hiring_level FROM teacher WHERE teacher_id = $1', [teacherId]);
    if (teacherResult.rowCount === 0) throw new Error(`Teacher ${teacherId} not found`);
    const { hiring_level: hiringLevel } = teacherResult.rows[0];

    const rule = await getActiveSchedulingRule(hiringLevel);
    const baseline = await getBaselineSemester(teacherId);
    const { status, anniversary } = calculateDueStatus(
        baseline,
        rule.years_between_evaluations,
        rule.due_window_terms,
        { term: assessmentCycle.term, year: assessmentCycle.year }
    );

    const result = await query(
        `INSERT INTO evaluation_cycle (teacher_id, term, year, rule_id, anniversary_term, anniversary_year, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (teacher_id, term, year)
         DO UPDATE SET rule_id = EXCLUDED.rule_id,
                        anniversary_term = EXCLUDED.anniversary_term,
                        anniversary_year = EXCLUDED.anniversary_year,
                        status = CASE WHEN evaluation_cycle.status = 'COMPLETED' THEN evaluation_cycle.status ELSE EXCLUDED.status END
         RETURNING *`,
        [teacherId, assessmentCycle.term, assessmentCycle.year, rule.rule_id, anniversary.term, anniversary.year, status]
    );
    return result.rows[0];
}

/**
 * Run ensureEvaluationCycle for every active teacher — this is what
 * happens when an AC member kicks off a new semester-wide
 * assessment_cycle.
 */
async function ensureEvaluationCyclesForAssessmentCycle(assessmentCycleId) {
    const cycleResult = await query('SELECT * FROM assessment_cycle WHERE assessment_cycle_id = $1', [assessmentCycleId]);
    if (cycleResult.rowCount === 0) throw new Error(`Assessment cycle ${assessmentCycleId} not found`);
    const assessmentCycle = cycleResult.rows[0];

    const teachersResult = await query('SELECT teacher_id FROM teacher WHERE is_active = TRUE');
    const results = [];
    for (const { teacher_id: teacherId } of teachersResult.rows) {
        try {
            const row = await ensureEvaluationCycle(teacherId, assessmentCycle);
            results.push(row);
        } catch (err) {
            results.push({ teacher_id: teacherId, error: err.message });
        }
    }
    return results;
}

/**
 * Flip an evaluation_cycle to COMPLETED once its tied
 * observation_assignment reaches COMPLETED. Called from the
 * observations.js transition route. evaluation_cycle is keyed by
 * (teacher_id, term, year) — no surrogate cycle_id to look up.
 */
async function markEvaluationCycleCompleted(teacherId, term, year, client = null) {
    const runner = client || { query };
    await runner.query(
        `UPDATE evaluation_cycle SET status = 'COMPLETED' WHERE teacher_id = $1 AND term = $2 AND year = $3`,
        [teacherId, term, year]
    );
}

module.exports = {
    getBaselineSemester,
    getActiveSchedulingRule,
    ensureEvaluationCycle,
    ensureEvaluationCyclesForAssessmentCycle,
    markEvaluationCycleCompleted,
};
