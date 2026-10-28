const express = require('express');
const { env } = require('../config/env');
const { CourseSection, Observation, ObserverMatch, Professor } = require('../models');
const { publicProfessor } = require('../middleware/auth');
const { asyncHandler, badRequest, conflict, forbidden, notFound } = require('../middleware/errors');
const { buildObservationIcs } = require('../services/calendar');
const { toIsoDay } = require('../services/dates');
const { currentCycle } = require('../services/cycles');
const { SIGNED_TEMPLATE, listFiles, loadFileBytes, saveSignedTemplate, signedTemplatesFor } = require('../services/files');
const {
  findForSections, loadObservation, observeeEmailOf, observationsOfProfessor, requireTerm, sectionKey,
} = require('../services/lookup');
const { summarize } = require('../services/observationRecords');
const { candidateFlag } = require('../services/matching');
const { presentObservation, reportAccess, viewObservation } = require('../services/visibility');
const {
  createRecord, reportNotHeld, scheduleObservation, signObservation, updateRecord,
} = require('../services/workflow');

const router = express.Router();

function assertParticipant(req, { observation, observee }, { acAllowed = true } = {}) {
  const email = req.user.email;
  if (email === observee.email || email === observation.observer_email) return;
  if (acAllowed && req.user.is_ac_member) return;
  throw forbidden('Only the observee, the confirmed observer, or an Assessment Committee member can see this.');
}

const withSummary = (observation) => (observation.record ? { ...observation, summary: summarize(observation.record.criteria) } : observation);

/**
 * The observation as THIS person may see it. The report (record, ratings, summary) follows the committee's rule:
 * the observer always; the observee once the observer signed; the committee once both signed (services/visibility.js).
 */
const viewFor = (user, observation, observeeEmail) => viewObservation(user, withSummary(observation), observeeEmail);

/**
 * GET /api/observations/mine?term=Fall 2026
 * Everything you are part of this term: your own signup (asObservee) and the observations you agreed to do (asObserver).
 */
router.get('/mine', asyncHandler(async (req, res) => {
  const term = req.query.term ? requireTerm(req.query.term) : (await currentCycle()).term;
  const own = await observationsOfProfessor(req.user.email, term);
  const termSections = await CourseSection.find({ term }).lean();
  const mine = await findForSections(Observation, termSections, { observer_email: req.user.email });
  const files = await signedTemplatesFor([...own.observations, ...mine]);
  const fileOf = (o) => files.get(sectionKey(o)) || null;
  const asObservee = own.observations.map((o) => ({ observation: viewFor(req.user, o, req.user.email), section: own.sections.find((s) => sectionKey(s) === sectionKey(o)), signedTemplate: fileOf(o) }));
  const asObserver = mine.map((o) => {
    const section = termSections.find((s) => sectionKey(s) === sectionKey(o));
    return { observation: viewFor(req.user, o, observeeEmailOf(o, section)), section, signedTemplate: fileOf(o) };
  });
  res.json({ term, asObservee, asObserver });
}));

/** GET /api/observations/:sectionId -> the observation, its class, and both people (with the form copy, if started) */
router.get('/:sectionId', asyncHandler(async (req, res) => {
  const ctx = await loadObservation(req.params.sectionId);
  assertParticipant(req, ctx);
  const signedTemplate = (await signedTemplatesFor([ctx.observation])).get(sectionKey(ctx.observation)) || null;
  res.json({
    observation: viewFor(req.user, ctx.observation, ctx.observee.email),
    section: ctx.section,
    observee: publicProfessor(ctx.observee),
    observer: ctx.observer ? publicProfessor(ctx.observer) : null,
    signedTemplate,
  });
}));

/**
 * GET /api/observations/:sectionId/candidates   (the observee, or AC)
 * The observer list for a signup, each with their status (suggested / requested / accepted / confirmed / declined / expired / cancelled)
 * and, for requests, when they expire.
 */
router.get('/:sectionId/candidates', asyncHandler(async (req, res) => {
  const ctx = await loadObservation(req.params.sectionId);
  if (req.user.email !== ctx.observee.email && !req.user.is_ac_member) throw forbidden('Only the observee or an AC member can see the observer list.');
  const matches = await ObserverMatch.find(ctx.filter).lean();
  const people = await Professor.find({ email: { $in: matches.map((m) => m.observer_email) } }).lean();
  const byEmail = new Map(people.map((p) => [p.email, p]));
  res.json({
    sectionId: ctx.sectionId,
    observationStatus: ctx.observation.status,
    eligibleCount: typeof ctx.observation.eligible_count === 'number' ? ctx.observation.eligible_count : null,
    flag: typeof ctx.observation.eligible_count === 'number' ? candidateFlag(ctx.observation.eligible_count) : null,
    candidates: matches
      .map((m) => ({ ...m, observer: byEmail.has(m.observer_email) ? publicProfessor(byEmail.get(m.observer_email)) : null }))
      .sort((a, b) => a.status.localeCompare(b.status) || a.observer_email.localeCompare(b.observer_email)),
  });
}));

/**
 * PATCH /api/observations/:sectionId/schedule   { "observationDate": "2026-10-21", "observationTime": "8:30 AM" }
 * (observee or confirmed observer). The time is optional and, if sent, must be when the class starts ("08:30" or "8:30 AM").
 */
