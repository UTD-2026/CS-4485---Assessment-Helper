// "What do I need to do next?" - one call that gives the frontend everything a professor's home screen needs:
// the cycle and its phase, their due status, where their own signup stands (Steps 1-3 of the README) and what they owe as
// an observer (requests to answer, forms to fill in, signatures, the signed PDF to upload).
//
// nextAction.code is a stable value the frontend can switch on; nextAction.message is plain English to show as-is.
const { env } = require('../config/env');
const { CourseSection, Notification, Observation, ObserverMatch, Professor, Survey } = require('../models');
const { now } = require('./clock');
const { cyclePhase } = require('./cycles');
const { endOfDeadlineDay, startOfUtcDay, toIsoDay } = require('./dates');
const { describeMeeting, meetingOf } = require('./eligibility');
const { baselineBefore, dueStatusFor } = require('./dueStatus');
const { signedTemplatesFor } = require('./files');
const { completedHistory } = require('./kpis');
const {
  findForSections, getCycleOr404, observationsOfProfessor, observeeEmailOf, sectionKey,
} = require('./lookup');
const { missingRequired } = require('./observationRecords');

const day = (d) => toIsoDay(d);
const label = (s) => `${s.course_code} sec ${s.section_number}`;
const action = (code, message, extra = {}) => ({ code, message, ...extra });

/** Where "now" is relative to an observation date: no_date | upcoming | arrived. */
function timing(observation, at) {
  if (!observation.observation_date) return 'no_date';
  return startOfUtcDay(new Date(observation.observation_date)) > startOfUtcDay(at) ? 'upcoming' : 'arrived';
}

const recordState = (observation) => {
  if (!observation.record) return null;
  const missing = missingRequired(observation.record.criteria || []);
  return {
    started: true,
    formVersion: observation.record.form_version,
    locked: Boolean(observation.record.locked_at),
    missing,
    complete: missing.length === 0,
  };
};

/** Step the professor who signed up (the observee) is on. Pure: everything it needs is passed in. */
function observeeNextAction({
  term, phase, cycle, evaluation, hasCourses, observation, counts, surveyDone, at = now(),
}) {
  const dueBy = day(cycle.signup_deadline);
  if (!observation) {
    if (!hasCourses) return action('NO_COURSES', `No ${term} courses are on file for you, so there is nothing to sign up with. Tell the committee if this is wrong.`);
    if (phase === 'SIGNUP' || !env.enforceSignupDeadline) {
      const required = evaluation.status === 'due' || evaluation.status === 'overdue';
      return action('SIGN_UP', required
        ? `You are ${evaluation.status} for a peer observation. Sign up with one of your ${term} courses by ${dueBy}.`
        : `You are not due this term, but you may still sign up with one of your ${term} courses by ${dueBy}.`, { required, deadline: dueBy });
    }
    return action('SIGNUP_CLOSED', `Signup for ${term} closed on ${dueBy}. Contact the Assessment Committee if you still need to sign up.`);
  }

  switch (observation.status) {
    case 'unmatched':
      return action('NO_ELIGIBLE_OBSERVERS', 'No eligible observers were found for your course. The Assessment Committee has been alerted and will be in touch.');
    case 'signed_up': {
      if (counts.total === 0) return action('WAIT_FOR_LIST', 'You are signed up. The committee has not generated your observer list yet; you will be notified when it is ready.');
      if (counts.accepted > 0) {
        return action('CHOOSE_FINAL_OBSERVER', `${counts.accepted} observer(s) accepted. Confirm the one you want; the others will be thanked and released.`, { accepted: counts.accepted });
      }
      if (counts.requested > 0) {
        return action('WAIT_FOR_REPLIES', `You asked ${counts.requested} observer(s). Waiting for the first one to confirm.`, { canAskMore: counts.suggested + counts.expired > 0 });
      }
      if (counts.suggested > 0) return action('CHOOSE_OBSERVERS', 'Your observer list is ready. Ask some or all of them to observe your class.', { available: counts.suggested + counts.expired });
      if (counts.expired > 0) return action('RE_REQUEST', 'Your earlier requests expired. You can ask the same observers again.', { available: counts.expired });
      return action('REQUESTS_EXHAUSTED', 'Everyone on your list declined or was stood down. Contact the Assessment Committee for a new list.');
    }
    case 'scheduled': {
      const when = timing(observation, at);
      if (when === 'no_date') return action('SET_DATE', 'An observer confirmed. Choose the observation date (a day your class meets).');
      if (when === 'upcoming') return action('OBSERVATION_COMING', `Your class is being observed on ${day(observation.observation_date)}.`, { date: day(observation.observation_date) });
      if (observation.observee_signed_date) return action('WAIT_FOR_OBSERVER_SIGNATURE', 'You signed. Waiting for your observer to sign.');
      // The report is shown to the professor, and their signature asked for, only after the observer has signed (services/visibility.js).
      if (!observation.observer_signed_date) return action('WAIT_FOR_OBSERVER_FORM', 'Your observer is still completing and signing the observation form. You will be asked to review and sign it afterwards.');
      return action('SIGN', 'Your observer signed the report. Review it and add your signature.');
    }
    case 'missed':
      return action('RESCHEDULE', 'The observation did not take place. Choose a new date while the observation period is open.');
    case 'completed':
      if (!surveyDone && phase !== 'CLOSED') return action('TAKE_SURVEY', `Your observation is complete. Please answer the short survey by ${day(cycle.feedback_deadline)}.`, { deadline: day(cycle.feedback_deadline) });
      return action('DONE', 'Your observation for this term is complete.');
    default:
      return action('UNKNOWN', `Your signup is "${observation.status}".`);
  }
}

