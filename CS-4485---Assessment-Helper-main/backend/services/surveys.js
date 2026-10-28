// The end-of-process survey, built so the committee can see THAT someone answered but never WHO wrote which answer.
//
//   surveys          (the team's collection) the LEDGER: professor_email + term + submitted day. No answers.
//   surveyresponses  the ANSWERS: a random UUID as _id, the term, the template version and the answers. No email, no
//                    timestamp, nothing that points at a person. (An ObjectId would not do as an id: it contains the
//                    moment it was created, which could be matched against the ledger.)
//   surveytemplates  the versioned question list; each response remembers which version it answered.
//
// What the committee can read: the counts from the ledger, and the answers in random order. Below SURVEY_MIN_RESPONSES
// answers for a term it gets counts only, because one or two answers can be traced to a person by elimination.
//
// Honest limit: this protects against the committee and against anyone using the API. A person with direct access to the
// database could still compare insertion order with the ledger; random ids and day-precision dates make that harder, not
// impossible. Do not describe it as stronger than that.
const { randomUUID } = require('node:crypto');
const { env } = require('../config/env');
const {
  CourseSection, Observation, Professor, Survey, SurveyResponse, SurveyTemplate,
} = require('../models');
const { badRequest, conflict } = require('../middleware/errors');
const { now } = require('./clock');
const { endOfDeadlineDay, startOfUtcDay, toIsoDay } = require('./dates');
const {
  findForSections, getCycleOr404, observationsOfProfessor, requireTerm,
} = require('./lookup');

const TEMPLATE_ID = 'end-of-process';
const LEGACY_TEMPLATE_ID = 'legacy-v0';

const DEFAULT_TEMPLATE = {
  template_id: TEMPLATE_ID,
  version: 1,
  title: 'End-of-Process Survey & Feedback',
  active: true,
  questions: [
    { key: 'process_ok', label: 'Was this observation process OK?', type: 'yes_no', required: true },
    { key: 'difficulties', label: 'List your difficulties', type: 'text', required: false, max_length: 2000 },
    { key: 'improvements', label: 'Opinion on how to improve the process', type: 'text', required: false, max_length: 2000 },
  ],
};

// Answers that were written before the anonymous design (the team's seed data): process_rating / positive / negative.
const LEGACY_TEMPLATE = {
  template_id: LEGACY_TEMPLATE_ID,
  version: 1,
  title: 'Earlier survey (before anonymous answers)',
  active: false,
  questions: [
    { key: 'process_rating', label: 'Process rating', type: 'rating', required: false, min: 1, max: 5 },
    { key: 'positive_feedback', label: 'What went well', type: 'text', required: false, max_length: 2000 },
    { key: 'negative_feedback', label: 'What went badly', type: 'text', required: false, max_length: 2000 },
  ],
};

async function ensureTemplate(definition) {
  const existing = await SurveyTemplate.findOne({ template_id: definition.template_id, version: definition.version }).lean();
  if (existing) return existing;
  try {
    const created = await SurveyTemplate.create({ ...definition, created_at: now() });
    return created.toObject ? created.toObject() : created;
  } catch (err) {
    if (err && err.code === 11000) return SurveyTemplate.findOne({ template_id: definition.template_id, version: definition.version }).lean();
    throw err;
  }
}

/** The template people answer today (highest active version); created on first use. */
async function getActiveTemplate() {
  await ensureTemplate(DEFAULT_TEMPLATE);
  const active = await SurveyTemplate.find({ template_id: TEMPLATE_ID, active: true }).lean();
  return active.sort((a, b) => b.version - a.version)[0];
}

async function listTemplates() {
  await ensureTemplate(DEFAULT_TEMPLATE);
  return SurveyTemplate.find({}).sort({ template_id: 1, version: -1 }).lean();
}

const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const pick = (body, key) => (body[key] !== undefined ? body[key] : body[camel(key)]);

