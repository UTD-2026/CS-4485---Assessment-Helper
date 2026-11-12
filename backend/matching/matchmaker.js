// Observer matching engine.
//
// Pure functions only (no database access) so the rules can be unit tested and
// reused by every route that needs them. The rules mirror the eligibility audit
// in frontend/src/utils/kpis.js (VIOLATION_TYPES a-d):
//
//   a. SAME_PROF          the observer cannot be the observee
//   b. OTHER_DEPT         the observer must be in the observee's department
//   c. DIFFERENT_LEVEL    the observer must teach a section at the same course
//                         level (first digit of the course number) in the same term
//   d. SCHEDULE_CONFLICT  none of the observer's sections that term may meet at a
//                         time that overlaps the observed section
//
// Committee (AC) members are additionally left off generated lists because they
// sign in to the Committee portal and cannot answer observer requests there.
// The committee can still assign one of its members manually.

"use strict";

const OBSERVER_LIST_SIZE = 5;

const MATCH_FLAGS = Object.freeze({
  OK: "OK",
  INSUFFICIENT: "INSUFFICIENT OBSERVERS",
  NONE: "NO ELIGIBLE OBSERVER",
});

const RULES = Object.freeze({
  SAME_PROF: "Same professor as the observee",
  OTHER_DEPT: "Observer is in a different department",
  DIFFERENT_LEVEL: "Observer does not teach a course at the same level this term",
  SCHEDULE_CONFLICT: "Observer teaches at a time that overlaps the observed class",
});

const DAY_LETTERS = new Set(["M", "T", "W", "R", "F", "S", "U"]);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim().toLowerCase();

// "CS 2117" -> "2", "MATH 3311" -> "3". Returns null when no course number is found.
function courseLevel(courseCode) {
  const match = /^\s*[A-Za-z]+\s*(\d)\d*/.exec(String(courseCode || ""));
  return match ? match[1] : null;
}

function parseDays(token) {
  const upper = String(token || "").toUpperCase();
  // The database stores Tuesday/Thursday as "TT"; mock data and Course Book use "TR".
  const normalized = upper === "TT" ? "TR" : upper.replace(/TH/g, "R");
  if (!normalized) return null;
  const days = new Set();
  for (const letter of normalized) {
    if (!DAY_LETTERS.has(letter)) return null;
    days.add(letter);
  }
  return days;
}