/** Step for one observation the professor has agreed to observe (they are the observer). */
function observerNextAction({ observation, fileUploaded, at = now() }) {
  // The upload is asked for once the observation has taken place (the API itself accepts it any time after scheduling).
  const happened = observation.status === 'completed' || (observation.status === 'scheduled' && timing(observation, at) === 'arrived');
  const upload = !fileUploaded && happened;
  const flag = { uploadSignedTemplate: upload };
  switch (observation.status) {
    case 'scheduled': {
      const when = timing(observation, at);
      if (when === 'no_date') return action('SET_DATE', 'Agree on the observation date with the professor (either of you can set it).', flag);
      if (when === 'upcoming') return action('OBSERVATION_COMING', `You observe on ${day(observation.observation_date)}.`, { ...flag, date: day(observation.observation_date) });
      if (observation.observer_signed_date) return action('WAIT_FOR_OBSERVEE_SIGNATURE', 'You signed. Waiting for the professor to sign.', flag);
      const rec = recordState(observation);
      if (!rec) return action('START_FORM', 'Start the observation form.', flag);
      if (!rec.complete) return action('FILL_FORM', `Finish the observation form (still empty: ${rec.missing.join(', ')}).`, { ...flag, missing: rec.missing });
      return action('SIGN', 'The form is complete. Add your signature.', flag);
    }
    case 'completed':
      return action('DONE', upload ? 'The observation is complete. Upload the signed observation form (PDF).' : 'The observation is complete.', flag);
    case 'missed':
      return action('RESCHEDULE', 'This observation did not take place. Agree on a new date while the observation period is open.', flag);
    default:
      return action('UNKNOWN', `The observation is "${observation.status}".`, flag);
  }
}

const phaseDeadline = (cycle, phase) => ({
  SIGNUP: cycle.signup_deadline, OBSERVATION: cycle.observation_deadline, FEEDBACK: cycle.feedback_deadline, CLOSED: null,
}[phase]);

