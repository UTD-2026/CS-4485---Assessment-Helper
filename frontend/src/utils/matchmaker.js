// matchmaker.js
// Front-end copy of the observer matching rules.
//
// The source of truth is backend/matching/matchmaker.js: database signups are
// matched by POST /api/observer-matches/generate. This file mirrors those rules for
// the offline mock data and gives the KPI audit the same timing and level checks.
// Keep the two in step.
//
// Rules (same codes as VIOLATION_TYPES in kpis.js):
//   a. not the observee            b. same department
//   c. teaches the same course level (first digit of the course number)
//   d. no class that overlaps the observed class (shared day + overlapping times)
// Committee members are left off generated lists: they sign in to the Committee
// portal and cannot answer observer requests.
import { mockProfessors, mockCourses } from '../data/mockDatabase.js';

export const OBSERVER_LIST_SIZE = 5;

export const MATCH_FLAGS = Object.freeze({
  OK: 'OK',
  INSUFFICIENT: 'INSUFFICIENT OBSERVERS',
  NONE: 'NO ELIGIBLE OBSERVER',
});

export const flagForListSize = (size, listSize = OBSERVER_LIST_SIZE) => {
  if (size <= 0) return MATCH_FLAGS.NONE;
  if (size < listSize) return MATCH_FLAGS.INSUFFICIENT;
  return MATCH_FLAGS.OK;
};

// "CS 2117" -> "2". Returns null when there is no course number.
export const courseLevel = (courseCode = '') => {
  const match = /^\s*[A-Za-z]+\s*(\d)\d*/.exec(String(courseCode || ''));
  return match ? match[1] : null;
};

const DAY_LETTERS = new Set(['M', 'T', 'W', 'R', 'F', 'S', 'U']);

const parseDays = (token) => {
  const upper = String(token || '').toUpperCase();
  const normalized = upper === 'TT' ? 'TR' : upper.replace(/TH/g, 'R');
  if (!normalized) return null;
  const days = new Set();
  for (const letter of normalized) {
    if (!DAY_LETTERS.has(letter)) return null;
    days.add(letter);
  }
  return days;
};

const toMinutes = (hourText, minuteText, meridiem) => {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
};

// "MW 08:30-09:45", "TT 13:00-14:15" or "TR 2:00 PM - 3:15 PM" -> { days, start, end } (minutes)
export const parseTimingRange = (timing) => {
  const text = String(timing || '').trim();
  const firstSpace = text.search(/\s/);
  if (firstSpace === -1) return null;
  const days = parseDays(text.slice(0, firstSpace));
  if (!days) return null;
  const range = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*-\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/
    .exec(text.slice(firstSpace).trim());
  if (!range) return null;
  const endMeridiem = range[6] ? range[6].toUpperCase() : null;
  const startMeridiem = range[3] ? range[3].toUpperCase() : endMeridiem;
  const start = toMinutes(range[1], range[2], startMeridiem);
  const end = toMinutes(range[4], range[5], endMeridiem || startMeridiem);
  if (start === null || end === null || start >= end) return null;
  return { days, start, end };
};

// Shared day + overlapping time range. Back-to-back classes do not overlap.
// Unreadable timings count as a conflict so availability is never assumed.
export const timingsOverlap = (a, b) => {
  const first = parseTimingRange(a);
  const second = parseTimingRange(b);
  if (!first || !second) return true;
  const sharesDay = [...first.days].some(day => second.days.has(day));
  return sharesDay && first.start < second.end && second.start < first.end;
};

// Mock-data matcher, used only when the API is unavailable.
export const generateObserverMatches = (observeeId, inputCourseCode, inputTiming) => {
  const observee = mockProfessors.find(p => p.professor_id === observeeId);
  const level = courseLevel(inputCourseCode);
  if (!observee || !inputCourseCode || level === null) return { matches: [], flag: MATCH_FLAGS.NONE };

  const eligibleObservers = mockProfessors
    .filter(prof => {
      if (prof.professor_id === observeeId) return false;
      if (prof.is_ac_member) return false;
      if (prof.department !== observee.department) return false;
      const profCourses = mockCourses.filter(c => c.instructor_id === prof.professor_id);
      if (!profCourses.some(c => courseLevel(c.course_code) === level)) return false;
      if (profCourses.some(c => timingsOverlap(c.timing, inputTiming))) return false;
      return true;
    })
    .map(prof => ({
      prof,
      teachesSameCourse: mockCourses.some(c => c.instructor_id === prof.professor_id && c.course_code === inputCourseCode),
    }))
    .sort((a, b) => Number(b.teachesSameCourse) - Number(a.teachesSameCourse) || a.prof.name.localeCompare(b.prof.name))
    .map(item => item.prof);

  const finalMatches = eligibleObservers.slice(0, OBSERVER_LIST_SIZE);
  return { matches: finalMatches, flag: flagForListSize(finalMatches.length) };
};
