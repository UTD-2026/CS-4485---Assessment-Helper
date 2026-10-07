// Eligibility rules for the observer-matching engine.
//
// Per the Assessment Committee's rules:
//   "A 1000-level Prof of department ABC can only observe another
//    1000-level Prof in the same department" (and equivalently for
//    every other course level).
//   "System should not show Prof A as a potential Observer for Prof A
//    themself."
//   "System should show 5 Profs who are free at that time AND who teach
//    [the same]-level courses in the same department."
//
// A candidate is ELIGIBLE to observe an Observee's selected course
// section if all of the following hold:
//   1. candidate is not the Observee.
//   2. candidate's home department matches the course section's department.
//   3. candidate currently teaches at least one course_section at the
//      same course_level, in the same semester.
//   4. candidate has no schedule conflict with the observee's course's
//      meeting days/time (i.e. isn't teaching something else at that
//      same day/time).
//
// course_section.start_time / end_time are real Postgres TIME columns
// (schema v3 — previously a single "HH:MM-HH:MM" string), so the
// conflict check below compares them directly rather than parsing text.
// node-pg returns TIME values as "HH:MM:SS" strings; toMinutes() handles
// that format.
//
// Each violated rule maps to one of the "Incorrect occurrence" types
// listed under the Evaluation Eligibility Accuracy KPI, so a caller can
// both explain a rejection and log it for that KPI.

const DAY_TOKENS = ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'];

/**
 * Parse a meeting-days string like 'MWF' or 'TuTh' into an array of day
 * tokens. Longest tokens are matched first so 'Tu' and 'Th' aren't
 * mistaken for 'T'.
 */
function parseDays(daysString) {
    if (!daysString) return [];
    const sorted = [...DAY_TOKENS].sort((a, b) => b.length - a.length);
    const days = [];
    let remaining = daysString;
    while (remaining.length > 0) {
        const match = sorted.find((token) => remaining.startsWith(token));
        if (!match) {
            // Unrecognized character — skip it rather than throwing, so a
            // slightly malformed upstream value doesn't crash matching.
            remaining = remaining.slice(1);
            continue;
        }
        days.push(match);
        remaining = remaining.slice(match.length);
    }
    return days;
}

/**
 * Convert a TIME value ("HH:MM" or "HH:MM:SS", as returned by node-pg or
 * written by hand in sample data) into minutes-since-midnight. Returns
 * null if it can't be parsed, so callers can treat that conservatively.
 */
function toMinutes(time) {
    if (!time) return null;
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(time).trim());
    if (!match) return null;
    const [, h, m] = match.map(Number);
    return h * 60 + m;
}

/**
 * True if two [meeting_days, start_time, end_time] triples overlap on at
 * least one shared day AND an overlapping time range. Two unparseable
 * time values are conservatively treated as NOT conflicting (we can't
 * prove a conflict from bad data).
 */
function schedulesConflict(daysA, startA, endA, daysB, startB, endB) {
    const dayTokensA = new Set(parseDays(daysA));
    const dayTokensB = parseDays(daysB);
    const sharesADay = dayTokensB.some((d) => dayTokensA.has(d));
    if (!sharesADay) return false;

    const startAMin = toMinutes(startA);
    const endAMin = toMinutes(endA);
    const startBMin = toMinutes(startB);
    const endBMin = toMinutes(endB);
    if (startAMin === null || endAMin === null || startBMin === null || endBMin === null) return false;

    return startAMin < endBMin && startBMin < endAMin;
}

/**
 * Evaluate whether `candidate` is eligible to observe `observee`'s
 * `courseSection`. `candidateSections` is the candidate's own course
 * load for the same semester, used for both the level/department check
 * (rule 3) and the free-time check (rule 4). Each section — including
 * `courseSection` itself — is expected to have meeting_days, start_time
 * and end_time fields.
 *
 * @returns {{eligible: boolean, violation: string|null}}
 *   violation is one of: SAME_PROFESSOR, DIFFERENT_DEPARTMENT,
 *   DIFFERENT_LEVEL, SCHEDULE_CONFLICT, or null when eligible.
 */
function evaluateEligibility({ observee, candidate, courseSection, candidateSections }) {
    if (candidate.teacher_id === observee.teacher_id) {
        return { eligible: false, violation: 'SAME_PROFESSOR' };
    }

    if (candidate.department !== courseSection.department) {
        return { eligible: false, violation: 'DIFFERENT_DEPARTMENT' };
    }

    const teachesSameLevel = candidateSections.some((s) => s.course_level === courseSection.course_level);
    if (!teachesSameLevel) {
        return { eligible: false, violation: 'DIFFERENT_LEVEL' };
    }

    const hasConflict = candidateSections.some((s) =>
        schedulesConflict(
            courseSection.meeting_days, courseSection.start_time, courseSection.end_time,
            s.meeting_days, s.start_time, s.end_time
        )
    );
    if (hasConflict) {
        return { eligible: false, violation: 'SCHEDULE_CONFLICT' };
    }

    return { eligible: true, violation: null };
}

module.exports = { parseDays, toMinutes, schedulesConflict, evaluateEligibility };
