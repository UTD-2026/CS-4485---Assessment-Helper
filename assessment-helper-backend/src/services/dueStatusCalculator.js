// Semester due/overdue calculator.
//
// Academic year has three terms — SPRING, SUMMER, FALL — and every
// evaluation cadence is expressed directly as a whole number of years
// (yearsBetweenEvaluations), not as a named frequency like "annual" or
// "biennial". Those labels don't generalize cleanly once a Summer term
// exists (is "annual" 2 terms or 3?), so scheduling_rule stores a plain
// integer instead and the two examples from the Assessment Committee's
// spec become:
//
//   Assistant Professors — once every year (yearsBetweenEvaluations=1):
//     last evaluated Spring 2025 -> due in Spring, Summer, OR Fall 2026
//     (any term of the next calendar year satisfies it — a 3-term
//     due window, one per term now that a year has three of them).
//
//   Associate / Full Professors — once every 2 years
//   (yearsBetweenEvaluations=2):
//     last evaluated Spring 2025 -> due specifically in Spring 2027
//     (the same term, exactly 2 years later — a 1-term due window).
//     From Summer 2027 onward (the very next term), OVERDUE.
//
// The trick that makes both rules a single formula: represent a
// semester as an integer ordinal (year*3 + term index), so "N years
// later" is simply "+ N*3" on the ordinal line. The two policies then
// differ only in how many consecutive ordinals after the anniversary
// still count as "due" (the due window) — that width is configurable
// per scheduling_rule (due_window_terms) rather than hard-coded, so the
// AC can adjust it later without a code change.

const TERMS = ['SPRING', 'SUMMER', 'FALL']; // chronological order within a calendar year
const TERMS_PER_YEAR = TERMS.length;

/**
 * Convert a (term, year) pair into a single sortable integer. Spring of
 * a year sorts before Summer, which sorts before Fall of the same year;
 * Spring of the next year sorts after Fall of the previous year. That
 * is exactly academic-calendar order.
 */
function semesterOrdinal(term, year) {
    const termIndex = TERMS.indexOf(term);
    if (termIndex === -1) throw new Error(`Unknown term "${term}" — expected one of ${TERMS.join(', ')}`);
    return year * TERMS_PER_YEAR + termIndex;
}

function ordinalToSemester(ordinal) {
    const year = Math.floor(ordinal / TERMS_PER_YEAR);
    const termIndex = ((ordinal % TERMS_PER_YEAR) + TERMS_PER_YEAR) % TERMS_PER_YEAR;
    return { term: TERMS[termIndex], year };
}

/**
 * Approximate a hire/eval "term" from a plain hire_date when no explicit
 * term is recorded — used only as a fallback baseline for teachers who
 * have never yet been through an evaluation cycle. Mapped to a typical
 * US academic calendar: Jan–Apr -> SPRING, May–Jul -> SUMMER,
 * Aug–Dec -> FALL. This is a simplification noted for the AC to
 * override with an explicit hire term if more precision is needed.
 */
function approximateTermFromDate(date) {
    const d = new Date(date);
    const month = d.getMonth(); // 0-indexed
    let term;
    if (month <= 3) term = 'SPRING';
    else if (month <= 6) term = 'SUMMER';
    else term = 'FALL';
    return { term, year: d.getFullYear() };
}

/**
 * Core rule evaluator.
 *
 * @param {{term: 'SPRING'|'SUMMER'|'FALL', year: number}} lastEvaluatedSemester
 *   The semester of the teacher's most recently COMPLETED evaluation
 *   cycle, or their (approximated) hire semester if never evaluated.
 * @param {number} yearsBetweenEvaluations
 *   How many years must pass before the next evaluation is due (1, 2,
 *   3, 5, ...) — scheduling_rule.years_between_evaluations.
 * @param {number} dueWindowTerms
 *   How many consecutive semesters starting at the anniversary count as
 *   "due" (3 when every term of the anniversary year qualifies, 1 when
 *   only the exact anniversary term does — scheduling_rule.due_window_terms).
 * @param {{term: 'SPRING'|'SUMMER'|'FALL', year: number}} currentSemester
 * @returns {{
 *   status: 'NOT_YET_DUE'|'DUE'|'OVERDUE',
 *   anniversary: {term: string, year: number},
 *   dueWindow: Array<{term: string, year: number}>
 * }}
 */
function calculateDueStatus(lastEvaluatedSemester, yearsBetweenEvaluations, dueWindowTerms, currentSemester) {
    if (!Number.isInteger(yearsBetweenEvaluations) || yearsBetweenEvaluations <= 0) {
        throw new Error(`yearsBetweenEvaluations must be a positive integer, got "${yearsBetweenEvaluations}"`);
    }

    const lastOrdinal = semesterOrdinal(lastEvaluatedSemester.term, lastEvaluatedSemester.year);
    const anniversaryOrdinal = lastOrdinal + yearsBetweenEvaluations * TERMS_PER_YEAR;
    const windowEndOrdinal = anniversaryOrdinal + (dueWindowTerms - 1);
    const currentOrdinal = semesterOrdinal(currentSemester.term, currentSemester.year);

    const dueWindow = [];
    for (let o = anniversaryOrdinal; o <= windowEndOrdinal; o++) {
        dueWindow.push(ordinalToSemester(o));
    }

    let status;
    if (currentOrdinal < anniversaryOrdinal) {
        status = 'NOT_YET_DUE';
    } else if (currentOrdinal <= windowEndOrdinal) {
        status = 'DUE';
    } else {
        status = 'OVERDUE';
    }

    return { status, anniversary: ordinalToSemester(anniversaryOrdinal), dueWindow };
}

module.exports = {
    TERMS,
    TERMS_PER_YEAR,
    semesterOrdinal,
    ordinalToSemester,
    approximateTermFromDate,
    calculateDueStatus,
};
