// deadlines.js
// Shared deadline helpers so every screen agrees on when a deadline has "passed".

// A deadline date ("2027-05-01") stays open for the whole day and closes at 11:59:59 PM local time.
export const isPastDeadline = (dateStr, today = new Date()) =>
  dateStr ? today > new Date(`${dateStr}T23:59:59`) : false;

// The survey closes on its deadline date at the committee's chosen time ("17:00"), or 11:59 PM if none is set.
// Keep in step with surveyClosesAt in backend/services/context.js.
export const surveyClosesAt = (dateStr, timeStr) =>
  dateStr ? new Date(`${dateStr}T${timeStr ? `${timeStr}:00` : '23:59:59'}`) : null;

export const isSurveyClosed = (dateStr, timeStr, now = new Date()) => {
  const closesAt = surveyClosesAt(dateStr, timeStr);
  return closesAt ? now >= closesAt : false;
};

// ("2026-11-30", "17:00") -> "11/30/2026, 05:00 PM";  no time -> "11/30/2026, 11:59 PM"
export const formatSurveyDeadline = (dateStr, timeStr) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return dateStr || '';
  const [h, min] = (timeStr || '23:59').split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[2]}/${m[3]}/${m[1]}, ${pad(h % 12 || 12)}:${pad(min)} ${h < 12 ? 'AM' : 'PM'}`;
};

// "MW 8:30 AM" -> { days: "Mon / Wed", time: "8:30 AM" }
const DAY_NAMES = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
export const splitTiming = (timing = '') => {
  const [dayCodes = '', ...rest] = timing.trim().split(/\s+/);
  return {
    days: dayCodes.toUpperCase().split('').map(d => DAY_NAMES[d] || d).join(' / '),
    time: rest.join(' '),
  };
};