router.patch('/:sectionId/schedule', asyncHandler(async (req, res) => {
  const { observationDate, observationTime } = req.body || {};
  if (!observationDate) throw badRequest('observationDate (YYYY-MM-DD) is required.');
  res.json({ observation: await presentObservation(req.user, await scheduleObservation(req.user, req.params.sectionId, observationDate, observationTime)) });
}));

/**
 * POST /api/observations/:sectionId/report-not-held   { "reason": "Class was cancelled" }   (observee or observer)
 * The "Did Not Happen" button. The observation becomes "missed" and can be rescheduled. Only once the scheduled day has
 * arrived, and never after a signature.
 */
router.post('/:sectionId/report-not-held', asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  res.json({ observation: await presentObservation(req.user, await reportNotHeld(req.user, req.params.sectionId, reason)) });
}));

/** POST /api/observations/:sectionId/record -> the observer starts their copy of the template (snapshots the current version) */
router.post('/:sectionId/record', asyncHandler(async (req, res) => {
  res.status(201).json({ observation: await presentObservation(req.user, await createRecord(req.user, req.params.sectionId)) });
}));

/** PUT /api/observations/:sectionId/record   { "values": { "organization": 4, "comments": "..." } }  (observer, until the first signature) */
router.put('/:sectionId/record', asyncHandler(async (req, res) => {
  const { values } = req.body || {};
  res.json({ observation: await presentObservation(req.user, await updateRecord(req.user, req.params.sectionId, values)) });
}));

/** POST /api/observations/:sectionId/sign -> your signature. The first one locks the record; the second completes the observation. */
router.post('/:sectionId/sign', asyncHandler(async (req, res) => {
  const result = await signObservation(req.user, req.params.sectionId);
  res.json({ completed: result.completed, observation: await presentObservation(req.user, result.observation) });
}));

// ------------------------------------------------------------------------------------------------
// Signed observation form (PDF) - "My Duties" in the frontend
// ------------------------------------------------------------------------------------------------

/** Reads the PDF body (Content-Type: application/pdf) up to UPLOAD_MAX_MB; anything else leaves req.body alone. */
const pdfBody = (req, res, next) => express.raw({ type: 'application/pdf', limit: `${env.uploadMaxMb}mb` })(req, res, next);

/**
 * PUT /api/observations/:sectionId/files/signed-template?filename=signed-form.pdf     (the confirmed observer only)
 * Body = the PDF file itself, header  Content-Type: application/pdf.  From a browser:
 *     fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' }, body: file })
 * Uploading again replaces the file. Max size UPLOAD_MAX_MB (5 by default) -> 413 if larger.
 */
const uploadSignedTemplate = asyncHandler(async (req, res) => {
  const name = typeof req.query.filename === 'string' ? req.query.filename : req.get('x-filename');
  res.status(201).json({ file: await saveSignedTemplate(req.user, req.params.sectionId, req.body, name) });
});
router.put('/:sectionId/files/signed-template', pdfBody, uploadSignedTemplate);
router.post('/:sectionId/files/signed-template', pdfBody, uploadSignedTemplate);

/** GET /api/observations/:sectionId/files -> what is on file (names, sizes, who uploaded when), never the bytes */
router.get('/:sectionId/files', asyncHandler(async (req, res) => {
  const ctx = await loadObservation(req.params.sectionId);
  assertParticipant(req, ctx);
  res.json({ sectionId: ctx.sectionId, files: await listFiles(ctx.filter) });
}));

/** GET /api/observations/:sectionId/files/signed-template -> the PDF (the observee, the observer, or an AC member) */
router.get('/:sectionId/files/signed-template', asyncHandler(async (req, res) => {
  const ctx = await loadObservation(req.params.sectionId);
  assertParticipant(req, ctx);
  // The signed form is part of the report, so it follows the same visibility rule as the ratings.
  const access = reportAccess(req.user, ctx.observation, ctx.observee.email);
  if (!access.canView) throw forbidden(access.message, { code: 'REPORT_NOT_AVAILABLE', details: { reason: access.reason } });
  const file = await loadFileBytes(ctx.filter, SIGNED_TEMPLATE);
  if (!file) throw notFound('No signed observation form has been uploaded for this observation yet.');
  res.status(200)
    .set('Content-Type', 'application/pdf')
    .set('Content-Disposition', `attachment; filename="${file.filename}"`)
    .set('X-Content-Type-Options', 'nosniff')
    .set('Cache-Control', 'private, no-store')
    .send(file.bytes);
}));

/**
 * GET /api/observations/:sectionId/calendar.ics -> a calendar file for the scheduled observation (observee, observer, AC).
 * Fetch it with the Authorization header and hand the result to the browser as a download.
 */
router.get('/:sectionId/calendar.ics', asyncHandler(async (req, res) => {
  const ctx = await loadObservation(req.params.sectionId);
  assertParticipant(req, ctx);
  const { observation, section } = ctx;
  if (!observation.observation_date || !['scheduled', 'completed'].includes(observation.status)) {
    throw conflict('There is no scheduled observation date to put in a calendar yet.', { code: 'NOT_SCHEDULED' });
  }
  const file = `observation-${section.course_code.replace(/[^A-Za-z0-9]+/g, '-')}-${toIsoDay(observation.observation_date)}.ics`;
  res.status(200)
    .set('Content-Type', 'text/calendar; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${file}"`)
    .set('Cache-Control', 'private, no-store')
    .send(buildObservationIcs(ctx));
}));

module.exports = router;
