// Focus-Area Matching Algorithm -> now Eligibility-Based Observer Matching.
//
// Superseded design note: the original version of this service ranked
// candidates by Jaccard similarity over `teacher.focus_areas`. The
// Assessment Committee's actual eligibility rule is course-level +
// department + free-time based (see src/services/eligibilityService.js),
// with no mention of topical focus areas, so this service now builds
// its candidate list from eligibility rather than tag overlap.
// `focus_areas` is left in the schema for a possible future
// tie-breaking pass but is not consulted here.
//
// generateObserverCandidates() is the engine behind:
//   - AC's "Observer Selection" button (bulk, after signup deadline)
//   - the "ALERT for Observees with NO / insufficient Observers" signal
//   - the Focus-area match accuracy / List sufficiency rate KPIs
//     (renamed in practice to "eligibility match accuracy" and "list
//     sufficiency rate" per the KPI definitions given)
//
// TA Q&A update: "If fewer than 5 eligible observers exist, should our
// system display everyone that qualifies? ... Fewer than 5: display
// all." / "If 5 or more observers are available, then randomly pick
// from this pool." Candidate selection is therefore NOT ranked by
// workload (or anything else) — it's the full eligible pool when that
// pool has fewer than 5 people, otherwise a random 5 of them. Active
// observation load is kept on the returned object as informational
// metadata only; it no longer drives selection order.

const { query, getClient } = require('../config/db');
const { evaluateEligibility } = require('./eligibilityService');

const CANDIDATE_LIST_SIZE = 5;

/**
 * Fisher-Yates shuffle. Returns a new array; does not mutate the input.
 */
function shuffled(array) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * Current in-flight observation load for every observer. Informational
 * only (see note above) — surfaced to the AC dashboard but no longer
 * used to rank or filter candidates.
 */
async function getActiveObservationCounts() {
    const result = await query(
        `SELECT observer_teacher_id, COUNT(*)::int AS active_count
         FROM observation_assignment
         WHERE status IN ('PROPOSED', 'CONFIRMED', 'SUBMITTED')
         GROUP BY observer_teacher_id`
    );
    return new Map(result.rows.map((r) => [r.observer_teacher_id, r.active_count]));
}

/**
 * Build the full pool of "currently teaching" candidates for a given
 * semester: every active teacher plus the list of course sections they
 * teach that term, keyed by teacher_id. This one query backs the
 * eligibility check for every candidate in the pool.
 */
async function loadCandidatePool(term, year, excludeTeacherId) {
    const teachersResult = await query(
        `SELECT teacher_id, full_name, email, hiring_level, department, is_active
         FROM teacher
         WHERE is_active = TRUE AND teacher_id <> $1`,
        [excludeTeacherId]
    );

    const sectionsResult = await query(
        `SELECT section_id, instructor_id, course_number, department, course_level, meeting_days, start_time, end_time
         FROM course_section
         WHERE term = $1 AND year = $2 AND instructor_id IS NOT NULL`,
        [term, year]
    );

    const sectionsByInstructor = new Map();
    for (const s of sectionsResult.rows) {
        if (!sectionsByInstructor.has(s.instructor_id)) sectionsByInstructor.set(s.instructor_id, []);
        sectionsByInstructor.get(s.instructor_id).push(s);
    }

    return teachersResult.rows.map((t) => ({
        ...t,
        sections: sectionsByInstructor.get(t.teacher_id) || [],
    }));
}

/**
 * Core recommendation function for one signup: evaluates every
 * currently-teaching, active teacher against the eligibility rules for
 * the observee's selected course section, and returns the eligible
 * candidates — all of them if fewer than CANDIDATE_LIST_SIZE qualify,
 * otherwise a random CANDIDATE_LIST_SIZE of them (TA Q&A).
 *
 * Ineligible attempts are not silently dropped — every evaluation
 * (eligible or not) is available via `allEvaluations` so the caller can
 * log violations for the Evaluation Eligibility Accuracy KPI.
 */
