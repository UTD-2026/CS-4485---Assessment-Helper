// Term helpers. Terms are written the way the team's data writes them: "Fall 2026", "Spring 2027".
// Adapted from the feature_api branch (services/terms.js) without the Summer-term option.

const SEASONS = ["Spring", "Fall"];

function parseTerm(value) {
  const m = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(String(value || ""));
  if (!m) return null;
  const season = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  if (!SEASONS.includes(season)) return null;
  return { season, year: Number(m[2]) };
}

const isValidTerm = (value) => parseTerm(value) !== null;

/** One sortable integer per term: Spring 2026 < Fall 2026 < Spring 2027. */
function termOrdinal(term) {
  const t = typeof term === "string" ? parseTerm(term) : term;
  if (!t) throw new Error(`Unknown term "${term}"`);
  return t.year * SEASONS.length + SEASONS.indexOf(t.season);
}

function ordinalToTerm(ordinal) {
  const year = Math.floor(ordinal / SEASONS.length);
  return `${SEASONS[ordinal % SEASONS.length]} ${year}`;
}

/** Spring = January-June, Fall = July-December. */
function termFromDate(date) {
  const d = new Date(date);
  return `${d.getUTCMonth() <= 5 ? "Spring" : "Fall"} ${d.getUTCFullYear()}`;
}

const compareTerms = (a, b) => termOrdinal(a) - termOrdinal(b);
const nextTerm = (term) => ordinalToTerm(termOrdinal(term) + 1);

/** "Fall 2026" -> "fall-2026" (used for template file names). */
const termSlug = (term) => String(term).trim().toLowerCase().replace(/\s+/g, "-");

module.exports = {
  SEASONS,
  parseTerm,
  isValidTerm,
  termOrdinal,
  ordinalToTerm,
  termFromDate,
  compareTerms,
  nextTerm,
  termSlug,
};
