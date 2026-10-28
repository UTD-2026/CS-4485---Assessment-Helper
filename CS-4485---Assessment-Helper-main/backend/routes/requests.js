const express = require('express');
const { CourseSection, Observation, ObserverMatch, Professor } = require('../models');
const { publicProfessor } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/errors');
const { now } = require('../services/clock');
const { findForSections, sectionKey } = require('../services/lookup');
const { presentObservation } = require('../services/visibility');
const { finalizeObserver, respondToRequest, sendRequests } = require('../services/workflow');

const router = express.Router();

/**
 * POST /api/observation-requests   { "sectionId": "...", "observerEmails": ["a@x.edu", "b@x.edu"] }
 * The observee asks some or all of the suggested observers. Each request shows the class meeting time and
 * expires 48 hours after it is sent.
 */
router.post('/', asyncHandler(async (req, res) => {
  const { sectionId, observerEmails } = req.body || {};
  if (!sectionId) throw badRequest('sectionId is required.');
  res.status(201).json(await sendRequests(req.user, sectionId, observerEmails));
}));

/**
 * GET /api/observation-requests/incoming
 * Requests addressed to you, newest first, each with the class, its days/time, who is asking, and when it expires.
 */
router.get('/incoming', asyncHandler(async (req, res) => {
  const matches = await ObserverMatch.find({ observer_email: req.user.email, status: { $ne: 'suggested' } }).lean();
  const [sections, observations] = await Promise.all([findForSections(CourseSection, matches), findForSections(Observation, matches)]);
  const people = await Professor.find({ email: { $in: sections.map((s) => s.instructor_email) } }).lean();
  const at = now();
  const requests = matches.map((m) => {
    const section = sections.find((s) => sectionKey(s) === sectionKey(m));
    const observation = observations.find((o) => sectionKey(o) === sectionKey(m));
    const observee = people.find((p) => p.email === (observation && observation.observee_email ? observation.observee_email : section && section.instructor_email));
    const msLeft = m.status === 'requested' && m.expires_at ? new Date(m.expires_at).getTime() - at.getTime() : null;
    return {
      sectionId: sectionKey(m),
      status: m.status,
      requestedDate: m.requested_date,
      expiresAt: m.expires_at || null,
      hoursLeft: msLeft === null ? null : Math.max(0, Number((msLeft / 3600000).toFixed(1))),
      observee: observee ? publicProfessor(observee) : null,
      section: section || null,
      observationStatus: observation ? observation.status : null,
    };
  }).sort((a, b) => new Date(b.requestedDate || 0) - new Date(a.requestedDate || 0));
  res.json({ requests });
}));

/**
 * POST /api/observation-requests/:sectionId/respond   { "response": "CONFIRM" | "DECLINE" }   (you are the observer)
 *   CONFIRM  first one wins: the observation is scheduled with you, and every other open request for that signup is
 *            cancelled automatically (and those people are told).
 *            (With CONFIRMATION_MODE=observee_final your yes is recorded as "accepted" and the observee makes the final pick.)
 *   DECLINE  affects only you.
 *   A request older than 48 hours answers 410 and becomes "expired".
 */
router.post('/:sectionId/respond', asyncHandler(async (req, res) => {
  const { response } = req.body || {};
  const result = await respondToRequest(req.user, req.params.sectionId, response);
  res.json({ ...result, observation: result.observation ? await presentObservation(req.user, result.observation) : null });
}));

/**
 * POST /api/observation-requests/:sectionId/finalize   { "observerEmail": "..." }   (the observee)
 * Only in CONFIRMATION_MODE=observee_final (the two-step flow): the observee picks ONE of the observers who accepted.
 * That person becomes the observer and everyone else on the list is stood down. In the default first_wins mode this is a 409.
 */
router.post('/:sectionId/finalize', asyncHandler(async (req, res) => {
  const { observerEmail } = req.body || {};
  const result = await finalizeObserver(req.user, req.params.sectionId, observerEmail);
  res.json({ ...result, observation: await presentObservation(req.user, result.observation) });
}));

module.exports = router;
