// Small shared lookups used by several routes.
//
// A course section has no id of its own in the team's schema: it is identified by (course_code, section_number, term),
// and observations / observer matches / files point at it with those same three fields. The API shows that identity as
// one string, the "sectionId":   CS 2117~001~Fall 2025      (course code ~ section number ~ term; '~' never appears in the data)
// Use sectionKey() to build it from any document, requireSectionKey() to read one from a request.
const {
  CourseSection, EvaluationCycle, Observation, Professor,
} = require('../models');
const { badRequest, notFound } = require('../middleware/errors');
const { normalizeTerm } = require('./terms');

const SECTION_KEY_SEPARATOR = '~';
const PART = /^[^\u0000-\u001F\u007F~]{1,60}$/; // printable, no '~', not too long

/** The sectionId string for any document that carries course_code, section_number and term. */
const sectionKey = (doc) => [doc.course_code, doc.section_number, doc.term].join(SECTION_KEY_SEPARATOR);

/** "CS 2117~001~Fall 2025" -> {course_code, section_number, term}, or null when it is not in that shape. */
function parseSectionKey(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(SECTION_KEY_SEPARATOR);
  if (parts.length !== 3) return null;
  const [course_code, section_number, term] = parts;
  if (![course_code, section_number, term].every((p) => PART.test(p) && p.trim() === p && p !== '')) return null;
  return { course_code, section_number, term };
}

/** Like parseSectionKey, but a 400 for anything else. The result is safe to use directly as a MongoDB filter (three strings). */
function requireSectionKey(value, label = 'sectionId') {
  const parsed = parseSectionKey(value);
  if (!parsed) throw badRequest(`${label} must look like "CS 2117~001~Fall 2026" (course code ~ section number ~ term).`);
  return parsed;
}

/** The three-field filter that finds one section (and its observation / matches / files). Accepts a key string or a document. */
const sectionFilter = (keyOrDoc) => (typeof keyOrDoc === 'string'
  ? requireSectionKey(keyOrDoc)
  : { course_code: keyOrDoc.course_code, section_number: keyOrDoc.section_number, term: keyOrDoc.term });

/** Documents (observations, matches, ...) whose section is one of `sections`. Cheap query first, exact check second. */
function onlyInSections(docs, sections) {
  const keys = new Set(sections.map(sectionKey));
  return docs.filter((d) => keys.has(sectionKey(d)));
}

/** Observations / matches / ... of the given sections, found with one query. `Model` is any of the section-keyed models. */
async function findForSections(Model, sections, extra = {}, select = null) {
  if (!sections.length) return [];
  let query = Model.find({
    ...extra,
    term: { $in: [...new Set(sections.map((s) => s.term))] },
    course_code: { $in: [...new Set(sections.map((s) => s.course_code))] },
    section_number: { $in: [...new Set(sections.map((s) => s.section_number))] },
  });
  if (select) query = query.select(select);
  return onlyInSections(await query.lean(), sections);
}

function requireTerm(value, label = 'term') {
  const term = normalizeTerm(value);
  if (!term) throw badRequest(`${label} must look like "Fall 2026" (a configured season followed by a 4-digit year).`);
  return term;
}

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

async function getSectionOr404(sectionId) {
  const section = await CourseSection.findOne(requireSectionKey(sectionId)).lean();
  if (!section) throw notFound('Course section not found.');
  return section;
}

async function getCycleOr404(term) {
  const cycle = await EvaluationCycle.findOne({ term }).lean();
  if (!cycle) throw notFound(`No evaluation cycle exists for ${term}.`);
  return cycle;
}

/** Who signed up: stored on API-created signups, otherwise the section's instructor (seeded data). */
const observeeEmailOf = (observation, section) => observation.observee_email || section.instructor_email;

/** Observation + its section + both people, or a 404. `filter` is the three-field filter for this section. */
async function loadObservation(sectionId) {
  const filter = requireSectionKey(sectionId);
  const observation = await Observation.findOne(filter).lean();
  if (!observation) throw notFound('No signup/observation exists for that course section.');
  const section = await CourseSection.findOne(filter).lean();
  if (!section) throw notFound('Course section not found.');
  const observee = await Professor.findOne({ email: observeeEmailOf(observation, section) }).lean();
  const observer = observation.observer_email ? await Professor.findOne({ email: observation.observer_email }).lean() : null;
  return {
    observation, section, observee, observer, filter, sectionId: sectionKey(section),
  };
}

/** All of one professor's observations in one term (they have at most one, but this is how we look it up). */
async function observationsOfProfessor(email, term) {
  const sections = await CourseSection.find({ instructor_email: email, term }).lean();
  const observations = await findForSections(Observation, sections);
  return { sections, observations };
}

module.exports = {
  SECTION_KEY_SEPARATOR,
  sectionKey,
  parseSectionKey,
  requireSectionKey,
  sectionFilter,
  onlyInSections,
  findForSections,
  requireTerm,
  normalizeEmail,
  getSectionOr404,
  getCycleOr404,
  observeeEmailOf,
  loadObservation,
  observationsOfProfessor,
};
