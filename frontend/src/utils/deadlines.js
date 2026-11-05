// deadlines.js
// Shared deadline helpers so every screen agrees on when a deadline has "passed".

// A deadline date ("2027-05-01") stays open for the whole day and closes at 11:59:59 PM local time.
export const isPastDeadline = (dateStr, today = new Date()) =>
  dateStr ? today > new Date(`${dateStr}T23:59:59`) : false;

// "MW 8:30 AM" -> { days: "Mon / Wed", time: "8:30 AM" }
const DAY_NAMES = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
export const splitTiming = (timing = '') => {
  const [dayCodes = '', ...rest] = timing.trim().split(/\s+/);
  return {
    days: dayCodes.toUpperCase().split('').map(d => DAY_NAMES[d] || d).join(' / '),
    time: rest.join(' '),
  };
};