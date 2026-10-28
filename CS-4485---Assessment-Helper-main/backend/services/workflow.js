// The observation workflow, one function per step. Routes stay thin; the demos and tests call these too.
//
//   signup -> (AC runs observer selection) -> observee sends requests -> an observer confirms
//          -> a date is scheduled -> observer fills the form -> both sign -> completed (-> survey)
//
// MongoDB note: nothing here needs a multi-document transaction (a standalone local MongoDB does not support
// them). Every "only one of these may win" step is a single atomic update with the expected state in its
// filter; whoever matches the filter wins, everyone else gets a 409.
const { env } = require('../config/env');
const {
  EligibilityViolation, EvaluationCycle, Observation, ObserverMatch, Professor,
} = require('../models');
const { badRequest, conflict, forbidden, gone, notFound, unprocessable } = require('../middleware/errors');
const { addHours, now } = require('./clock');
const { endOfDeadlineDay, parseIsoDay, startOfUtcDay, toIsoDay, weekdayLetter } = require('./dates');
const {
  describeMeeting: meetingText, meetingOf, normalizeClock, parseDays,
} = require('./eligibility');
const { audit } = require('./audit');
const { getObservationForm } = require('./forms');
const { checkOneCandidate } = require('./matching');
const { applyValues, missingRequired, ratingsFromCriteria, snapshotCriteria, validateValues } = require('./observationRecords');
const { notify } = require('./notifications');
const {
  getCycleOr404, getSectionOr404, loadObservation, normalizeEmail, observationsOfProfessor, requireSectionKey, sectionKey,
} = require('./lookup');

const historyEntry = (at, by, from, to, note) => ({ at, by, from, to, note });
const describeMeeting = (s) => `${s.course_code} sec ${s.section_number} (${meetingText(s)})`;

