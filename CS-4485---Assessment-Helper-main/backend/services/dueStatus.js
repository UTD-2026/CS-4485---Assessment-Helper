// Due / overdue calculator (the "dueStatus" the seed script's header refers to).
//
// A professor's NEXT evaluation falls `yearsBetween` calendar years after the term of their last
// completed one (the "anniversary term"). The rule for their hire level also says how many
// consecutive terms starting at that anniversary still count as "due". Before the anniversary
// they are not_due; after the window closes they are overdue; never observed = overdue.
//
// Worked examples straight from the Assessment Committee's spec (Spring/Fall years):
//   assistant, last Spring 2025 -> anniversary Spring 2026, window of 2 -> due Spring 2026 + Fall 2026, overdue from Spring 2027
//   associate, last Spring 2025 -> anniversary Spring 2027, window of 1 -> due Spring 2027, overdue from Fall 2027
//
// "A year" is a whole number of terms (2, or 3 with Summer), so this works on integer ordinals:
// N years later is simply + N * termsPerYear. See services/terms.js.
const { EVALUATION_RULES } = require('../config/rules');
const { ordinalToTerm, seasons, termFromDate, termOrdinal, formatTerm } = require('./terms');

function calculateDueStatus({ lastTerm, yearsBetween, dueWindowTerms, currentTerm, list = seasons() }) {
  if (!Number.isInteger(yearsBetween) || yearsBetween <= 0) {
    throw new Error(`yearsBetween must be a positive integer, got "${yearsBetween}"`);
  }
  const perYear = list.length;
  const windowTerms = dueWindowTerms === 'year' ? perYear : dueWindowTerms;
  if (!Number.isInteger(windowTerms) || windowTerms <= 0) throw new Error(`dueWindowTerms must be a positive integer or 'year'`);

  const anniversary = termOrdinal(lastTerm, list) + yearsBetween * perYear;
  const windowEnd = anniversary + windowTerms - 1;
  const current = termOrdinal(currentTerm, list);

  const dueWindow = [];
  for (let o = anniversary; o <= windowEnd; o += 1) dueWindow.push(formatTerm(ordinalToTerm(o, list)));

  let status;
  if (current < anniversary) status = 'not_due';
  else if (current <= windowEnd) status = 'due';
  else status = 'overdue';

  return { status, anniversary: formatTerm(ordinalToTerm(anniversary, list)), dueWindow };
}

/**
 * Due status for one professor as of `currentTerm`.
 * @param professor  {hire_level}
 * @param baselineDate  date of their last completed observation before currentTerm, or null
 */
function dueStatusFor(professor, baselineDate, currentTerm, list = seasons()) {
  const rule = EVALUATION_RULES[professor.hire_level];
  if (!rule) throw new Error(`Unknown hire level "${professor.hire_level}"`);
  if (!baselineDate) {
    return { status: 'overdue', baselineTerm: null, anniversary: null, dueWindow: [], reason: 'never observed' };
  }
  const lastTerm = termFromDate(baselineDate, list);
  const result = calculateDueStatus({
    lastTerm,
    yearsBetween: rule.yearsBetween,
    dueWindowTerms: rule.dueWindowTerms,
    currentTerm,
    list,
  });
  return { ...result, baselineTerm: formatTerm(lastTerm), reason: null };
}

/**
 * The date that counts as "last evaluated" when judging `currentTerm`: the latest COMPLETED observation
 * from an EARLIER term. (Professor.last_observed alone is not enough: once this term's observation
 * completes it moves forward, which would make the professor look not_due in the very term they just did it.)
 * @param completedDates  Date[] of the professor's completed observations (any term)
 */
function baselineBefore(professor, completedDates, currentTerm, list = seasons()) {
  const limit = termOrdinal(currentTerm, list);
  const candidates = [...completedDates];
  if (professor.last_observed) candidates.push(new Date(professor.last_observed));
  const earlier = candidates.filter((d) => termOrdinal(termFromDate(d, list), list) < limit);
  if (!earlier.length) return null;
  return new Date(Math.max(...earlier.map((d) => d.getTime())));
}

module.exports = {
  calculateDueStatus,
  dueStatusFor,
  baselineBefore,
};
