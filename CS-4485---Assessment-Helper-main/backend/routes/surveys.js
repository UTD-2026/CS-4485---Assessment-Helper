const express = require('express');
const { Survey } = require('../models');
const { requireAc } = require('../middleware/auth');
const { asyncHandler, notFound } = require('../middleware/errors');
const { currentCycle } = require('../services/cycles');
const { requireTerm } = require('../services/lookup');
const { parsePaging } = require('../services/paging');
const {
  getActiveTemplate, listTemplates, submitSurvey, surveyResults, surveyStatus,
} = require('../services/surveys');

const router = express.Router();

const termOf = async (query) => (query.term ? requireTerm(query.term) : (await currentCycle()).term);

/** GET /api/surveys/templates -> every survey template (all versions; `active` marks the one people answer today) */
router.get('/templates', asyncHandler(async (req, res) => {
  res.json({ templates: await listTemplates() });
}));

/** GET /api/surveys/templates/active -> the questions to show right now (id, version, questions with their types) */
router.get('/templates/active', asyncHandler(async (req, res) => {
  res.json({ template: await getActiveTemplate() });
}));

/** GET /api/surveys/templates/:templateId -> the newest version of one template */
router.get('/templates/:templateId', asyncHandler(async (req, res) => {
  const found = (await listTemplates()).filter((t) => t.template_id === req.params.templateId);
  if (!found.length) throw notFound('Survey template not found.');
  res.json({ template: found[0] });
}));

/**
 * GET /api/surveys/status?term=Fall 2026 -> have I answered, may I still, when does it close? (never any answers)
 */
router.get('/status', asyncHandler(async (req, res) => {
  res.json(await surveyStatus(req.user, await termOf(req.query)));
}));

/**
 * POST /api/surveys   { term, process_ok: true, difficulties?, improvements?, has_attachment? }
 * (camelCase names work too; the questions come from GET /api/surveys/templates/active.)
 * Allowed once your observation for that term is completed, until the feedback deadline, once per term.
 * Your answers are saved WITHOUT your identity: the reply says only that it worked, and nobody - including the committee -
 * can tell which answers are yours. Only the fact that you finished is recorded against your name.
 */
router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ survey: await submitSurvey(req.user, req.body) });
}));

/** GET /api/surveys/mine -> the terms you have finished the survey for (a completion record, never your answers) */
router.get('/mine', asyncHandler(async (req, res) => {
  const rows = await Survey.find({ professor_email: req.user.email }).sort({ submitted_date: -1 }).lean();
  res.json({ surveys: rows.map((r) => ({ term: r.term, submittedDate: r.submitted_date })) });
}));

/**
 * GET /api/surveys?term=Fall 2026&page=1&pageSize=25   (AC)
 * Counts (how many finished, out of how many expected) and the anonymous answers in random order. Fewer than
 * SURVEY_MIN_RESPONSES answers -> counts only (`detailsWithheld: true`). Never includes who answered.
 */
router.get('/', requireAc, asyncHandler(async (req, res) => {
  res.json(await surveyResults(await termOf(req.query), parsePaging(req.query)));
}));

module.exports = router;
