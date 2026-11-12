// deadlines.js
// Shared deadline helpers so every screen agrees on when a deadline has "passed".

// Every deadline (sign-up, observation period, survey) closes on its date at the committee's optional time
// ("17:00", 24-hour), or at 11:59 PM local time when no time is set.
// Keep in step with deadlineClosesAt in backend/services/context.js.
export const deadlineClosesAt = (dateStr, timeStr) =>
  dateStr ? new Date(`${dateStr}T${timeStr ? `${timeStr}:00` : '23:59:59'}`) : null;

export const isPastDeadline = (dateStr, timeStr, now = new Date()) => {
  const closesAt = deadlineClosesAt(dateStr, timeStr);
  return closesAt ? now >= closesAt : false;
};

// "17:00" -> "5:00 PM";  no time -> "11:59 PM"
export const formatTime12 = (timeStr) => {
  const [h, min] = (timeStr || '23:59').split(':').map(Number);
  return `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// ("2026-11-30", "17:00") -> "11/30/2026, 05:00 PM";  no time -> "11/30/2026, 11:59 PM"
export const formatDeadline = (dateStr, timeStr) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return dateStr || '';
  return `${m[2]}/${m[3]}/${m[1]}, ${formatTime12(timeStr).padStart(8, '0')}`;
};

// Survey names kept for existing callers.
export const surveyClosesAt = deadlineClosesAt;
export const isSurveyClosed = isPastDeadline;
export const formatSurveyDeadline = formatDeadline;

// "MW 8:30 AM" -> { days: "Mon / Wed", time: "8:30 AM" }
const DAY_NAMES = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
export const splitTiming = (timing = '') => {
  const [dayCodes = '', ...rest] = timing.trim().split(/\s+/);
  return {
    days: dayCodes.toUpperCase().split('').map(d => DAY_NAMES[d] || d).join(' / '),
    time: rest.join(' '),
  };
};