/** The answers a person sent, checked against the template. Accepts snake_case or camelCase keys, flat or under `answers`. */
function validateAnswers(template, body) {
  const source = body && typeof body.answers === 'object' && body.answers && !Array.isArray(body.answers) ? { ...body, ...body.answers } : body;
  const answers = {};
  const problems = [];
  for (const q of template.questions) {
    const raw = pick(source, q.key);
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (empty) {
      if (q.required) problems.push(`"${q.key}" is required.`);
      continue;
    }
    if (q.type === 'yes_no') {
      if (typeof raw === 'boolean') answers[q.key] = raw;
      else if (['yes', 'ok'].includes(String(raw).toLowerCase())) answers[q.key] = true;
      else if (['no', 'not_ok'].includes(String(raw).toLowerCase())) answers[q.key] = false;
      else problems.push(`"${q.key}" must be true or false.`);
    } else if (q.type === 'rating') {
      if (Number.isInteger(raw) && raw >= q.min && raw <= q.max) answers[q.key] = raw;
      else problems.push(`"${q.key}" must be a whole number from ${q.min} to ${q.max}.`);
    } else if (typeof raw !== 'string') {
      problems.push(`"${q.key}" must be text.`);
    } else if (raw.length > (q.max_length || 2000)) {
      problems.push(`"${q.key}" is longer than ${q.max_length || 2000} characters.`);
    } else {
      answers[q.key] = raw.trim();
    }
  }
  if (problems.length) throw badRequest('Some survey answers are not valid.', { details: problems });
  return answers;
}

/**
 * Submit the survey. Two writes that must never be joined by anything:
 *   1. the ledger row (who finished; its unique index is also the "only once per term" guard)
 *   2. the answers (random id, no identity)
 * and the response to the caller says only that it worked.
 */
async function submitSurvey(user, body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const term = requireTerm(input.term);
  const cycle = await getCycleOr404(term);
  const { observations } = await observationsOfProfessor(user.email, term);
  if (!observations.some((o) => o.status === 'completed')) {
    throw conflict(`You can take the survey after your ${term} observation is completed.`, { code: 'NOT_OBSERVED' });
  }
  const at = now();
  if (at > endOfDeadlineDay(cycle.feedback_deadline)) throw conflict(`The ${term} survey closed on ${toIsoDay(cycle.feedback_deadline)}.`, { code: 'SURVEY_CLOSED' });

  const template = await getActiveTemplate();
  const answers = validateAnswers(template, input);
  const attachment = input.has_attachment !== undefined ? input.has_attachment : input.hasAttachment;
  if (attachment !== undefined && typeof attachment !== 'boolean') throw badRequest('has_attachment must be true or false.');

  const day = startOfUtcDay(at); // the ledger keeps the day only
  try {
    await Survey.create({
      professor_email: user.email, term, process_rating: null, positive_feedback: '', negative_feedback: '', uploaded_file: null, submitted_date: day,
    });
  } catch (err) {
    if (err && err.code === 11000) throw conflict(`You have already submitted the ${term} survey.`, { code: 'ALREADY_SUBMITTED' });
    throw err;
  }
  try {
    await SurveyResponse.create({
      _id: randomUUID(), term, template_id: template.template_id, template_version: template.version, answers, has_attachment: Boolean(attachment),
    });
  } catch (err) {
    await Survey.deleteMany({ professor_email: user.email, term }); // nothing was saved, so let them try again
    throw err;
  }
  return { submitted: true, term, submittedDate: day };
}

/** Has this person finished the survey for the term, and may they still? (No answers, ever.) */
async function surveyStatus(user, term) {
  const cycle = await getCycleOr404(term);
  const ledger = await Survey.findOne({ professor_email: user.email, term }).lean();
  const { observations } = await observationsOfProfessor(user.email, term);
  const completed = observations.some((o) => o.status === 'completed');
  const closed = now() > endOfDeadlineDay(cycle.feedback_deadline);
  return {
    term,
    submitted: Boolean(ledger),
    submittedDate: ledger ? ledger.submitted_date : null,
    eligible: completed,
    closed,
    deadline: cycle.feedback_deadline,
    canSubmit: completed && !closed && !ledger,
  };
}

