// Evaluation cadence per hire level, from the Assessment Committee's spec:
//
//   Assistant professors:   once every calendar year.
//       Last evaluated Spring 2025 -> they must be evaluated in Spring 2026 OR Fall 2026
//       (every term of the next year counts as "due"); overdue after that.
//   Associate / Full:       once every 2 calendar years.
//       Last evaluated Spring 2025 -> due in Spring 2027 (the same term); from Fall 2027 they are overdue.
//
// yearsBetween = how many years after the last evaluation the first due term falls.
// dueWindowTerms = how many consecutive terms, starting at that anniversary, still count as "due".
// 'year' means "every term in one calendar year" (2 terms with Spring/Fall, 3 if Summer is enabled).
const HIRE_LEVELS = ['assistant', 'associate', 'full'];

const EVALUATION_RULES = {
  assistant: { yearsBetween: 1, dueWindowTerms: 'year' },
  associate: { yearsBetween: 2, dueWindowTerms: 1 },
  full: { yearsBetween: 2, dueWindowTerms: 1 },
};

const OBSERVATION_STATUSES = ['signed_up', 'scheduled', 'completed', 'missed', 'unmatched'];
// 'accepted' exists only in CONFIRMATION_MODE=observee_final: the observer said yes, the observee has not picked them yet.
const MATCH_STATUSES = ['suggested', 'requested', 'accepted', 'confirmed', 'declined', 'expired', 'cancelled'];
const VIOLATIONS = ['SAME_PROFESSOR', 'DIFFERENT_DEPARTMENT', 'DIFFERENT_LEVEL', 'SCHEDULE_CONFLICT'];
const FILE_KINDS = ['signed_template'];

// Bumped whenever the committee changes who may observe whom or when a professor is due. Every eligibility / due answer
// carries it, so a report can say which version of the rules produced it.
const RULE_VERSION = '2026.10-committee-v1';

const CONFIRMATION_MODES = ['first_wins', 'observee_final'];
const CANDIDATE_FLAGS = ['OK', 'INSUFFICIENT_OBSERVERS', 'NO_ELIGIBLE_OBSERVER'];
const NETID_MODES = ['mock', 'off'];
const COURSE_BOOK_MODES = ['local', 'remote'];

module.exports = {
  HIRE_LEVELS, EVALUATION_RULES, OBSERVATION_STATUSES, MATCH_STATUSES, VIOLATIONS, FILE_KINDS,
  RULE_VERSION, CONFIRMATION_MODES, CANDIDATE_FLAGS, NETID_MODES, COURSE_BOOK_MODES,
};
