// Due/overdue rule (assumption: confirm with Prof. Priya):
//   assistant professors are observed every calendar year (2 semesters),
//   associate and full every two years (4 semesters).
//   "due" = exactly at the threshold, "overdue" = past it, never observed = overdue.
// Semesters are counted as half-years: Spring = Jan-Jun, Fall = Jul-Dec.

const CYCLE_SEMESTERS = { assistant: 2, associate: 4, full: 4 };

// "Fall 2026" -> a number that goes up by 1 per semester
const termIndex = (term) => {
  const [season, year] = term.split(" ");
  return Number(year) * 2 + (season === "Fall" ? 1 : 0);
};

const dateIndex = (date) => {
  const d = new Date(date);
  return d.getUTCFullYear() * 2 + (d.getUTCMonth() >= 6 ? 1 : 0);
};

export function dueStatus(professor, lastObserved, currentTerm) {
  if (!lastObserved) return "overdue";
  const semestersAgo = termIndex(currentTerm) - dateIndex(lastObserved);
  const cycle = CYCLE_SEMESTERS[professor.hireLevel];
  if (semestersAgo < cycle) return "not_due";
  return semestersAgo === cycle ? "due" : "overdue";
}
