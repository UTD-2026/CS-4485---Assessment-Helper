// Date-only helpers. The database stores "calendar days" (deadlines, observation dates) as
// midnight-UTC Dates, so everything here works in UTC to avoid off-by-one days.
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDay(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfUtcDay(value);
  if (typeof value !== 'string') return null;
  const m = ISO_DAY.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Reject things like 2026-02-31 that JS silently rolls over.
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null;
}

const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const toIsoDay = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
/** The last instant of a stored deadline day (a deadline of 2026-09-18 is still open at 23:59 UTC that day). */
const endOfDeadlineDay = (date) => new Date(startOfUtcDay(new Date(date)).getTime() + 86400000 - 1);

// UTD-style day letters: M T W R F (R = Thursday), S = Saturday, U = Sunday.
const LETTER_BY_DAY_INDEX = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];
const weekdayLetter = (date) => LETTER_BY_DAY_INDEX[new Date(date).getUTCDay()];

module.exports = {
  parseIsoDay,
  startOfUtcDay,
  toIsoDay,
  addDays,
  endOfDeadlineDay,
  weekdayLetter,
};