async function loadOverview(user, term) {
  const cycle = await getCycleOr404(term);
  const at = now();
  const phase = cyclePhase(cycle, at);
  const ends = phaseDeadline(cycle, phase);
  const daysLeft = ends ? Math.max(0, Math.ceil((endOfDeadlineDay(ends) - at) / 86400000)) : null;

  // --- my evaluation status for this term (judged from my last completed observation BEFORE this term)
  const everySection = await CourseSection.find({ instructor_email: user.email }).lean();
  const everyObservation = await findForSections(Observation, everySection);
  const completed = completedHistory({ sections: everySection, observations: everyObservation }).get(user.email) || [];
  const status = dueStatusFor(user, baselineBefore(user, completed, term), term);

  // --- as the professor being observed
  const mySections = everySection.filter((s) => s.term === term);
  const { observations } = await observationsOfProfessor(user.email, term);
  const observation = observations[0] || null;
  let requests = {
    total: 0, suggested: 0, requested: 0, accepted: 0, confirmed: 0, declined: 0, expired: 0, cancelled: 0,
  };
  let observer = null;
  if (observation) {
    const rows = await ObserverMatch.find({
      course_code: observation.course_code, section_number: observation.section_number, term: observation.term,
    }).lean();
    requests = rows.reduce((c, m) => { c[m.status] = (c[m.status] || 0) + 1; c.total += 1; return c; }, requests);
    if (observation.observer_email) observer = await Professor.findOne({ email: observation.observer_email }).lean();
  }
  const survey = await Survey.findOne({ professor_email: user.email, term }).lean();
  const files = observation ? await signedTemplatesFor([observation]) : new Map();
  const nextAction = observeeNextAction({
    term, phase, cycle, evaluation: status, hasCourses: mySections.length > 0, observation, counts: requests, surveyDone: Boolean(survey), at,
  });

  // --- as an observer
  const termSections = await CourseSection.find({ term }).lean();
  const sectionByKey = new Map(termSections.map((s) => [sectionKey(s), s]));
  const asked = await ObserverMatch.find({ observer_email: user.email, status: 'requested', term }).lean();
  const duties = await Observation.find({ observer_email: user.email, term }).lean();
  const dutyFiles = await signedTemplatesFor(duties);
  const askedObservations = asked.length ? await Observation.find({ term }).lean() : [];
  const observeeOf = (o) => observeeEmailOf(o, sectionByKey.get(sectionKey(o)));
  const observeeEmails = new Set([
    ...duties.filter((o) => sectionByKey.has(sectionKey(o))).map(observeeOf),
    ...askedObservations.filter((o) => sectionByKey.has(sectionKey(o))).map(observeeOf),
  ]);
  const people = observeeEmails.size ? await Professor.find({ email: { $in: [...observeeEmails] } }).lean() : [];
  const nameOf = new Map(people.map((p) => [p.email, p.name]));

  const pendingRequests = asked.filter((m) => sectionByKey.has(sectionKey(m))).map((m) => {
    const section = sectionByKey.get(sectionKey(m));
    const o = askedObservations.find((x) => sectionKey(x) === sectionKey(m));
    const expiresAt = m.expires_at || null;
    return {
      sectionId: sectionKey(m),
      course: label(section),
      meets: describeMeeting(section),
      observeeName: o ? nameOf.get(observeeOf(o)) || null : null,
      requestedDate: m.requested_date || null,
      expiresAt,
      expired: Boolean(expiresAt && at > new Date(expiresAt)),
      hoursLeft: expiresAt ? Math.max(0, Math.round(((new Date(expiresAt) - at) / 3600000) * 10) / 10) : null,
    };
  });

  const dutyRows = duties.filter((o) => sectionByKey.has(sectionKey(o))).map((o) => {
    const section = sectionByKey.get(sectionKey(o));
    const file = dutyFiles.get(sectionKey(o)) || null;
    return {
      sectionId: sectionKey(o),
      course: label(section),
      observeeName: nameOf.get(observeeOf(o)) || null,
      status: o.status,
      observationDate: day(o.observation_date),
      signedTemplate: file,
      nextAction: observerNextAction({ observation: o, fileUploaded: Boolean(file), at }),
    };
  });

  const unread = await Notification.countDocuments({ recipient_email: user.email, read_at: null });

  return {
    term,
    cycle: {
      term: cycle.term,
      phase,
      signupDeadline: day(cycle.signup_deadline),
      observationDeadline: day(cycle.observation_deadline),
      feedbackDeadline: day(cycle.feedback_deadline),
      phaseEndsOn: ends ? day(ends) : null,
      daysLeftInPhase: daysLeft,
    },
    evaluation: {
      status: status.status, baselineTerm: status.baselineTerm, anniversary: status.anniversary, dueWindow: status.dueWindow,
      lastObserved: user.last_observed ? day(user.last_observed) : null,
    },
    asObservee: {
      mySections: mySections.map((s) => {
        const meeting = meetingOf(s);
        return {
          sectionId: sectionKey(s), courseCode: s.course_code, sectionNumber: s.section_number, days: meeting.days, startTime: meeting.startTime, endTime: meeting.endTime,
        };
      }),
      observation: observation && {
        sectionId: sectionKey(observation),
        status: observation.status,
        observationDate: day(observation.observation_date),
        observer: observer ? { email: observer.email, name: observer.name } : null,
        observeeSignedDate: observation.observee_signed_date ? day(observation.observee_signed_date) : null,
        observerSignedDate: observation.observer_signed_date ? day(observation.observer_signed_date) : null,
        record: recordState(observation),
        signedTemplate: files.get(sectionKey(observation)) || null,
      },
      requests,
      nextAction,
    },
    asObserver: {
      pendingRequests,
      duties: dutyRows,
      counts: {
        pendingRequests: pendingRequests.filter((r) => !r.expired).length,
        duties: dutyRows.length,
        needingAction: dutyRows.filter((d) => !['DONE', 'OBSERVATION_COMING', 'WAIT_FOR_OBSERVEE_SIGNATURE'].includes(d.nextAction.code) || d.nextAction.uploadSignedTemplate).length,
      },
    },
    unreadNotifications: unread,
  };
}

module.exports = {
  observeeNextAction,
  observerNextAction,
  loadOverview,
};