// ------------------------------------------------------------------------------------------------
// 1. Signup
// ------------------------------------------------------------------------------------------------
async function createSignup(user, sectionId) {
  const section = await getSectionOr404(sectionId);
  if (section.instructor_email !== user.email) throw forbidden('You can only sign up with a course section that you teach.');

  const cycle = await EvaluationCycle.findOne({ term: section.term }).lean();
  if (!cycle) throw conflict(`There is no evaluation cycle for ${section.term} yet.`, { code: 'NO_CYCLE' });
  const at = now();
  if (env.enforceSignupDeadline && at > endOfDeadlineDay(cycle.signup_deadline)) {
    throw conflict(`Signup for ${section.term} closed on ${toIsoDay(cycle.signup_deadline)}.`, { code: 'SIGNUP_CLOSED' });
  }

  const { observations } = await observationsOfProfessor(user.email, section.term);
  if (observations.length) throw conflict(`You have already signed up for ${section.term} (one signup per professor per term).`, { code: 'ALREADY_SIGNED_UP' });

  try {
    const created = await Observation.create({
      course_code: section.course_code,
      section_number: section.section_number,
      term: section.term,
      observee_email: user.email,
      signup_date: at,
      status: 'signed_up',
      status_history: [historyEntry(at, user.email, null, 'signed_up', 'signup')],
    });
    await audit(user, 'signup.created', { type: 'observation', id: sectionKey(section), term: section.term });
    return created.toObject ? created.toObject() : created;
  } catch (err) {
    if (err && err.code === 11000) throw conflict('You have already signed up for this term.', { code: 'ALREADY_SIGNED_UP' });
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------
// 2. The observee sends requests to some or all of the suggested observers
// ------------------------------------------------------------------------------------------------
async function sendRequests(user, sectionId, observerEmails) {
  if (!Array.isArray(observerEmails) || observerEmails.length === 0 || observerEmails.length > 50) {
    throw badRequest('observerEmails must be a non-empty array (at most 50 addresses).');
  }
  const {
    observation, section, observee, filter,
  } = await loadObservation(sectionId);
  if (observee.email !== user.email) throw forbidden('Only the professor who signed up can send requests.');
  if (observation.status !== 'signed_up') {
    throw conflict(
      observation.status === 'unmatched'
        ? 'No eligible observers were found for this signup, so there is nobody to ask.'
        : `Requests can only be sent while the signup is open; it is currently "${observation.status}".`,
      { code: 'NOT_OPEN' }
    );
  }
  const cycle = await getCycleOr404(section.term);
  const at = now();
  if (at > endOfDeadlineDay(cycle.observation_deadline)) {
    throw conflict(`The observation period ended on ${toIsoDay(cycle.observation_deadline)}.`, { code: 'OBSERVATION_PERIOD_OVER' });
  }

  const matches = await ObserverMatch.find(filter).lean();
  const expiresAt = addHours(at, env.requestExpiryHours);
  const requested = [];
  const rejected = [];

  for (const email of [...new Set(observerEmails.map(normalizeEmail))]) {
    const match = matches.find((m) => m.observer_email === email);
    if (!match) { rejected.push({ observerEmail: email, reason: 'NOT_IN_CANDIDATE_LIST' }); continue; }
    if (!['suggested', 'expired'].includes(match.status)) {
      rejected.push({ observerEmail: email, reason: `ALREADY_${match.status.toUpperCase()}` });
      continue;
    }

    // Defence in depth: re-check the rules now, in case their schedule changed after the list was built.
    const check = await checkOneCandidate({ observee, section, candidateEmail: email });
    if (!check.found) { rejected.push({ observerEmail: email, reason: 'PROFESSOR_NOT_FOUND' }); continue; }
    if (!check.eligible) {
      await EligibilityViolation.create({
        ...filter, observer_email: email, violation: check.violation,
        context: 'Rejected at request time (the candidate list was stale)', created_at: at,
      });
      rejected.push({ observerEmail: email, reason: check.violation, detail: check.detail });
      continue;
    }

    const result = await ObserverMatch.updateOne(
      { _id: match._id, status: match.status },
      { $set: { status: 'requested', requested_date: at, expires_at: expiresAt, responded_date: null } }
    );
    if (result.modifiedCount !== 1) { rejected.push({ observerEmail: email, reason: 'CHANGED_CONCURRENTLY' }); continue; }

    await notify({
      recipientEmail: email,
      type: 'REQUEST_RECEIVED',
      message: `${observee.name} asked you to observe ${describeMeeting(section)} in ${section.term}. Please answer within ${env.requestExpiryHours} hours.`,
      section,
    });
    requested.push({ observerEmail: email, expiresAt });
  }

  if (!requested.length) throw unprocessable('None of those requests could be sent.', { code: 'NOTHING_SENT', details: { rejected } });
  await audit(user, 'requests.sent', { type: 'observation', id: sectionKey(section), term: section.term, detail: { observers: requested.map((r) => r.observerEmail), rejected: rejected.length } });
  return { requested, rejected };
}

// ------------------------------------------------------------------------------------------------
// 3. An observer answers.
//
//   CONFIRMATION_MODE=first_wins (default)   CONFIRM: the first observer to say yes IS the observer; the rest are stood down.
//   CONFIRMATION_MODE=observee_final         CONFIRM: only "accepted". The observee picks one (finalizeObserver) and the
//                                            rest are stood down - the two-step flow the current frontend shows.
//   DECLINE (both modes): affects only that observer.
// ------------------------------------------------------------------------------------------------

/** Stand down everyone else on a signup (politely, and only tell those who had actually been asked). Returns who was told. */
async function standDownOthers({ filter, keepMatchId, section, at, statuses }) {
  const siblings = await ObserverMatch.find({ ...filter, _id: { $ne: keepMatchId }, status: { $in: statuses } }).lean();
  const told = [];
  for (const sibling of siblings) {
    const r = await ObserverMatch.updateOne({ _id: sibling._id, status: sibling.status }, { $set: { status: 'cancelled', responded_date: at } });
    if (r.modifiedCount === 1 && sibling.status !== 'suggested') {
      told.push(sibling.observer_email);
      await notify({
        recipientEmail: sibling.observer_email,
        type: 'REQUEST_DECLINED',
        message: 'Thank you for your time - the professor already received a confirmation from another observer for this request.',
        section,
      });
    }
  }
  return told;
}

async function respondToRequest(user, sectionId, response) {
  if (!['CONFIRM', 'DECLINE'].includes(response)) throw badRequest("response must be 'CONFIRM' or 'DECLINE'.");
  const filter = requireSectionKey(sectionId);

  const match = await ObserverMatch.findOne({ ...filter, observer_email: user.email }).lean();
  if (!match) throw notFound('You have no request for that course section.');

  const at = now();
  if (match.status === 'requested' && match.expires_at && at > match.expires_at) {
    await ObserverMatch.updateOne({ _id: match._id, status: 'requested' }, { $set: { status: 'expired' } });
    throw gone(`This request expired ${env.requestExpiryHours} hours after it was sent and can no longer be answered.`, { code: 'REQUEST_EXPIRED' });
  }
  if (match.status !== 'requested') throw conflict(`This request already has status "${match.status}".`, { code: 'NOT_PENDING' });

  if (response === 'DECLINE') {
    const r = await ObserverMatch.updateOne({ _id: match._id, status: 'requested' }, { $set: { status: 'declined', responded_date: at } });
    if (r.modifiedCount !== 1) throw conflict('This request changed while you were answering it. Please reload.', { code: 'CHANGED_CONCURRENTLY' });
    await audit(user, 'request.declined', { type: 'observer_match', id: sectionId, term: match.term });
    return { match: { ...match, status: 'declined', responded_date: at }, observation: null, autoCancelled: [] };
  }

  const { observation: current, section, observee } = await loadObservation(sectionId);

  // ---- two-step mode: record the yes, leave the choice to the observee
  if (env.confirmationMode === 'observee_final') {
    if (current.status !== 'signed_up' || current.observer_email) {
      throw conflict('The observee has already chosen an observer (or the signup is no longer open).', { code: 'ALREADY_CONFIRMED' });
    }
    const r = await ObserverMatch.updateOne({ _id: match._id, status: 'requested' }, { $set: { status: 'accepted', responded_date: at } });
    if (r.modifiedCount !== 1) throw conflict('This request changed while you were answering it. Please reload.', { code: 'CHANGED_CONCURRENTLY' });
    await notify({
      recipientEmail: observee.email,
      type: 'REQUEST_ACCEPTED',
      message: `${user.name} accepted your observation request for ${describeMeeting(section)}. Confirm the observer you want.`,
      section,
    });
    await audit(user, 'request.accepted', { type: 'observer_match', id: sectionId, term: match.term });
    return {
      match: { ...match, status: 'accepted', responded_date: at }, observation: null, autoCancelled: [], awaitingObserveeConfirmation: true,
    };
  }

  // ---- first-wins mode. The observation document is the gate: only ONE observer can flip it from signed_up to scheduled.
  const gate = await Observation.findOneAndUpdate(
    { ...filter, status: 'signed_up', observer_email: null },
    {
      $set: { status: 'scheduled', observer_email: user.email, confirmed_date: at },
      $push: { status_history: historyEntry(at, user.email, 'signed_up', 'scheduled', 'observer confirmed') },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!gate) {
    throw conflict('Another observer has already confirmed this request (or the signup is no longer open).', { code: 'ALREADY_CONFIRMED' });
  }

  const mine = await ObserverMatch.updateOne({ _id: match._id, status: 'requested' }, { $set: { status: 'confirmed', responded_date: at } });
  if (mine.modifiedCount !== 1) {
    // Our own request was changed (e.g. the expiry sweep) between the check and now: undo the gate.
    await Observation.updateOne(
      { ...filter, status: 'scheduled', observer_email: user.email, confirmed_date: at },
      { $set: { status: 'signed_up', observer_email: null, confirmed_date: null }, $push: { status_history: historyEntry(now(), 'system', 'scheduled', 'signed_up', 'confirmation undone: request changed') } }
    );
    throw conflict('This request changed while you were answering it. Please reload.', { code: 'CHANGED_CONCURRENTLY' });
  }

  // TA Q&A: "once the Observee gets a confirmation, the system should automatically send a graceful cancellation
  // to the other observers in that subset."  Only the people who were actually asked get a notification.
  const autoCancelled = await standDownOthers({ filter, keepMatchId: match._id, section, at, statuses: ['requested', 'suggested', 'accepted'] });

  await notify({
    recipientEmail: observee.email,
    type: 'REQUEST_CONFIRMED',
    message: `${user.name} confirmed your observation request for ${describeMeeting(section)}. Next: choose the observation date.`,
    section,
  });
  await audit(user, 'request.confirmed', { type: 'observer_match', id: sectionId, term: match.term, detail: { mode: 'first_wins', standDown: autoCancelled.length } });

  return { match: { ...match, status: 'confirmed', responded_date: at }, observation: gate, autoCancelled };
}

/**
 * Two-step mode only. The observee picks one of the observers who accepted. That observer becomes THE observer, the
 * observation moves to "scheduled", and everyone else on the list is stood down (and told, if they had been asked).
 */
async function finalizeObserver(user, sectionId, observerEmail) {
  if (env.confirmationMode !== 'observee_final') {
    throw conflict('This server uses first-confirmation-wins (CONFIRMATION_MODE=first_wins), so there is nothing to finalize.', { code: 'WRONG_MODE' });
  }
  const email = normalizeEmail(observerEmail);
  if (!email) throw badRequest('observerEmail is required.');
  const {
    observation, section, observee, filter,
  } = await loadObservation(sectionId);
  if (observee.email !== user.email) throw forbidden('Only the professor who signed up can confirm the observer.');
  if (observation.status !== 'signed_up' || observation.observer_email) {
    throw conflict('An observer has already been confirmed (or the signup is no longer open).', { code: 'ALREADY_CONFIRMED' });
  }
  const match = await ObserverMatch.findOne({ ...filter, observer_email: email }).lean();
  if (!match) throw notFound('That person is not on your observer list.');
  if (match.status !== 'accepted') throw conflict(`That observer has not accepted (their request is "${match.status}").`, { code: 'NOT_ACCEPTED' });

  const at = now();
  const gate = await Observation.findOneAndUpdate(
    { ...filter, status: 'signed_up', observer_email: null },
    {
      $set: { status: 'scheduled', observer_email: email, confirmed_date: at },
      $push: { status_history: historyEntry(at, user.email, 'signed_up', 'scheduled', 'observee confirmed the observer') },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!gate) throw conflict('An observer has already been confirmed (or the signup is no longer open).', { code: 'ALREADY_CONFIRMED' });

  await ObserverMatch.updateOne({ _id: match._id, status: 'accepted' }, { $set: { status: 'confirmed', responded_date: at } });
  const autoCancelled = await standDownOthers({ filter, keepMatchId: match._id, section, at, statuses: ['requested', 'suggested', 'accepted'] });
  await notify({
    recipientEmail: email,
    type: 'REQUEST_CONFIRMED',
    message: `${observee.name} confirmed you as the observer for ${describeMeeting(section)}. Next: agree on the observation date.`,
    section,
  });
  await audit(user, 'observer.finalized', { type: 'observation', id: sectionKey(section), term: section.term, detail: { observer: email, standDown: autoCancelled.length } });
  return { observation: gate, observerEmail: email, autoCancelled };
}

// ------------------------------------------------------------------------------------------------
// 4. Pick the observation date (the class must be meeting that day)
// ------------------------------------------------------------------------------------------------
async function scheduleObservation(user, sectionId, dateString, timeString) {
  const {
    observation, section, observee, filter,
  } = await loadObservation(sectionId);
  if (user.email !== observee.email && user.email !== observation.observer_email) {
    throw forbidden('Only the observee or the confirmed observer can schedule the observation.');
  }
  if (!['scheduled', 'missed'].includes(observation.status)) {
    throw conflict(`An observation that is "${observation.status}" cannot be scheduled.`, { code: 'BAD_STATUS' });
  }
  if (observation.observer_signed_date || observation.observee_signed_date || (observation.record && observation.record.locked_at)) {
    throw conflict('This observation has already been signed and can no longer be moved.', { code: 'LOCKED' });
  }

  const day = parseIsoDay(dateString);
  if (!day) throw badRequest('observationDate must be a real date written YYYY-MM-DD.');
  const cycle = await getCycleOr404(section.term);
  const at = now();
  if (day < startOfUtcDay(at)) throw badRequest('observationDate cannot be in the past.');
  if (day > startOfUtcDay(cycle.observation_deadline)) {
    throw badRequest(`observationDate must be on or before the observation deadline (${toIsoDay(cycle.observation_deadline)}).`);
  }
  // If the section's timing cannot be read there is no list of meeting days to check against, so any day is accepted.
  const meeting = meetingOf(section);
  if (meeting.days && !parseDays(meeting.days).includes(weekdayLetter(day))) {
    throw badRequest(`The class meets ${meeting.days} (${meeting.startTime}-${meeting.endTime}); pick a date that falls on one of those days.`, { code: 'NOT_A_CLASS_DAY' });
  }

  // The visit is during the class, so the time can only be the class start time (the frontend sends it as "8:30 AM" or "08:30").
  // Leaving it out means "at the class start". A class whose time cannot be read accepts any valid clock time.
  let visitTime = meeting.startTime;
  if (timeString !== undefined && timeString !== null && String(timeString).trim() !== '') {
    const given = normalizeClock(timeString);
    if (given === null) throw badRequest('observationTime must be a clock time like "08:30" or "8:30 AM".');
    if (meeting.startTime && given !== meeting.startTime) {
      throw badRequest(`The class starts at ${meeting.startTime}; observationTime must be ${meeting.startTime}.`, { code: 'NOT_CLASS_TIME' });
    }
    visitTime = given;
  }

  const updated = await Observation.findOneAndUpdate(
    {
      ...filter, status: observation.status, observer_signed_date: null, observee_signed_date: null,
    },
    {
      $set: {
        observation_date: day, observation_time: visitTime || null, status: 'scheduled', missed_reported_by: null, missed_reason: null, missed_date: null,
      },
      $push: { status_history: historyEntry(at, user.email, observation.status, 'scheduled', `date set to ${toIsoDay(day)}${visitTime ? ` at ${visitTime}` : ''}`) },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('The observation changed while you were scheduling it. Please reload.', { code: 'CHANGED_CONCURRENTLY' });

  const other = user.email === observee.email ? observation.observer_email : observee.email;
  await notify({
    recipientEmail: other,
    type: 'OBSERVATION_SCHEDULED',
    message: `${user.name} set the observation of ${describeMeeting(section)} for ${toIsoDay(day)}${visitTime ? ` at ${visitTime}` : ''}.`,
    section,
  });
  await audit(user, 'observation.scheduled', { type: 'observation', id: sectionKey(section), term: section.term, detail: { date: toIsoDay(day), time: visitTime || null } });
  return updated;
}

/**
 * "Did Not Happen": the observer or the observee says the scheduled observation did not take place.
 * It becomes "missed" (the Missing Observation Count KPI) and can be rescheduled while the period is open.
 * Only once the scheduled day has arrived, and never after someone has signed.
 */
async function reportNotHeld(user, sectionId, reason) {
  const {
    observation, section, observee, filter,
  } = await loadObservation(sectionId);
  if (user.email !== observee.email && user.email !== observation.observer_email) {
    throw forbidden('Only the observee or the confirmed observer can report that an observation did not happen.');
  }
  if (observation.status !== 'scheduled') throw conflict(`An observation that is "${observation.status}" cannot be reported as not held.`, { code: 'BAD_STATUS' });
  if (observation.observer_signed_date || observation.observee_signed_date || (observation.record && observation.record.locked_at)) {
    throw conflict('This observation has already been signed, so it cannot be reported as not held.', { code: 'LOCKED' });
  }
  const at = now();
  if (!observation.observation_date || startOfUtcDay(new Date(observation.observation_date)) > startOfUtcDay(at)) {
    throw conflict('The observation is not due yet. To change the day, set a new date instead.', { code: 'TOO_EARLY' });
  }
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > 500)) throw badRequest('reason must be text of up to 500 characters.');
  const note = typeof reason === 'string' ? reason.trim() : '';

  const updated = await Observation.findOneAndUpdate(
    {
      ...filter, status: 'scheduled', observer_signed_date: null, observee_signed_date: null,
    },
    {
      $set: {
        status: 'missed', missed_reported_by: user.email, missed_reason: note || null, missed_date: at,
      },
      $push: { status_history: historyEntry(at, user.email, 'scheduled', 'missed', `reported as not held${note ? `: ${note}` : ''}`) },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('The observation changed while you were reporting it. Please reload.', { code: 'CHANGED_CONCURRENTLY' });

  const other = user.email === observee.email ? observation.observer_email : observee.email;
  await notify({
    recipientEmail: other,
    type: 'OBSERVATION_MISSED',
    message: `${user.name} reported that the observation of ${describeMeeting(section)} did not take place. It can be rescheduled while the observation period is open.`,
    section,
  });
  await audit(user, 'observation.not_held', { type: 'observation', id: sectionKey(section), term: section.term, detail: { reason: note || null } });
  return updated;
}

// ------------------------------------------------------------------------------------------------
// 5. The in-app observation record (observer's copy of the template)
// ------------------------------------------------------------------------------------------------
function requireObserver(user, observation) {
  if (user.email !== observation.observer_email) throw forbidden('Only the confirmed observer can fill in the observation record.');
}

async function createRecord(user, sectionId) {
  const { observation, filter } = await loadObservation(sectionId);
  requireObserver(user, observation);
  if (observation.status !== 'scheduled') throw conflict(`The observation is "${observation.status}"; a record can only be started while it is scheduled.`, { code: 'BAD_STATUS' });
  if (observation.record) throw conflict('A record already exists for this observation (one copy per observation).', { code: 'RECORD_EXISTS' });

  const form = await getObservationForm();
  const at = now();
  const record = {
    form_id: form.form_id, form_version: form.version, form_title: form.title,
    criteria: snapshotCriteria(form), created_at: at, updated_at: at, locked_at: null,
  };
  const updated = await Observation.findOneAndUpdate(
    {
      ...filter, observer_email: user.email, status: 'scheduled', record: null,
    },
    { $set: { record } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('A record already exists for this observation (one copy per observation).', { code: 'RECORD_EXISTS' });
  await audit(user, 'record.started', { type: 'observation', id: sectionId, term: updated.term, detail: { formVersion: form.version } });
  return updated;
}

async function updateRecord(user, sectionId, values) {
  const { observation, filter } = await loadObservation(sectionId);
  requireObserver(user, observation);
  if (!observation.record) throw notFound('There is no record yet. Start one with POST /api/observations/:sectionId/record.');
  if (observation.record.locked_at || observation.observer_signed_date || observation.observee_signed_date) {
    throw conflict('This record has been signed and is locked. Nobody can edit it.', { code: 'RECORD_LOCKED' });
  }

  const { errors, clean } = validateValues(observation.record.criteria, values);
  if (errors.length) throw badRequest('Some values are not valid for this form.', { details: errors });

  const criteria = applyValues(observation.record.criteria, clean);
  const updated = await Observation.findOneAndUpdate(
    {
      ...filter, observer_email: user.email, status: 'scheduled', 'record.locked_at': null, observer_signed_date: null, observee_signed_date: null,
    },
    { $set: { record: { ...observation.record, criteria, updated_at: now() }, ratings: ratingsFromCriteria(criteria) } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('This record was signed while you were editing, so it is now locked.', { code: 'RECORD_LOCKED' });
  return updated;
}

// ------------------------------------------------------------------------------------------------
// 6. Signatures.  The FIRST signature locks the record; the second completes the observation.
// ------------------------------------------------------------------------------------------------
async function signObservation(user, sectionId) {
  const {
    observation, section, observee, filter,
  } = await loadObservation(sectionId);
  const role = user.email === observation.observer_email ? 'observer' : user.email === observee.email ? 'observee' : null;
  if (!role) throw forbidden('Only the observer and the observee can sign.');

  if (observation.status !== 'scheduled') throw conflict(`The observation is "${observation.status}", so it cannot be signed.`, { code: 'BAD_STATUS' });
  if (!observation.record) throw conflict('The observer has not filled in the observation form yet.', { code: 'NO_RECORD' });
  if (!observation.observation_date) throw conflict('Choose the observation date before signing.', { code: 'NOT_SCHEDULED' });
  const at = now();
  if (startOfUtcDay(new Date(observation.observation_date)) > startOfUtcDay(at)) {
    throw conflict(`The observation is on ${toIsoDay(observation.observation_date)}; it cannot be signed before then.`, { code: 'TOO_EARLY' });
  }
  const field = role === 'observer' ? 'observer_signed_date' : 'observee_signed_date';
  if (observation[field]) throw conflict('You have already signed this observation.', { code: 'ALREADY_SIGNED' });
  // The observee is shown the report, and asked to sign, only after the observer has signed (committee Q&A).
  if (role === 'observee' && !observation.observer_signed_date) {
    throw conflict('The observer signs first. You will be asked to sign once the observer has.', { code: 'OBSERVER_MUST_SIGN_FIRST' });
  }

  const missing = missingRequired(observation.record.criteria);
  if (missing.length) throw unprocessable(`Required fields are still empty: ${missing.join(', ')}.`, { code: 'REQUIRED_MISSING', details: { missing } });

  const signed = await Observation.findOneAndUpdate(
    { ...filter, status: 'scheduled', [field]: null },
    { $set: { [field]: at }, $push: { status_history: historyEntry(at, user.email, 'scheduled', 'scheduled', `${role} signed`) } },
    { returnDocument: 'after' }
  ).lean();
  if (!signed) throw conflict('The observation changed while you were signing. Please reload.', { code: 'CHANGED_CONCURRENTLY' });

  // Lock the record (idempotent: harmless if the other signature already did).
  await Observation.updateOne({ ...filter, 'record.locked_at': null }, { $set: { 'record.locked_at': at } });

  // Both signatures in? Exactly one caller wins this update and finishes the observation.
  const done = await Observation.findOneAndUpdate(
    {
      ...filter, status: 'scheduled', observer_signed_date: { $ne: null }, observee_signed_date: { $ne: null },
    },
    { $set: { status: 'completed', completed_date: at }, $push: { status_history: historyEntry(at, 'system', 'scheduled', 'completed', 'both signed') } },
    { returnDocument: 'after' }
  ).lean();

  await audit(user, 'observation.signed', { type: 'observation', id: sectionKey(section), term: section.term, detail: { role, completed: Boolean(done) } });

  if (done) {
    await Professor.updateOne({ email: observee.email }, { $max: { last_observed: observation.observation_date } });
    for (const recipientEmail of [observee.email, observation.observer_email]) {
      await notify({
        recipientEmail,
        type: 'OBSERVATION_COMPLETED',
        message: `The observation of ${describeMeeting(section)} is complete: both signatures are in.`,
        section,
      });
    }
    return { observation: done, completed: true };
  }

  const other = role === 'observer' ? observee.email : observation.observer_email;
  await notify({
    recipientEmail: other,
    type: 'SIGNATURE_NEEDED',
    message: `${user.name} signed the observation of ${describeMeeting(section)}. Your signature is needed to complete it.`,
    section,
  });
  // Re-read so the response shows the record as locked (the lock was applied after `signed` was read).
  return { observation: (await Observation.findOne(filter).lean()) || signed, completed: false };
}

module.exports = {
  createSignup,
  sendRequests,
  respondToRequest,
  scheduleObservation,
  createRecord,
  updateRecord,
  signObservation,
  reportNotHeld,
  finalizeObserver,
};
