// Data + column layouts for the Assessment Committee's CSV exports (stretch goal "exportable reports").
const { CourseSection, Observation, Professor } = require('../models');
const { toIsoDay } = require('./dates');
const { meetingOf } = require('./eligibility');
const { DEFAULT_OBSERVATION_FORM } = require('./forms');
const { signedTemplatesFor } = require('./files');
const {
  findForSections, getCycleOr404, observeeEmailOf, sectionKey,
} = require('./lookup');

const yesNo = (v) => (v ? 'yes' : 'no');

/** Every signup of a term with the class and the professor (also used by GET /api/cycles/:term/signups). */
async function loadSignupRows(term) {
  const sections = await CourseSection.find({ term }).lean();
  const observations = await findForSections(Observation, sections);
  const people = await Professor.find({}).lean();
  const sectionByKey = new Map(sections.map((s) => [sectionKey(s), s]));
  return observations.map((o) => {
    const section = sectionByKey.get(sectionKey(o));
    const observee = people.find((p) => p.email === observeeEmailOf(o, section));
    const meeting = meetingOf(section);
    return {
      sectionId: sectionKey(o), courseCode: section.course_code, sectionNumber: section.section_number,
      days: meeting.days, startTime: meeting.startTime, endTime: meeting.endTime,
      observeeName: observee.name, observeeEmail: observee.email, hireLevel: observee.hire_level,
      status: o.status, observerEmail: o.observer_email || null, signupDate: o.signup_date,
    };
  }).sort((a, b) => a.observeeName.localeCompare(b.observeeName));
}

const SIGNUP_COLUMNS = [
  { label: 'Course', key: 'courseCode' }, { label: 'Section', key: 'sectionNumber' },
  { label: 'Days', key: 'days' }, { label: 'Start', key: 'startTime' }, { label: 'End', key: 'endTime' },
  { label: 'Professor', key: 'observeeName' }, { label: 'Email', key: 'observeeEmail' }, { label: 'Hire level', key: 'hireLevel' },
  { label: 'Status', key: 'status' }, { label: 'Observer', key: 'observerEmail' }, { label: 'Signup date', value: (r) => toIsoDay(r.signupDate) },
];

