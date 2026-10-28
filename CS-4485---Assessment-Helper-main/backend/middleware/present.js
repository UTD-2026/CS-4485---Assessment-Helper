// The database speaks snake_case (course_code, hire_level, observer_email ...) like the team's models; the API speaks
// camelCase (courseCode, hireLevel, observerEmail ...). This converts every JSON response on its way out, so route and
// service code can pass database documents straight through.
//
// It also adds, to any object that is a course section or something keyed by one (observation, observer match, ...):
//   sectionId                                  "CS 2117~001~Fall 2025"  (see services/lookup.js)
// and to a course section itself the facts that are derived from `timing` and `course_code`:
//   days, startTime, endTime, courseLevel      e.g. "TR", "08:30", "09:45", 2
//
// Objects under these keys are DATA written by people (the committee's own form definitions, rating keys), so their
// inner keys are never renamed:  ratings, fields, criteria.
const { meetingOf, levelOf } = require('../services/eligibility');
const { sectionKey } = require('../services/lookup');

const PRESERVE = new Set(['ratings', 'fields', 'criteria']);

/** created_at -> createdAt, data_base64 -> dataBase64. A leading underscore (_id) is left alone. */
const camelKey = (key) => key.replace(/([a-z0-9])_([a-z])/g, (_, a, b) => a + b.toUpperCase());

const isPlain = (value) => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function present(value) {
  if (Array.isArray(value)) return value.map(present);
  if (!isPlain(value)) return value; // Date, ObjectId, Buffer, ...: JSON.stringify knows what to do with them
  const out = {};
  for (const [key, inner] of Object.entries(value)) out[camelKey(key)] = PRESERVE.has(key) ? inner : present(inner);

  const keyed = ['course_code', 'section_number', 'term'].every((k) => typeof value[k] === 'string');
  if (keyed && out.sectionId === undefined) out.sectionId = sectionKey(value);
  if (keyed && typeof value.timing === 'string' && typeof value.instructor_email === 'string') {
    const meeting = meetingOf(value);
    out.days = meeting.days;
    out.startTime = meeting.startTime;
    out.endTime = meeting.endTime;
    out.courseLevel = levelOf(value);
  }
  return out;
}

/** Express middleware: wraps res.json so everything sent goes through present(). */
function presentResponses(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(present(body));
  next();
}

module.exports = { camelKey, present, presentResponses };
