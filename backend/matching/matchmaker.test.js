// Run with: npm test (from backend/)
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OBSERVER_LIST_SIZE,
  MATCH_FLAGS,
  courseLevel,
  parseTiming,
  timingsOverlap,
  auditPairing,
  flagForListSize,
  rankCandidates,
} = require("./matchmaker");

const TERM = "Fall 2026";
const prof = (email, name, extra = {}) => ({
  email, name, department: "CS", hire_level: "full", is_ac_member: false, ...extra,
});
const section = (course_code, section_number, timing, instructor_email, term = TERM) => ({
  course_code, section_number, term, timing, instructor_email,
});

test("courseLevel reads the first digit of the course number", () => {
  assert.equal(courseLevel("CS 2117"), "2");
  assert.equal(courseLevel("CS 5010"), "5");
  assert.equal(courseLevel("MATH3311"), "3");
  assert.equal(courseLevel("CS"), null);
  assert.equal(courseLevel(""), null);
  assert.equal(courseLevel(undefined), null);
});

test("parseTiming handles database and display formats", () => {
  assert.deepEqual(parseTiming("MW 08:30-09:45"), { days: new Set(["M", "W"]), start: 510, end: 585 });
  assert.deepEqual(parseTiming("TT 13:00-14:15"), { days: new Set(["T", "R"]), start: 780, end: 855 });
  assert.deepEqual(parseTiming("TR 2:00 PM - 3:15 PM"), { days: new Set(["T", "R"]), start: 840, end: 915 });
  assert.deepEqual(parseTiming("MW 12:00 PM - 1:15 PM"), { days: new Set(["M", "W"]), start: 720, end: 795 });
  assert.deepEqual(parseTiming("F 1:00 - 3:45 PM"), { days: new Set(["F"]), start: 780, end: 945 });
  assert.equal(parseTiming("MW 8:30 AM"), null);
  assert.equal(parseTiming("XY 08:30-09:45"), null);
  assert.equal(parseTiming("MW 10:00-09:00"), null);
  assert.equal(parseTiming("MW 24:00-25:00"), null);
  assert.equal(parseTiming(""), null);
});

test("timingsOverlap needs a shared day and overlapping times", () => {
  assert.equal(timingsOverlap("MW 08:30-09:45", "MW 08:30-09:45"), true);
  assert.equal(timingsOverlap("MW 08:30-09:45", "MW 09:00-10:15"), true, "partial overlap");
  assert.equal(timingsOverlap("MW 08:30-09:45", "MW 09:45-11:00"), false, "back to back");
  assert.equal(timingsOverlap("MW 08:30-09:45", "TT 08:30-09:45"), false, "different days");
  assert.equal(timingsOverlap("TT 10:00-11:15", "TR 10:00 AM - 11:15 AM"), true, "TT equals TR");
  assert.equal(timingsOverlap("MW 08:30-09:45", "M 09:00 AM - 09:30 AM"), true, "one shared day is enough");
  assert.equal(timingsOverlap("MW 08:30-09:45", "garbage"), true, "unreadable counts as a conflict");
});

test("auditPairing reports each broken rule", () => {
  const observed = section("CS 2305", "001", "TT 10:00-11:15", "a@x.edu");
  const observee = prof("a@x.edu", "A");

  assert.deepEqual(auditPairing({ section: observed, observee, observer: observee, observerSections: [] }), ["SAME_PROF"]);

  const ok = prof("b@x.edu", "B");
  assert.deepEqual(auditPairing({
    section: observed, observee, observer: ok,
    observerSections: [section("CS 2336", "002", "MW 10:00-11:15", "b@x.edu")],
  }), []);

  assert.deepEqual(auditPairing({
    section: observed, observee, observer: prof("c@x.edu", "C", { department: "MATH" }),
    observerSections: [section("CS 2336", "003", "MW 10:00-11:15", "c@x.edu")],
  }), ["OTHER_DEPT"]);

  assert.deepEqual(auditPairing({
    section: observed, observee, observer: prof("d@x.edu", "D"),
    observerSections: [section("CS 3345", "001", "MW 10:00-11:15", "d@x.edu")],
  }), ["DIFFERENT_LEVEL"]);

  assert.deepEqual(auditPairing({
    section: observed, observee, observer: prof("e@x.edu", "E"),
    observerSections: [
      section("CS 2336", "004", "MW 10:00-11:15", "e@x.edu"),
      section("CS 4348", "001", "TT 10:30-11:45", "e@x.edu"),
    ],
  }), ["SCHEDULE_CONFLICT"], "a conflict in another course still counts");

  assert.deepEqual(auditPairing({
    section: observed, observee, observer: prof("f@x.edu", "F"), observerSections: [],
  }), ["DIFFERENT_LEVEL"], "teaching nothing this term");

  assert.deepEqual(auditPairing({
    section: section("CS", "001", "TT 10:00-11:15", "a@x.edu"), observee, observer: ok,
    observerSections: [section("CS 2336", "002", "MW 10:00-11:15", "b@x.edu")],
  }), ["DIFFERENT_LEVEL"], "unknown course level never matches");
});

