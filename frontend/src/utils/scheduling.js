// scheduling.js
// Validation helpers for picking an observation date/time.
// An observation can only be booked on a day the observee actually teaches
// the course, at the time that class meets (e.g. "MW 8:30 AM" -> Mon/Wed at 8:30 AM).

// Day letters used in course timings -> JS getDay() index (0 = Sunday)
const DAY_CODE_TO_INDEX = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
const DAY_INDEX_TO_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "MW 8:30 AM" -> { dayIndexes: [1, 3], dayNames: ['Monday', 'Wednesday'], times: ['8:30 AM'] }
export const parseClassTiming = (timing = '') => {
  const [dayCodes = '', ...rest] = timing.trim().split(/\s+/);
  const dayIndexes = dayCodes
    .toUpperCase()
    .split('')
    .map(code => DAY_CODE_TO_INDEX[code])
    .filter(idx => idx !== undefined);
  const time = rest.join(' ').toUpperCase();
  return {
    dayIndexes,
    dayNames: dayIndexes.map(idx => DAY_INDEX_TO_NAME[idx]),
    // Array so a section with more than one meeting time can be supported later
    times: time ? [time] : [],
  };
};

// Parse "YYYY-MM-DD" as a LOCAL date. (new Date("2026-10-27") is UTC midnight,
// which shifts to the previous day in US time zones and breaks getDay().)
export const parseLocalDate = (dateStr) => {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Today's date as "YYYY-MM-DD" in local time (for the date input's min attribute)
export const todayLocalISO = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// Returns an error message if the date is not a valid class day, otherwise null.
export const validateObservationDate = (dateStr, timing, { minDate, maxDate } = {}) => {
  const date = parseLocalDate(dateStr);
  if (!date) return 'Please select a valid date.';

  if (minDate && dateStr < minDate) return `The observation date cannot be before ${minDate}.`;
  if (maxDate && dateStr > maxDate) return `The observation date must be on or before the observation deadline (${maxDate}).`;

  const { dayIndexes, dayNames } = parseClassTiming(timing);
  if (dayIndexes.length === 0) return `Could not read the class schedule (${timing}).`;

  if (!dayIndexes.includes(date.getDay())) {
    return `${dateStr} is a ${DAY_INDEX_TO_NAME[date.getDay()]}. This class only meets on ${dayNames.join(' and ')} (${timing}).`;
  }
  return null;
};

// Returns an error message if the time is not when the class meets, otherwise null.
export const validateObservationTime = (timeStr, timing) => {
  if (!timeStr) return 'Please select a time.';
  const { times } = parseClassTiming(timing);
  if (!times.includes(timeStr.trim().toUpperCase())) {
    return `${timeStr} is not when this class meets. Please select ${times.join(' or ')}.`;
  }
  return null;
};

// Full check used right before saving.
export const validateObservationSlot = (dateStr, timeStr, timing, options = {}) =>
  validateObservationDate(dateStr, timing, options) || validateObservationTime(timeStr, timing);