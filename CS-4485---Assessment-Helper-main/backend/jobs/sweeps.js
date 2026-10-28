// Background sweeps. They run inside the server every JOBS_INTERVAL_MINUTES (default 15), or on demand with
// `npm run jobs` / POST /api/admin/jobs/run. Both are safe to run twice: each change is a conditional update,
// so only one runner ever flips a given row (and only that runner sends the notification).
const { env } = require('../config/env');
const { CourseSection, EvaluationCycle, Observation, ObserverMatch } = require('../models');
const { endOfDeadlineDay, startOfUtcDay } = require('../services/dates');
const { now } = require('../services/clock');
const { sectionKey } = require('../services/lookup');
const { notify } = require('../services/notifications');

/**
 * TA Q&A: "invitations should expire after 48 hours."
 * A request nobody answered flips to `expired`, so it stops showing as outstanding and the observee can ask someone else
 * (or re-ask that person). Rows without an expires_at (made before expiry existed) are left alone.
 */
async function expireStaleRequests() {
  const at = now();
  const stale = await ObserverMatch.find({ status: 'requested', expires_at: { $ne: null, $lt: at } }).lean();
  const expired = [];
  for (const m of stale) {
    const result = await ObserverMatch.updateOne({ _id: m._id, status: 'requested' }, { $set: { status: 'expired' } });
    if (result.modifiedCount !== 1) continue; // someone answered it a moment ago
    expired.push({ sectionId: sectionKey(m), observerEmail: m.observer_email });
    await notify({
      recipientEmail: m.observer_email,
      type: 'REQUEST_EXPIRED',
      message: `An observation request you did not answer within ${env.requestExpiryHours} hours has expired.`,
      section: m,
    });
  }
  return { expiredCount: expired.length, expired };
}

/**
 * A confirmed observation whose date has passed with nothing signed becomes `missed` (the "Missing Observation Count" KPI).
 * One that was confirmed but never given a date is missed once the cycle's observation deadline passes.
 * A `missed` observation can be rescheduled (PATCH .../schedule) while the observation period is still open.
 */
async function markMissedObservations() {
  const at = now();
  const today = startOfUtcDay(at);
  const candidates = await Observation.find({ status: 'scheduled', observer_signed_date: null, observee_signed_date: null }).lean();
  if (!candidates.length) return { missedCount: 0, missed: [] };

  const sections = await CourseSection.find({ term: { $in: [...new Set(candidates.map((o) => o.term))] } }).lean();
  const cycles = await EvaluationCycle.find({}).lean();
  const missed = [];

  for (const o of candidates) {
    const section = sections.find((s) => sectionKey(s) === sectionKey(o));
    if (!section) continue;
    const cycle = cycles.find((c) => c.term === section.term);
    const datePassed = o.observation_date && startOfUtcDay(new Date(o.observation_date)) < today;
    const neverScheduledAndClosed = !o.observation_date && cycle && at > endOfDeadlineDay(cycle.observation_deadline);
    if (!datePassed && !neverScheduledAndClosed) continue;

    const result = await Observation.updateOne(
      {
        course_code: o.course_code, section_number: o.section_number, term: o.term, status: 'scheduled', observer_signed_date: null, observee_signed_date: null,
      },
      {
        $set: { status: 'missed' },
        $push: { status_history: { at, by: 'system', from: 'scheduled', to: 'missed', note: datePassed ? 'observation date passed without signatures' : 'no date set before the observation deadline' } },
      }
    );
    if (result.modifiedCount !== 1) continue;
    missed.push({ sectionId: sectionKey(o) });
    for (const recipientEmail of [o.observee_email || section.instructor_email, o.observer_email].filter(Boolean)) {
      await notify({
        recipientEmail,
        type: 'OBSERVATION_MISSED',
        message: `The observation of ${section.course_code} did not take place. It can be rescheduled while the observation period is open.`,
        section,
      });
    }
  }
  return { missedCount: missed.length, missed };
}

async function runAllSweeps() {
  const expiry = await expireStaleRequests();
  const missed = await markMissedObservations();
  return { expiredRequests: expiry.expiredCount, missedObservations: missed.missedCount, details: { expiry, missed } };
}

/** Start the in-process timer. Returns a function that stops it. */
function startSweepTimer(minutes = env.jobsIntervalMinutes) {
  if (!minutes) return () => {};
  const timer = setInterval(() => {
    runAllSweeps().catch((err) => console.error('[sweeps] failed:', err));
  }, minutes * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = {
  expireStaleRequests,
  markMissedObservations,
  runAllSweeps,
  startSweepTimer,
};
