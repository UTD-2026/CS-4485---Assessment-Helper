// Turns API documents (snake_case, keyed by email / course section) into the shapes the
// existing screens were written against (professor_id, observeeId, courseCode, 'Pending Scheduling', ...).
// Keeping this mapping in one place let the UI from main stay almost unchanged.

const to12h = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return hhmm || '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "MW 08:30-09:45" -> "MW 8:30 AM - 9:45 AM";  the seed's "TT" (Tue/Thu) -> "TR". */
export function formatTiming(timing) {
  const m = /^\s*([A-Za-z]+)\s+(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\s*$/.exec(timing || '');
  if (!m) return timing || '';
  const days = m[1].toUpperCase() === 'TT' ? 'TR' : m[1].toUpperCase();
  return `${days} ${to12h(m[2])}${m[3] ? ` - ${to12h(m[3])}` : ''}`;
}

const STATUS_LABEL = { due: 'Due', overdue: 'Overdue', not_due: 'Not Due' };

export function adaptProfessor(p) {
  const s = p.evaluation_status || {};
  return {
    professor_id: p.email, // emails are the professors' keys in the database
    email: p.email,
    username: p.netid,
    name: p.name,
    department: p.department,
    hire_level: p.hire_level_label || p.hire_level,
    is_ac_member: Boolean(p.is_ac_member),
    last_evaluation: s.last_evaluated_term || null,
    status: STATUS_LABEL[s.status] || 'Unknown',
    next_eval: s.next_due_term || 'TBD',
    overdue_by: s.overdue_by || 0,
    role: 'professor',
  };
}

export const sectionId = (x) => `${x.course_code}|${x.section_number}|${x.term}`;

export function adaptCourse(c) {
  return {
    section_id: sectionId(c),
    course_code: c.course_code,
    section: c.section_number,
    term: c.term,
    timing: formatTiming(c.timing),
    raw_timing: c.timing,
    instructor_id: c.instructor_email,
  };
}

const FLAG_LABEL = { OK: 'OK', INSUFFICIENT_OBSERVERS: 'INSUFFICIENT OBSERVERS', NO_ELIGIBLE_OBSERVER: 'NO ELIGIBLE OBSERVER' };
const OBS_STATUS = {
  matched: 'Pending Scheduling',
  scheduled: 'Scheduled',
  awaiting_confirmation: 'Awaiting Confirmation',
  completed: 'Completed',
  missed: 'Missed',
  deferred: 'Deferred / Rolled Over',
};
const MATCH_STATUS = { requested: 'Pending', accepted: 'Accepted', declined: 'Declined', confirmed: 'Confirmed', cancelled: 'Cancelled' };

const nameFor = (directory, email) => directory.get(email)?.name || email;

/** A signed-up section (Observation) -> the "signup" the Signup Monitor and Observee Status use. */
export function adaptSignup(o, matches, directory) {
  const list = matches.filter((m) => m.observation_id === o.id);
  return {
    id: o.id,
    term: o.term,
    observeeId: o.observee_email,
    observeeName: o.observee_name,
    observeeEmail: o.observee_email,
    courseCode: o.course_code,
    section: o.section_number,
    timing: formatTiming(o.timing),
    status: o.status,
    matchesCount: o.candidate_count ?? list.length,
    matchFlag: FLAG_LABEL[o.match_flag] || (list.length ? 'OK' : 'NO ELIGIBLE OBSERVER'),
    listReleased: Boolean(o.list_released),
    eligibleObservers: list.map((m) => ({
      professor_id: m.observer_email,
      name: m.observer_name || nameFor(directory, m.observer_email),
      department: m.observer_department || directory.get(m.observer_email)?.department || '',
      matchStatus: m.status,
    })),
  };
}

/** Requests that were actually sent (everything except untouched suggestions). */
export function adaptRequest(m) {
  return {
    id: m.id,
    observationId: m.observation_id,
    observeeId: m.observee_email,
    observeeName: m.observee_name,
    observerId: m.observer_email,
    observerName: m.observer_name,
    courseCode: m.course_code,
    timing: formatTiming(m.timing),
    status: MATCH_STATUS[m.status] || m.status,
  };
}

/** An observation with a selected observer -> the "observation" the duty/confirmation screens use. */
export function adaptObservation(o, directory) {
  const timing = formatTiming(o.timing);
  const time = o.observation_time ? to12h(o.observation_time) : null;
  // Show the full class slot ("8:30 AM - 9:45 AM") to match the scheduling form's time options
  const slot = timing.split(' ').slice(1).join(' ');
  return {
    id: o.id,
    term: o.term,
    observeeId: o.observee_email,
    observeeName: o.observee_name,
    observerId: o.observer_email,
    observerName: o.observer_name,
    courseCode: o.course_code,
    timing,
    status: OBS_STATUS[o.status] || o.status,
    rawStatus: o.status,
    scheduledDate: o.observation_date,
    scheduledTime: time ? (slot.startsWith(time) ? slot : time) : null,
    observerConfirmed: Boolean(o.observer_signed_date),
    observeeConfirmed: Boolean(o.observee_signed_date),
    deferralReason: o.deferral_reason,
    missedReportedBy: o.missed_reported_by ? nameFor(directory, o.missed_reported_by) : null,
    hasEvaluation: Boolean(o.has_evaluation),
  };
}

/** Ratings saved on an observation -> the evaluation record the "View Form" screens show. */
export function adaptEvaluation(o) {
  const answers = {};
  for (const [id, value] of Object.entries(o.ratings || {})) {
    answers[id] = value && typeof value === 'object' ? { rating: value.rating == null ? '' : String(value.rating), notes: value.notes || '' } : { rating: String(value), notes: '' };
  }
  return {
    id: o.id,
    observationId: o.id,
    term: o.term,
    observerId: o.observer_email,
    observerName: o.observer_name,
    observeeId: o.observee_email,
    observeeName: o.observee_name,
    courseCode: o.course_code,
    timing: formatTiming(o.timing),
    dateSubmitted: o.evaluation_submitted_date || o.observer_signed_date || o.observation_date || '',
    items: o.evaluation_items || null,
    answers,
  };
}

export function adaptNotification(n) {
  return {
    id: n.id,
    recipientId: n.recipient_email,
    message: n.message,
    // The inbox/archive UI treats "read" as "moved to archive"
    read: Boolean(n.archived),
    seen: Boolean(n.read),
    timestamp: new Date(n.created_at).toLocaleDateString(),
  };
}

export const adaptDeadlines = (cycle) => ({
  signup: cycle?.signup_deadline || '',
  observation: cycle?.observation_deadline || '',
  survey: cycle?.feedback_deadline || '',
});