async function findEligibleObservers(signupId) {
    const signupResult = await query(
        `SELECT s.signup_id, s.observee_teacher_id, s.course_section_id,
                cs.department, cs.course_level, cs.meeting_days, cs.start_time, cs.end_time, cs.term, cs.year
         FROM signup s
         JOIN course_section cs ON cs.section_id = s.course_section_id
         WHERE s.signup_id = $1`,
        [signupId]
    );
    const signup = signupResult.rows[0];
    if (!signup) {
        const err = new Error(`Signup ${signupId} not found`);
        err.statusCode = 404;
        throw err;
    }

    const observeeResult = await query('SELECT teacher_id, full_name FROM teacher WHERE teacher_id = $1', [signup.observee_teacher_id]);
    const observee = observeeResult.rows[0];

    const pool = await loadCandidatePool(signup.term, signup.year, signup.observee_teacher_id);
    const activeLoad = await getActiveObservationCounts();

    const courseSection = {
        department: signup.department,
        course_level: signup.course_level,
        meeting_days: signup.meeting_days,
        start_time: signup.start_time,
        end_time: signup.end_time,
    };

    const allEvaluations = pool.map((candidate) => {
        const { eligible, violation } = evaluateEligibility({
            observee,
            candidate,
            courseSection,
            candidateSections: candidate.sections,
        });
        return {
            teacher_id: candidate.teacher_id,
            full_name: candidate.full_name,
            eligible,
            violation,
            activeObservations: activeLoad.get(candidate.teacher_id) || 0,
        };
    });

    const eligiblePool = allEvaluations.filter((c) => c.eligible);
    const eligible = eligiblePool.length <= CANDIDATE_LIST_SIZE
        ? eligiblePool
        : shuffled(eligiblePool).slice(0, CANDIDATE_LIST_SIZE);

    return {
        signupId,
        observee: { teacher_id: observee.teacher_id, full_name: observee.full_name },
        candidates: eligible,
        allEvaluations,
        isSufficient: eligible.length > 0,
    };
}

/**
 * Persist the generated candidate list to observer_candidate, update the
 * signup's status/flags, and log every ineligible evaluation to
 * eligibility_violation_log for the accuracy KPI. Runs in a single
 * transaction so the signup's flags always match its candidate rows.
 */
async function generateAndPersistCandidates(signupId) {
    const { candidates, allEvaluations, isSufficient } = await findEligibleObservers(signupId);

    const client = await getClient();
    try {
        await client.query('BEGIN');

        await client.query('DELETE FROM observer_candidate WHERE signup_id = $1', [signupId]);
        let rank = 1;
        for (const candidate of candidates) {
            await client.query(
                `INSERT INTO observer_candidate (signup_id, candidate_teacher_id, rank) VALUES ($1, $2, $3)`,
                [signupId, candidate.teacher_id, rank]
            );
            rank += 1;
        }

        for (const evaluation of allEvaluations) {
            if (!evaluation.eligible) {
                await client.query(
                    `INSERT INTO eligibility_violation_log (signup_id, attempted_observer_id, violation_type, context)
                     VALUES ($1, $2, $3, 'Filtered out during candidate generation')`,
                    [signupId, evaluation.teacher_id, evaluation.violation]
                );
            }
        }

        const totalEligibleCount = allEvaluations.filter((e) => e.eligible).length;
        await client.query(
            `UPDATE signup
             SET status = 'OBSERVERS_GENERATED', observer_candidate_count = $2,
                 total_eligible_count = $3, has_sufficient_observers = $4
             WHERE signup_id = $1`,
            [signupId, candidates.length, totalEligibleCount, isSufficient]
        );

        await client.query('COMMIT');
        return { signupId, candidateCount: candidates.length, isSufficient };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { findEligibleObservers, generateAndPersistCandidates, CANDIDATE_LIST_SIZE };