function toMinutes(hourText, minuteText, meridiem) {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

// Accepts the database format ("MW 08:30-09:45", "TT 13:00-14:15") and the
// display/mock format ("TR 2:00 PM - 3:15 PM"). Returns null when unreadable.
function parseTiming(timing) {
  const text = String(timing || "").trim();
  const firstSpace = text.search(/\s/);
  if (firstSpace === -1) return null;
  const days = parseDays(text.slice(0, firstSpace));
  if (!days) return null;

  const range = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*-\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/
    .exec(text.slice(firstSpace).trim());
  if (!range) return null;

  // "1:00 - 2:15 PM": a single meridiem applies to both ends.
  const endMeridiem = range[6] ? range[6].toUpperCase() : null;
  const startMeridiem = range[3] ? range[3].toUpperCase() : endMeridiem;
  const start = toMinutes(range[1], range[2], startMeridiem);
  const end = toMinutes(range[4], range[5], endMeridiem || startMeridiem);
  if (start === null || end === null || start >= end) return null;
  return { days, start, end };
}

// True when two meetings share a day and their time ranges overlap.
// Back-to-back classes (one ends 09:45, the next starts 09:45) do not overlap.
// A timing that cannot be read counts as a conflict, so an observer is never
// suggested when their availability cannot be confirmed.
function timingsOverlap(a, b) {
  const first = parseTiming(a);
  const second = parseTiming(b);
  if (!first || !second) return true;
  const sharesDay = [...first.days].some((day) => second.days.has(day));
  return sharesDay && first.start < second.end && second.start < first.end;
}

// Returns the rule codes an observer -> observee pairing breaks (empty = eligible).
// observerSections must be the observer's sections in the observed section's term.
function auditPairing({ section, observee, observer, observerSections = [] }) {
  if (!section || !observee || !observer) return [];
  if (normalizeEmail(observer.email) === normalizeEmail(observee.email)) return ["SAME_PROF"];

  const violations = [];
  if (normalizeText(observer.department) !== normalizeText(observee.department)) {
    violations.push("OTHER_DEPT");
  }

  const level = courseLevel(section.course_code);
  const teachesLevel = level !== null &&
    observerSections.some((item) => courseLevel(item.course_code) === level);
  if (!teachesLevel) violations.push("DIFFERENT_LEVEL");

  const isObservedSection = (item) =>
    item.course_code === section.course_code &&
    item.section_number === section.section_number &&
    item.term === section.term;
  if (observerSections.some((item) => !isObservedSection(item) && timingsOverlap(item.timing, section.timing))) {
    violations.push("SCHEDULE_CONFLICT");
  }
  return violations;
}

function isEligibleObserver(pairing, { excludeCommitteeMembers = true } = {}) {
  if (excludeCommitteeMembers && pairing.observer?.is_ac_member) return false;
  return auditPairing(pairing).length === 0;
}

function flagForListSize(size, listSize = OBSERVER_LIST_SIZE) {
  if (size <= 0) return MATCH_FLAGS.NONE;
  if (size < listSize) return MATCH_FLAGS.INSUFFICIENT;
  return MATCH_FLAGS.OK;
}

function groupSectionsByInstructor(sections) {
  const grouped = new Map();
  for (const section of sections) {
    const email = normalizeEmail(section.instructor_email);
    if (!grouped.has(email)) grouped.set(email, []);
    grouped.get(email).push(section);
  }
  return grouped;
}

// Ranks every eligible observer for one section.
//
//   section          the section to be observed ({ course_code, section_number, term, timing })
//   observee         the professor teaching it
//   professors       every professor
//   termSections     every section in the same term (used for levels and conflicts)
//   excludeEmails    observers already on this section's list, in any status
//   assignedCounts   Map email -> observations this term the professor is already assigned to observe
//   activeCounts     Map email -> other open lists (suggested/requested/accepted) the professor is on
//   limit            how many candidates to return (default: the full list size)
//
// Order: teaches the same course, then fewest assigned observations, then fewest
// open lists, then name and email, so results are deterministic and duties spread out.
function rankCandidates({
  section,
  observee,
  professors,
  termSections,
  excludeEmails = new Set(),
  assignedCounts = new Map(),
  activeCounts = new Map(),
  excludeCommitteeMembers = true,
  limit = OBSERVER_LIST_SIZE,
}) {
  const sectionsByInstructor = groupSectionsByInstructor(termSections);
  const excluded = new Set([...excludeEmails].map(normalizeEmail));

  const eligible = [];
  for (const observer of professors) {
    const email = normalizeEmail(observer.email);
    if (excluded.has(email)) continue;
    const observerSections = (sectionsByInstructor.get(email) || [])
      .filter((item) => item.term === section.term);
    if (!isEligibleObserver({ section, observee, observer, observerSections }, { excludeCommitteeMembers })) {
      continue;
    }
    eligible.push({
      professor: observer,
      email,
      teachesSameCourse: observerSections.some((item) => item.course_code === section.course_code),
      assignedCount: assignedCounts.get(email) || 0,
      activeCount: activeCounts.get(email) || 0,
    });
  }

  eligible.sort((a, b) =>
    Number(b.teachesSameCourse) - Number(a.teachesSameCourse) ||
    a.assignedCount - b.assignedCount ||
    a.activeCount - b.activeCount ||
    String(a.professor.name || "").localeCompare(String(b.professor.name || "")) ||
    a.email.localeCompare(b.email)
  );

  return {
    eligibleCount: eligible.length,
    candidates: eligible.slice(0, Math.max(0, limit)),
  };
}

module.exports = {
  OBSERVER_LIST_SIZE,
  MATCH_FLAGS,
  RULES,
  courseLevel,
  parseTiming,
  timingsOverlap,
  auditPairing,
  isEligibleObserver,
  flagForListSize,
  groupSectionsByInstructor,
  rankCandidates,
};
