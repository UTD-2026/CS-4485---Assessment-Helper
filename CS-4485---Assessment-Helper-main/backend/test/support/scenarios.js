// Finds ready-made situations in the team's seed data (a professor with 9 eligible observers, one with 2, one with 0 ...)
// so the demos and tests do not hard-code names. Uses the backend's own matching code.
const { CourseSection, Observation, Professor } = require('../../models');
const { evaluatePool, loadTermPool } = require('../../services/matching');
const { meetingOf, parseDays } = require('../../services/eligibility');
const { onlyInSections, sectionKey } = require('../../services/lookup');
const { weekdayLetter, toIsoDay, addDays, startOfUtcDay } = require('../../services/dates');

/**
 * For every course section in `term` whose instructor has NOT signed up yet, how many professors would be eligible
 * to observe it? Sorted by instructor name so results are stable.
 */
async function openSectionsWithCounts(term) {
  const pool = await loadTermPool(term);
  const observations = onlyInSections(await Observation.find({ term }).lean(), pool.sections);
  const signedUp = new Set(observations.map(sectionKey));
  const busyInstructors = new Set(pool.sections.filter((s) => signedUp.has(sectionKey(s))).map((s) => s.instructor_email));
  const byEmail = new Map(pool.professors.map((p) => [p.email, p]));

  const rows = [];
  for (const section of pool.sections) {
    if (busyInstructors.has(section.instructor_email)) continue;
    const observee = byEmail.get(section.instructor_email);
    const evaluations = evaluatePool({ observee, section, pool });
    const eligible = evaluations.filter((e) => e.eligible);
    rows.push({
      section, observee, evaluations, eligible, eligibleCount: eligible.length,
    });
  }
  return rows.sort((a, b) => a.observee.name.localeCompare(b.observee.name) || a.section.course_code.localeCompare(b.section.course_code) || a.section.section_number.localeCompare(b.section.section_number));
}

/** Pick scenario sections, each from a DIFFERENT professor: `many` (>=5 eligible), `few` (1-4), `none` (0). */
async function pickScenarios(term, { many = 1, few = 1, none = 1 } = {}) {
  const rows = await openSectionsWithCounts(term);
  const used = new Set();
  const take = (predicate, n) => {
    const out = [];
    for (const r of rows) {
      if (out.length >= n) break;
      if (used.has(r.observee.email) || !predicate(r)) continue;
      used.add(r.observee.email); out.push(r);
    }
    return out;
  };
  return {
    many: take((r) => r.eligibleCount >= 5, many),
    few: take((r) => r.eligibleCount >= 1 && r.eligibleCount <= 4, few),
    none: take((r) => r.eligibleCount === 0, none),
    all: rows,
  };
}

/**
 * The team's seed is one big department (every professor is CS and teaches several levels), so almost every section has
 * 26-35 eligible observers; it has no "nobody qualifies" or "only a couple qualify" situation. To exercise those paths we
 * add three tiny departments next to it, written straight into the collections exactly like seed.mjs does:
 *   MATH  one professor alone                          -> 0 eligible  (the "unmatched" path)
 *   STAT  two professors, same level, different days   -> 1 eligible each
 *   SE    five professors: a few same-level free ones, one same-level but clashing, one at another level -> 3 eligible for SE-B, 2 for SE-A
 * Returns the emails created. Call once, right after loadSeedWorld().
 */
async function addSmallDepartments(term = 'Fall 2026') {
  const template = await Professor.findOne({}).lean();
  const mk = (email, name, department, hire_level) => ({
    email, name, department, hire_level, last_observed: null, password_hash: template.password_hash, is_ac_member: false,
  });
  const people = [
    mk('math.solo@utdallas.edu', 'Mara Solo', 'MATH', 'associate'),
    mk('stat.one@utdallas.edu', 'Stan One', 'STAT', 'assistant'),
    mk('stat.two@utdallas.edu', 'Stella Two', 'STAT', 'full'),
    mk('se.a@utdallas.edu', 'Sean Alpha', 'SE', 'assistant'),
    mk('se.b@utdallas.edu', 'Sadie Bravo', 'SE', 'associate'),
    mk('se.c@utdallas.edu', 'Seth Charlie', 'SE', 'full'),
    mk('se.d@utdallas.edu', 'Sara Delta', 'SE', 'full'),
    mk('se.e@utdallas.edu', 'Sol Echo', 'SE', 'associate'),
  ];
  const sec = (course_code, instructor_email, timing) => ({ course_code, section_number: '001', term, timing, instructor_email });
  const sections = [
    sec('MATH 2414', 'math.solo@utdallas.edu', 'MW 10:00-11:15'),
    sec('STAT 2331', 'stat.one@utdallas.edu', 'TT 10:00-11:15'),
    sec('STAT 2332', 'stat.two@utdallas.edu', 'MW 10:00-11:15'),
    sec('SE 3345', 'se.a@utdallas.edu', 'MW 13:00-14:15'),
    sec('SE 3354', 'se.b@utdallas.edu', 'TT 13:00-14:15'),
    sec('SE 3377', 'se.c@utdallas.edu', 'TT 15:30-16:45'),
    sec('SE 3305', 'se.d@utdallas.edu', 'MW 13:30-14:45'), // same level, but overlaps SE-A's class -> SCHEDULE_CONFLICT
    sec('SE 4390', 'se.e@utdallas.edu', 'TT 08:30-09:45'), // other level -> DIFFERENT_LEVEL
  ];
  await Professor.insertMany(people);
  await CourseSection.insertMany(sections);
  return people.map((p) => p.email);
}

async function sectionsOf(email, term) {
  return CourseSection.find({ instructor_email: email, term }).lean();
}

/** The first date on or after `from` that falls on one of the section's meeting days, as YYYY-MM-DD. */
function nextClassDay(section, from) {
  const { days: letters } = meetingOf(section);
  const days = parseDays(letters);
  let d = startOfUtcDay(new Date(from));
  for (let i = 0; i < 14; i += 1) {
    if (days.includes(weekdayLetter(d))) return toIsoDay(d);
    d = addDays(d, 1);
  }
  throw new Error(`no class day found for ${letters}`);
}

/** A weekday that is NOT one of the section's meeting days, on or after `from`. */
function nextNonClassDay(section, from) {
  const days = parseDays(meetingOf(section).days);
  let d = startOfUtcDay(new Date(from));
  for (let i = 0; i < 14; i += 1) {
    if (!days.includes(weekdayLetter(d))) return toIsoDay(d);
    d = addDays(d, 1);
  }
  throw new Error('every day is a class day?');
}

module.exports = {
  addSmallDepartments, openSectionsWithCounts, pickScenarios, sectionsOf, nextClassDay, nextNonClassDay,
};
