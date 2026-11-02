// Loads the data most endpoints need and joins it together.
// (About 100 professors and a few hundred sections per term, so loading a term at a time is cheap.)
const { env } = require("../config/env");
const { CourseSection, EvaluationCycle, Observation, ObserverMatch, Professor } = require("../models");
const { compareTerms, isValidTerm } = require("./terms");
const { dueStatusFor, levelLabel } = require("./dueStatus");
const { badRequest, notFound } = require("../middleware/errors");

const sectionKey = (x) => `${x.course_code}|${x.section_number}|${x.term}`;
const keyFilter = ({ course_code, section_number, term }) => ({ course_code, section_number, term });
const toISODate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Today's local date as YYYY-MM-DD. */
function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A deadline stays open for its whole day (closes at 11:59:59 PM). */
const isPastDeadline = (date, now = new Date()) => (date ? todayISO(now) > toISODate(date) : false);

async function getCycles() {
  const cycles = await EvaluationCycle.find({}).lean();
  return cycles.filter((c) => isValidTerm(c.term)).sort((a, b) => compareTerms(a.term, b.term));
}

/** Current term = CURRENT_TERM, else the earliest cycle whose feedback deadline has not passed, else the latest cycle. */
async function getCurrentTerm(cycles) {
  if (env.currentTerm) return env.currentTerm;
  const list = cycles || (await getCycles());
  if (!list.length) return null;
  const open = list.find((c) => !isPastDeadline(c.feedback_deadline));
  return (open || list[list.length - 1]).term;
}

async function resolveTerm(value) {
  if (value) {
    if (!isValidTerm(value)) throw badRequest(`Invalid term "${value}". Use a term such as "Fall 2026".`);
    return value;
  }
  const term = await getCurrentTerm();
  if (!term) throw notFound("No evaluation cycles exist yet.");
  return term;
}

/** email -> Date[] of completed observations where that professor was the observee (all terms). */
async function completedHistory() {
  const [completed, sections] = await Promise.all([
    Observation.find({ status: "completed" }).select("course_code section_number term observation_date observee_signed_date").lean(),
    CourseSection.find({}).select("course_code section_number term instructor_email").lean(),
  ]);
  const instructorByKey = new Map(sections.map((s) => [sectionKey(s), s.instructor_email]));
  const history = new Map();
  for (const o of completed) {
    const email = instructorByKey.get(sectionKey(o));
    const date = o.observation_date || o.observee_signed_date;
    if (!email || !date) continue;
    if (!history.has(email)) history.set(email, []);
    history.get(email).push(new Date(date));
  }
  return history;
}

/** Strip secrets and add display helpers + due status for `term`. */
function presentProfessor(p, dueStatus) {
  const { password_hash: _secret, __v: _v, ...rest } = p;
  return {
    ...rest,
    netid: p.email.split("@")[0],
    hire_level_label: levelLabel(p.hire_level),
    ...(dueStatus ? { evaluation_status: dueStatus } : {}),
  };
}

/** Everything for one term (or every term when `term` is null; due status is then not computed). */
async function loadTermContext(term) {
  const byTerm = term ? { term } : {};
  const [cycle, professors, sections, observations, matches, history] = await Promise.all([
    term ? EvaluationCycle.findOne({ term }).lean() : null,
    Professor.find({}).select("-password_hash").lean(),
    CourseSection.find(byTerm).lean(),
    Observation.find(byTerm).lean(),
    ObserverMatch.find(byTerm).lean(),
    term ? completedHistory() : new Map(),
  ]);
  const profByEmail = new Map(professors.map((p) => [p.email, p]));
  const sectionByKey = new Map(sections.map((s) => [sectionKey(s), s]));
  const sectionsByInstructor = new Map();
  for (const s of sections) {
    if (!sectionsByInstructor.has(s.instructor_email)) sectionsByInstructor.set(s.instructor_email, []);
    sectionsByInstructor.get(s.instructor_email).push(s);
  }
  const due = term ? new Map(professors.map((p) => [p.email, dueStatusFor(p, history.get(p.email), term)])) : new Map();
  return { term, cycle, professors, profByEmail, sections, sectionByKey, sectionsByInstructor, observations, matches, due };
}

/** Observee email for an observation / match (the section's instructor). */
const observeeOf = (ctx, x) => ctx.sectionByKey.get(sectionKey(x))?.instructor_email || null;

module.exports = {
  sectionKey,
  keyFilter,
  toISODate,
  todayISO,
  isPastDeadline,
  getCycles,
  getCurrentTerm,
  resolveTerm,
  completedHistory,
  presentProfessor,
  loadTermContext,
  observeeOf,
};