const answerOf = (response, key) => (response.answers ? response.answers[key] : undefined);

/**
 * What the Assessment Committee sees for a term: how many finished (from the ledger) and the anonymous answers (from the
 * responses), in the order of their random ids. Below SURVEY_MIN_RESPONSES the answers are withheld.
 */
async function surveyResults(term, paging) {
  await getCycleOr404(term);
  const [ledger, responses, professorCount] = await Promise.all([
    Survey.find({ term }).lean(),
    SurveyResponse.find({ term }).sort({ _id: 1 }).lean(),
    Professor.countDocuments({}),
  ]);
  // Only completed observations may answer, so that is who is expected to.
  const sections = await CourseSection.find({ term }).lean();
  const completed = (await findForSections(Observation, sections)).filter((o) => o.status === 'completed');

  const withheld = responses.length < env.surveyMinResponses;
  const ok = responses.filter((r) => answerOf(r, 'process_ok') === true).length;
  const notOk = responses.filter((r) => answerOf(r, 'process_ok') === false).length;
  const visible = withheld ? [] : responses;
  const page = visible.slice(paging.skip, paging.skip + paging.pageSize);
  return {
    term,
    submittedCount: ledger.length,
    expectedCount: completed.length,
    totalProfessors: professorCount,
    completionRate: completed.length ? Number((ledger.length / completed.length).toFixed(4)) : 0,
    responseCount: responses.length,
    detailsWithheld: withheld,
    minResponsesForDetails: env.surveyMinResponses,
    summary: withheld ? null : { processOk: ok, processNotOk: notOk },
    responses: page.map((r) => ({
      responseId: r._id, templateId: r.template_id, templateVersion: r.template_version, answers: r.answers || {}, hasAttachment: Boolean(r.has_attachment),
    })),
    pagination: {
      page: paging.page, pageSize: paging.pageSize, total: visible.length, totalPages: Math.max(1, Math.ceil(visible.length / paging.pageSize)), hasNext: paging.skip + paging.pageSize < visible.length,
    },
  };
}

/**
 * One-time clean-up for surveys written before this design (the seed has some): move each row's answers into an anonymous
 * response and blank them in the ledger. Safe to run again (rows with nothing left to move are skipped).
 */
async function anonymizeLegacySurveys() {
  await ensureTemplate(LEGACY_TEMPLATE);
  const rows = await Survey.find({}).lean();
  let moved = 0;
  for (const row of rows) {
    const hasAnswers = (typeof row.process_rating === 'number') || (row.positive_feedback && row.positive_feedback.trim()) || (row.negative_feedback && row.negative_feedback.trim());
    if (!hasAnswers && !row.uploaded_file) continue;
    const answers = {};
    if (typeof row.process_rating === 'number') answers.process_rating = row.process_rating;
    if (row.positive_feedback && row.positive_feedback.trim()) answers.positive_feedback = row.positive_feedback.trim();
    if (row.negative_feedback && row.negative_feedback.trim()) answers.negative_feedback = row.negative_feedback.trim();
    await SurveyResponse.create({
      _id: randomUUID(), term: row.term, template_id: LEGACY_TEMPLATE_ID, template_version: LEGACY_TEMPLATE.version, answers, has_attachment: Boolean(row.uploaded_file),
    });
    await Survey.updateOne({ professor_email: row.professor_email, term: row.term }, { $set: { process_rating: null, positive_feedback: '', negative_feedback: '', uploaded_file: null } });
    moved += 1;
  }
  return { checked: rows.length, moved };
}

module.exports = {
  TEMPLATE_ID, LEGACY_TEMPLATE_ID, DEFAULT_TEMPLATE, getActiveTemplate, listTemplates, validateAnswers, submitSurvey, surveyStatus, surveyResults, anonymizeLegacySurveys,
};