const DUE_COLUMNS = [
  { label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Department', key: 'department' },
  { label: 'Hire level', key: 'hireLevel' }, { label: 'Status', key: 'status' },
  { label: 'Last evaluated term', key: 'baselineTerm' }, { label: 'Anniversary term', key: 'anniversary' },
  { label: 'Due window', value: (r) => (r.dueWindow || []).join(' + ') }, { label: 'Signed up', value: (r) => yesNo(r.signedUp) },
];

const mean = (nums) => (nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : null);

/** One row per observation of the term: who, when, status, signatures, ratings, whether the signed PDF is on file. */
async function loadObservationRows(term) {
  await getCycleOr404(term);
  const sections = await CourseSection.find({ term }).lean();
  const observations = await findForSections(Observation, sections);
  const people = new Map((await Professor.find({}).lean()).map((p) => [p.email, p]));
  const files = await signedTemplatesFor(observations);
  const sectionByKey = new Map(sections.map((s) => [sectionKey(s), s]));
  const rows = observations.map((o) => {
    const section = sectionByKey.get(sectionKey(o));
    const observee = people.get(observeeEmailOf(o, section));
    const observer = o.observer_email ? people.get(o.observer_email) : null;
    const meeting = meetingOf(section);
    // The committee sees the scores only after both signatures (committee Q&A), so an unfinished observation shows none.
    const ratings = o.status === 'completed' && o.ratings && typeof o.ratings === 'object' ? o.ratings : {};
    const numeric = Object.values(ratings).filter((v) => typeof v === 'number');
    return {
      term, course: section.course_code, section: section.section_number, days: meeting.days, start: meeting.startTime, end: meeting.endTime,
      observeeName: observee.name, observeeEmail: observee.email, observeeHireLevel: observee.hire_level,
      observerName: observer ? observer.name : null, observerEmail: observer ? observer.email : null,
      status: o.status, signupDate: toIsoDay(o.signup_date), observationDate: toIsoDay(o.observation_date),
      observeeSigned: toIsoDay(o.observee_signed_date), observerSigned: toIsoDay(o.observer_signed_date),
      ratings, averageRating: mean(numeric), signedPdf: files.has(sectionKey(o)),
    };
  }).sort((a, b) => a.observeeName.localeCompare(b.observeeName));

  const preferred = DEFAULT_OBSERVATION_FORM.fields.filter((f) => f.type === 'rating').map((f) => f.key);
  const seen = new Set(rows.flatMap((r) => Object.keys(r.ratings)));
  const ratingKeys = [...preferred.filter((k) => seen.has(k)), ...[...seen].filter((k) => !preferred.includes(k)).sort()];
  return { rows, ratingKeys };
}

const observationColumns = (ratingKeys) => [
  { label: 'Term', key: 'term' }, { label: 'Course', key: 'course' }, { label: 'Section', key: 'section' },
  { label: 'Days', key: 'days' }, { label: 'Start', key: 'start' }, { label: 'End', key: 'end' },
  { label: 'Professor', key: 'observeeName' }, { label: 'Professor email', key: 'observeeEmail' }, { label: 'Hire level', key: 'observeeHireLevel' },
  { label: 'Observer', key: 'observerName' }, { label: 'Observer email', key: 'observerEmail' },
  { label: 'Status', key: 'status' }, { label: 'Signup date', key: 'signupDate' }, { label: 'Observation date', key: 'observationDate' },
  { label: 'Professor signed', key: 'observeeSigned' }, { label: 'Observer signed', key: 'observerSigned' },
  ...ratingKeys.map((k) => ({ label: k, value: (r) => (r.ratings[k] === undefined ? null : r.ratings[k]) })),
  { label: 'Average rating', key: 'averageRating' }, { label: 'Signed PDF on file', value: (r) => yesNo(r.signedPdf) },
];

const WORKLOAD_COLUMNS = [
  { label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Department', key: 'department' }, { label: 'Hire level', key: 'hireLevel' },
  { label: 'Asked', key: 'asked' }, { label: 'Confirmed', key: 'confirmed' }, { label: 'Declined', key: 'declined' }, { label: 'Expired', key: 'expired' },
  { label: 'Stood down', key: 'cancelled' }, { label: 'Waiting', key: 'pending' }, { label: 'Observations assigned', key: 'assigned' },
  { label: 'Completed', key: 'completed' }, { label: 'Missed', key: 'missed' },
  { label: 'Acceptance rate', key: 'acceptRate' }, { label: 'Average hours to answer', key: 'avgResponseHours' },
];

/** The dashboard as plain "section, metric, value" rows. */
function kpiRows(d) {
  const rows = [];
  const add = (section, metric, value) => rows.push({ section, metric, value });
  add('Term', 'term', d.term); add('Term', 'phase', d.phase);
  add('Faculty due for evaluation', 'total', d.facultyDueForEvaluation.total);
  for (const b of d.facultyDueForEvaluation.breakdown) add('Faculty due for evaluation', `${b.hireLevel} / ${b.status}`, b.count);
  add('Overdue evaluations', 'overdue at cycle start', d.overdueEvaluations.overdueAtCycleStart);
  add('Overdue evaluations', 'still overdue now', d.overdueEvaluations.overdueEvaluationCount);
  add('Eligibility', 'accuracy', d.eligibility.evaluationEligibilityAccuracy);
  add('Eligibility', 'pairings audited', d.eligibility.pairingsAudited);
  add('Eligibility', 'pairings passing', d.eligibility.pairingsPassing);
  for (const v of d.eligibility.byViolationType) add('Eligibility', `violations: ${v.violation}`, v.count);
  add('Eligibility', 'requests rejected for violations', d.eligibility.requestsRejectedForViolations);
  add('Unmatched faculty', 'signups with no/insufficient observers', d.unmatchedFaculty.noOrInsufficientObservers.length);
  add('Unmatched faculty', 'due but not signed up', d.unmatchedFaculty.dueButNotSignedUp.length);
  for (const b of d.outstandingObservations.byHireLevel) add('Outstanding observations', `${b.hireLevel} / ${b.status}`, b.count);
  add('Outstanding observations', 'missing observations', d.outstandingObservations.missingObservationCount);
  for (const [k, v] of Object.entries(d.participation)) add('Participation', k, v);
  for (const [k, v] of Object.entries(d.surveyCompletion)) add('Survey completion', k, v);
  return rows;
}
const KPI_COLUMNS = [{ label: 'Section', key: 'section' }, { label: 'Metric', key: 'metric' }, { label: 'Value', key: 'value' }];

module.exports = {
  loadSignupRows,
  loadObservationRows,
  kpiRows,
  SIGNUP_COLUMNS,
  DUE_COLUMNS,
  observationColumns,
  WORKLOAD_COLUMNS,
  KPI_COLUMNS,
};
