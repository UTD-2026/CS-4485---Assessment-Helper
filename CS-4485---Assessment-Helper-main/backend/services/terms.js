// Term helpers. A term is written the way the team's data writes it: "Fall 2026", "Spring 2027".
const { env } = require('../config/env');

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const seasons = () => env.academicTerms.map(cap);

/** "Fall 2026" (also "fall-2026", "FALL_2026", "Fall%202026" once decoded) -> {season:'Fall', year:2026}, or null. */
function parseTerm(value) {
  if (typeof value !== 'string') return null;
  const m = /^\s*([A-Za-z]+)[\s_+-]+(\d{4})\s*$/.exec(value);
  if (!m) return null;
  const season = cap(m[1]);
  return seasons().includes(season) ? { season, year: Number(m[2]) } : null;
}

const formatTerm = ({ season, year }) => `${season} ${year}`;
/** Normalises any accepted spelling to the canonical "Fall 2026", or null. */
const normalizeTerm = (value) => {
  const t = parseTerm(value);
  return t ? formatTerm(t) : null;
};

/** One sortable integer per term, in calendar order (Spring 2026 < Fall 2026 < Spring 2027). */
function termOrdinal(term, list = seasons()) {
  const t = typeof term === 'string' ? parseTerm(term) : term;
  if (!t) throw new Error(`Unknown term "${JSON.stringify(term)}"`);
  const idx = list.indexOf(t.season);
  if (idx === -1) throw new Error(`Unknown season "${t.season}" (expected ${list.join(', ')})`);
  return t.year * list.length + idx;
}

function ordinalToTerm(ordinal, list = seasons()) {
  const year = Math.floor(ordinal / list.length);
  return { season: list[((ordinal % list.length) + list.length) % list.length], year };
}

const compareTerms = (a, b) => termOrdinal(a) - termOrdinal(b);

/**
 * Which term does a calendar date fall in? Spring = January through the end of spring,
 * Fall = the second half of the year. (With Summer enabled: Jan-Apr Spring, May-Jul Summer, Aug-Dec Fall.)
 */
function termFromDate(date, list = seasons()) {
  const d = new Date(date);
  const month = d.getUTCMonth(); // 0-11
  let season;
  if (list.includes('Summer')) season = month <= 3 ? 'Spring' : month <= 6 ? 'Summer' : 'Fall';
  else season = month <= 5 ? 'Spring' : 'Fall';
  if (!list.includes(season)) season = list[month < 6 ? 0 : list.length - 1];
  return { season, year: d.getUTCFullYear() };
}

module.exports = {
  parseTerm,
  termOrdinal,
  ordinalToTerm,
  termFromDate,
  seasons,
  formatTerm,
  normalizeTerm,
  compareTerms,
};
