// Due / overdue calculator.
//
// The committee's rule was implemented the same way on three branches (sriproflookup's
// calculateEvaluationStatus, add-backend's dueStatusCalculator, feature_api's dueStatus):
//
//   Assistant professors:  once every calendar year.
//     Last evaluated Spring 2025 -> due Spring 2026 OR Fall 2026; overdue from Spring 2027.
//   Associate / Full:      once every 2 years, in the same semester.
//     Last evaluated Spring 2025 -> due Spring 2027; overdue from Fall 2027.
//   Never evaluated:       overdue.
//
// "Last evaluated" = the latest COMPLETED observation from a term BEFORE the term being judged
// (so finishing this term's observation does not make someone look "not due" this term).

const { termFromDate, termOrdinal, ordinalToTerm } = require("./terms");

const RULES = {
  assistant: { yearsBetween: 1, dueWindowTerms: 2 }, // every term of the following calendar year
  associate: { yearsBetween: 2, dueWindowTerms: 1 },
  full: { yearsBetween: 2, dueWindowTerms: 1 },
};

const normalizeLevel = (level) => String(level || "").trim().toLowerCase();
const levelLabel = (level) => {
  const l = normalizeLevel(level);
  return l ? l.charAt(0).toUpperCase() + l.slice(1) : "Unknown";
};

/**
 * @param hireLevel  'assistant' | 'associate' | 'full'
 * @param lastTerm   e.g. "Spring 2025" or null when never evaluated
 * @param currentTerm e.g. "Fall 2026"
 * @returns {{status:'not_due'|'due'|'overdue', next_due_term:string, due_window:string[], overdue_by:number}}
 */
function calculateDueStatus(hireLevel, lastTerm, currentTerm) {
  const rule = RULES[normalizeLevel(hireLevel)] || RULES.associate;
  const current = termOrdinal(currentTerm);
  if (!lastTerm) {
    return { status: "overdue", next_due_term: "Immediate", due_window: [], overdue_by: 1, last_evaluated_term: null };
  }
  // Assistant: the window starts in Spring of the following calendar year, whichever semester was last.
  const last = termOrdinal(lastTerm);
  const anniversary = normalizeLevel(hireLevel) === "assistant"
    ? termOrdinal(`Spring ${Number(lastTerm.split(" ")[1]) + 1}`)
    : last + rule.yearsBetween * 2;
  const windowEnd = anniversary + rule.dueWindowTerms - 1;
  const dueWindow = [];
  for (let o = anniversary; o <= windowEnd; o += 1) dueWindow.push(ordinalToTerm(o));

  let status = "not_due";
  if (current > windowEnd) status = "overdue";
  else if (current >= anniversary) status = "due";

  return {
    status,
    next_due_term: ordinalToTerm(anniversary),
    due_window: dueWindow,
    overdue_by: status === "overdue" ? current - windowEnd : 0,
    last_evaluated_term: lastTerm,
  };
}

/** The last term (before currentTerm) in which this professor completed an observation, or null. */
function lastEvaluatedTerm(professor, completedDates, currentTerm) {
  const limit = termOrdinal(currentTerm);
  const candidates = [...(completedDates || [])];
  if (professor.last_observed) candidates.push(new Date(professor.last_observed));
  const earlier = candidates
    .map((d) => termFromDate(d))
    .filter((t) => termOrdinal(t) < limit)
    .sort((a, b) => termOrdinal(b) - termOrdinal(a));
  return earlier[0] || null;
}

function dueStatusFor(professor, completedDates, currentTerm) {
  return calculateDueStatus(professor.hire_level, lastEvaluatedTerm(professor, completedDates, currentTerm), currentTerm);
}

module.exports = { RULES, calculateDueStatus, lastEvaluatedTerm, dueStatusFor, levelLabel, normalizeLevel };