test("department and email comparisons ignore case and spacing", () => {
  const observed = section("CS 2305", "001", "TT 10:00-11:15", "a@x.edu");
  assert.deepEqual(auditPairing({
    section: observed,
    observee: prof("A@X.edu ", "A", { department: "cs" }),
    observer: prof("b@x.edu", "B", { department: " CS" }),
    observerSections: [section("CS 2336", "002", "MW 10:00-11:15", "b@x.edu")],
  }), []);
  assert.deepEqual(auditPairing({
    section: observed, observee: prof("a@x.edu", "A"), observer: prof(" A@X.EDU", "A"), observerSections: [],
  }), ["SAME_PROF"]);
});

test("flagForListSize matches the KPI dashboard flags", () => {
  assert.equal(flagForListSize(0), MATCH_FLAGS.NONE);
  assert.equal(flagForListSize(1), MATCH_FLAGS.INSUFFICIENT);
  assert.equal(flagForListSize(OBSERVER_LIST_SIZE - 1), MATCH_FLAGS.INSUFFICIENT);
  assert.equal(flagForListSize(OBSERVER_LIST_SIZE), MATCH_FLAGS.OK);
  assert.equal(MATCH_FLAGS.NONE, "NO ELIGIBLE OBSERVER");
  assert.equal(MATCH_FLAGS.INSUFFICIENT, "INSUFFICIENT OBSERVERS");
});

test("rankCandidates filters, ranks and limits", () => {
  const observee = prof("obs@x.edu", "Observee");
  const observed = section("CS 2305", "001", "TT 10:00-11:15", "obs@x.edu");
  const professors = [
    observee,
    prof("same@x.edu", "Zed SameCourse"),
    prof("busy@x.edu", "Amy Busy"),
    prof("free@x.edu", "Bob Free"),
    prof("free2@x.edu", "Bob Free"),
    prof("conflict@x.edu", "Cal Conflict"),
    prof("level@x.edu", "Dee Level"),
    prof("ac@x.edu", "Eve Committee", { is_ac_member: true }),
    prof("math@x.edu", "Fay Math", { department: "MATH" }),
    prof("old@x.edu", "Gus OldTerm"),
    prof("prior@x.edu", "Hal Prior"),
  ];
  const termSections = [
    observed,
    section("CS 2305", "002", "MW 10:00-11:15", "same@x.edu"),
    section("CS 2336", "001", "MW 08:30-09:45", "busy@x.edu"),
    section("CS 2336", "002", "MW 13:00-14:15", "free@x.edu"),
    section("CS 2336", "003", "MW 14:30-15:45", "free2@x.edu"),
    section("CS 2336", "004", "TT 10:00-11:15", "conflict@x.edu"),
    section("CS 3345", "001", "MW 08:30-09:45", "level@x.edu"),
    section("CS 2336", "005", "MW 11:30-12:45", "ac@x.edu"),
    section("CS 2336", "006", "MW 11:30-12:45", "math@x.edu"),
    section("CS 2336", "007", "MW 11:30-12:45", "old@x.edu", "Spring 2026"),
    section("CS 2336", "008", "MW 11:30-12:45", "prior@x.edu"),
  ];
  const assignedCounts = new Map([["busy@x.edu", 2]]);
  const activeCounts = new Map([["free@x.edu", 1]]);

  const all = rankCandidates({ section: observed, observee, professors, termSections, assignedCounts, activeCounts, limit: 10 });
  assert.deepEqual(all.candidates.map((c) => c.email), [
    "same@x.edu",   // teaches the same course
    "free2@x.edu",  // 0 assigned, 0 open lists ("Bob Free" tie broken by email)
    "prior@x.edu",  // 0 assigned, 0 open lists
    "free@x.edu",   // 0 assigned, 1 open list
    "busy@x.edu",   // 2 assigned
  ]);
  assert.equal(all.eligibleCount, 5);

  const limited = rankCandidates({ section: observed, observee, professors, termSections, limit: 2 });
  assert.equal(limited.candidates.length, 2);
  assert.equal(limited.eligibleCount, 5);

  const excluded = rankCandidates({
    section: observed, observee, professors, termSections, excludeEmails: new Set(["SAME@x.edu"]),
  });
  assert.ok(!excluded.candidates.some((c) => c.email === "same@x.edu"), "excludeEmails is case-insensitive");

  const withCommittee = rankCandidates({
    section: observed, observee, professors, termSections, excludeCommitteeMembers: false, limit: 10,
  });
  assert.ok(withCommittee.candidates.some((c) => c.email === "ac@x.edu"));

  const none = rankCandidates({ section: observed, observee, professors, termSections, limit: 0 });
  assert.equal(none.candidates.length, 0);
  assert.equal(none.eligibleCount, 5);
});
