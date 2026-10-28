// The API contract, written as data and turned into an OpenAPI 3.0 document.
//   GET /api/docs/openapi.json        the live document
//   npm run docs                      writes docs/openapi.json (for Swagger UI / Postman / code generators)
// test/contract.test.mjs fails if a route exists in routes/*.js that is missing here (or the other way round), so this
// file cannot quietly drift from the code. Names inside bodies are camelCase; the database underneath is snake_case.
//
// Auth levels:  public = no token  |  user = any signed-in professor  |  committee = Assessment Committee member
const SECTION_ID = 'CS 2117~001~Fall 2026';
const NOTE_SECTION = 'sectionId is "course code ~ section number ~ term" (URL-encode it in paths).';

const professorExample = {
  email: 'ejg104485@utdallas.edu', netId: 'ejg104485', name: 'Dr. Example', department: 'CS', hireLevel: 'assistant', hireLevelLabel: 'Assistant', isAcMember: false, lastObserved: '2025-03-18T00:00:00.000Z',
};
const pagingQuery = [
  { name: 'page', description: 'Page number, starting at 1.', example: 1 },
  { name: 'pageSize', description: 'Rows per page (default 25, at most 100).', example: 25 },
];
const paginationExample = { page: 1, pageSize: 25, total: 61, totalPages: 3, hasNext: true };
const termQuery = { name: 'term', description: 'A term like "Fall 2026". Defaults to the current cycle.', example: 'Fall 2026' };
const observationExample = {
  sectionId: SECTION_ID, status: 'scheduled', observerEmail: 'a.observer@utdallas.edu', observationDate: '2026-10-21T00:00:00.000Z', observationTime: '08:30',
  observerSignedDate: null, observeeSignedDate: null,
  report: {
    canView: false, reason: 'AWAITING_OBSERVER_SIGNATURE', message: 'The report is shared with the observee after the observer has signed it.', started: true, observerSigned: false, observeeSigned: false,
  },
};

/* eslint-disable object-curly-newline */
const OPERATIONS = [
  // ---- Authentication and identity
  { m: 'post', p: '/api/auth/login', tag: 'Authentication', auth: 'public', summary: 'Sign in with a NetID or email and a password',
    body: { username: 'ejg104485', password: 'Password123!' }, response: { token: 'eyJhbGciOiJIUzI1NiIs...', professor: professorExample }, errors: [400, 401] },
  { m: 'get', p: '/api/auth/providers', tag: 'Authentication', auth: 'public', summary: 'Which sign-in methods this server offers',
    response: { providers: [{ id: 'password', enabled: true, mock: false }, { id: 'netid', enabled: true, mock: true, note: 'Proof-of-concept stand-in for UTD single sign-on.' }] } },
  { m: 'post', p: '/api/auth/netid/mock/ticket', tag: 'Authentication', auth: 'public', summary: 'MOCK NetID provider: get a one-time sign-in ticket (NETID_MODE=mock only)',
    body: { netId: 'ejg104485' }, response: { ticket: 'eyJhbGciOi...', expiresInSeconds: 120, mock: true }, errors: [400, 401, 404] },
  { m: 'post', p: '/api/auth/netid/callback', tag: 'Authentication', auth: 'public', summary: 'Exchange a NetID ticket for a session token',
    body: { ticket: 'eyJhbGciOi...' }, response: { token: 'eyJhbGciOiJIUzI1NiIs...', professor: professorExample, provider: 'netid-mock', mock: true }, errors: [400, 401, 403, 404] },
  { m: 'get', p: '/api/auth/me', tag: 'Authentication', auth: 'user', summary: 'The signed-in professor (older shortcut; prefer GET /api/me)', response: { professor: professorExample } },
  { m: 'get', p: '/api/me', tag: 'Authentication', auth: 'user', summary: 'Who am I: the resolved user, roles, current term and phase',
    response: { user: professorExample, roles: ['professor'], currentTerm: 'Fall 2026', phase: 'OBSERVATION' } },
  { m: 'get', p: '/api/me/permissions', tag: 'Authentication', auth: 'user', summary: 'What I may do: permission names, yes/no switches for screens, and my scope',
    response: { roles: ['professor', 'committee'], permissions: ['signup:create-own', 'cycles:write'], capabilities: { canSignUp: true, canManageCycles: true }, scope: { department: 'CS', viewsAllDepartments: true } } },
  { m: 'get', p: '/api/overview', tag: 'Dashboard', auth: 'user', summary: 'What do I do next? (my next step as an observee and for each observer duty)', query: [termQuery],
    response: { term: 'Fall 2026', cycle: { term: 'Fall 2026', phase: 'OBSERVATION' }, evaluation: { status: 'due' }, asObservee: { nextAction: { code: 'CHOOSE_OBSERVERS', message: 'Your observer list is ready.' } }, asObserver: { duties: [], pendingRequests: [], counts: {} }, unreadNotifications: 2 } },

  // ---- Cycles and eligibility
  { m: 'get', p: '/api/cycles', tag: 'Cycles', auth: 'user', summary: 'Every evaluation cycle with its phase', response: { cycles: [{ term: 'Fall 2026', signupDeadline: '2026-09-18T00:00:00.000Z', phase: 'OBSERVATION' }] } },
  { m: 'get', p: '/api/cycles/current', tag: 'Cycles', auth: 'user', summary: 'The cycle people are working in right now', response: { cycle: { term: 'Fall 2026', phase: 'OBSERVATION' } } },
  { m: 'get', p: '/api/cycles/{term}', tag: 'Cycles', auth: 'user', summary: 'One cycle', response: { cycle: { term: 'Fall 2026', phase: 'OBSERVATION' } }, errors: [400, 404] },
  { m: 'post', p: '/api/cycles', tag: 'Cycles', auth: 'committee', summary: 'Create a cycle (three deadlines, in order)',
    body: { term: 'Spring 2027', signupDeadline: '2027-02-05', observationDeadline: '2027-04-09', feedbackDeadline: '2027-04-23' }, response: { cycle: { term: 'Spring 2027', phase: 'SIGNUP' } }, errors: [400, 403, 409] },
  { m: 'put', p: '/api/cycles/{term}', tag: 'Cycles', auth: 'committee', summary: 'Change a cycle\'s deadlines', body: { signupDeadline: '2026-09-25' }, response: { cycle: { term: 'Fall 2026' } }, errors: [400, 403, 404] },
  { m: 'get', p: '/api/cycles/{term}/eligible-faculty', tag: 'Cycles', auth: 'committee', summary: 'Faculty due or overdue this cycle, with the reason, signup blockers and rule version',
    query: [{ name: 'status', description: 'Comma list of due, overdue, not_due (default due,overdue).', example: 'due,overdue' }, { name: 'department', example: 'CS' }, { name: 'hireLevel', example: 'assistant' },
      { name: 'signedUp', description: 'true or false.', example: 'false' }, { name: 'q', description: 'Part of a name or email.' }, ...pagingQuery],
    response: { term: 'Fall 2026', phase: 'OBSERVATION', ruleVersion: '2026.10-committee-v1', faculty: [{ email: 'a@utdallas.edu', status: 'overdue', reason: 'Assistant professor: observed every year. No completed observation is on record, so Dr. A is overdue.', canSignUp: false, blockers: ['SIGNUP_CLOSED'] }], pagination: paginationExample }, errors: [400, 403, 404] },
  { m: 'get', p: '/api/cycles/{term}/due-report', tag: 'Cycles', auth: 'committee', summary: 'Everyone due or overdue, and whether they signed up', response: { term: 'Fall 2026', count: 1, professors: [{ email: 'a@utdallas.edu', status: 'due', signedUp: false }] }, errors: [403, 404] },
  { m: 'post', p: '/api/cycles/{term}/send-due-reminders', tag: 'Cycles', auth: 'committee', summary: 'Remind the due or overdue professors who have not signed up', body: { reminderType: 'DUE_REMINDER' }, response: { term: 'Fall 2026', reminderType: 'DUE_REMINDER', notified: 12 }, errors: [400, 403, 404] },
  { m: 'get', p: '/api/cycles/{term}/signups', tag: 'Cycles', auth: 'committee', summary: 'Every signup of the term (the Signup Monitor)', response: { term: 'Fall 2026', count: 1, signups: [{ sectionId: SECTION_ID, status: 'signed_up' }] }, errors: [403, 404] },
  { m: 'post', p: '/api/cycles/{term}/run-observer-selection', tag: 'Cycles', auth: 'committee', summary: 'Run observer selection for every open signup (after the signup deadline)', body: { force: false },
    response: { term: 'Fall 2026', processed: 40, withObservers: 38, unmatched: 2, insufficient: 5, skipped: 0 }, errors: [403, 404, 409] },
  { m: 'get', p: '/api/cycles/{term}/insufficient-observers', tag: 'Cycles', auth: 'committee', summary: 'Alert list: signups with no eligible observer (add includeFew=true for fewer than five)',
    query: [{ name: 'includeFew', example: 'true' }], response: { term: 'Fall 2026', count: 1, signups: [{ sectionId: SECTION_ID, flag: 'NO_ELIGIBLE_OBSERVER', eligibleCount: 0 }] }, errors: [403, 404] },
  { m: 'post', p: '/api/cycles/{term}/notify-observer-lists-ready', tag: 'Cycles', auth: 'committee', summary: 'Tell each observee their observer list is ready (once each)', response: { term: 'Fall 2026', notified: 38 }, errors: [403, 404] },
  { m: 'post', p: '/api/cycles/{term}/notify-survey', tag: 'Cycles', auth: 'committee', summary: 'Ask everyone observed who has not answered to take the survey', response: { term: 'Fall 2026', notified: 20 }, errors: [403, 404] },

  // ---- Professors, sections, courses
  { m: 'get', p: '/api/professors', tag: 'Faculty', auth: 'committee', summary: 'Everyone with their due status (paged only if page or pageSize is sent)',
    query: [termQuery, { name: 'department', example: 'CS' }, { name: 'hireLevel', example: 'assistant' }, ...pagingQuery], response: { term: 'Fall 2026', count: 100, professors: [{ ...professorExample, due: { status: 'due' } }] }, errors: [403] },
  { m: 'get', p: '/api/professors/{email}', tag: 'Faculty', auth: 'user', summary: 'One professor (yourself, or anyone if you are on the committee)', response: { professor: professorExample }, errors: [403, 404] },
  { m: 'get', p: '/api/professors/{email}/due-status', tag: 'Faculty', auth: 'user', summary: 'Due, overdue or not due for a term', query: [termQuery], response: { term: 'Fall 2026', status: 'due', baselineTerm: 'Spring 2025', anniversary: 'Spring 2026', dueWindow: ['Spring 2026', 'Fall 2026'] }, errors: [403, 404] },
  { m: 'get', p: '/api/professors/{email}/eligibility', tag: 'Faculty', auth: 'user', summary: 'Eligibility for the cycle in words, what blocks signup, and the rule version', query: [termQuery],
    response: { term: 'Fall 2026', phase: 'SIGNUP', ruleVersion: '2026.10-committee-v1', eligibility: { status: 'due', eligibleForCycle: true, reason: 'Assistant professor: observed every year. ...', canSignUp: true, blockers: [] } }, errors: [403, 404] },
  { m: 'get', p: '/api/sections', tag: 'Courses', auth: 'user', summary: 'Course sections you teach in a term (paged only if page or pageSize is sent)', query: [termQuery, { name: 'instructorEmail', description: 'Committee only for someone else.' }, ...pagingQuery],
    response: { term: 'Fall 2026', instructorEmail: 'ejg104485@utdallas.edu', sections: [{ sectionId: SECTION_ID, courseCode: 'CS 2117', timing: 'TT 08:30-09:45', days: 'TR', startTime: '08:30', endTime: '09:45', courseLevel: 2 }] }, errors: [403] },
  { m: 'get', p: '/api/course-offerings', tag: 'Courses', auth: 'user', summary: 'Course offerings from Course Book (or local data), filterable and paged',
    query: [termQuery, { name: 'department', example: 'CS' }, { name: 'level', description: 'Thousands digit of the course number.', example: 3 }, { name: 'instructorEmail' }, { name: 'q', example: '3345' }, ...pagingQuery],
    response: { term: 'Fall 2026', source: 'local', warning: null, offerings: [{ sectionId: SECTION_ID, courseCode: 'CS 2117', department: 'CS', courseLevel: 2, timing: 'TT 08:30-09:45', source: 'local' }], pagination: paginationExample }, errors: [400] },

  // ---- Signup, matching, requests
  { m: 'post', p: '/api/signups', tag: 'Signup and matching', auth: 'user', summary: 'Sign up to be observed, with one of your own sections', body: { sectionId: SECTION_ID }, response: { observation: { sectionId: SECTION_ID, status: 'signed_up' } }, errors: [400, 403, 404, 409] },
  { m: 'get', p: '/api/signups/mine', tag: 'Signup and matching', auth: 'user', summary: 'Your signups', response: { term: 'Fall 2026', observation: { sectionId: SECTION_ID, status: 'signed_up' }, section: { sectionId: SECTION_ID }, mySections: [{ sectionId: SECTION_ID }] } },
  { m: 'get', p: '/api/matching/preview/{sectionId}', tag: 'Signup and matching', auth: 'committee', summary: 'Why each colleague is or is not eligible (nothing is saved)',
    response: { sectionId: SECTION_ID, eligibleCount: 27, flag: 'OK', mode: 'random', wouldShow: ['a@utdallas.edu'], evaluations: [{ email: 'b@utdallas.edu', eligible: false, violation: 'DIFFERENT_LEVEL' }] }, errors: [400, 403, 404] },
  { m: 'post', p: '/api/matching/generate/{sectionId}', tag: 'Signup and matching', auth: 'committee', summary: 'Build and save the observer list for one signup',
    response: { sectionId: SECTION_ID, mode: 'all', eligibleCount: 3, flag: 'INSUFFICIENT_OBSERVERS', candidateEmails: ['a@utdallas.edu'], hasSufficientObservers: true }, errors: [400, 403, 404] },
  { m: 'get', p: '/api/observations/{sectionId}/candidates', tag: 'Signup and matching', auth: 'user', summary: 'The observer list for a signup (the observee or the committee)',
    response: { sectionId: SECTION_ID, observationStatus: 'signed_up', eligibleCount: 3, flag: 'INSUFFICIENT_OBSERVERS', candidates: [{ observerEmail: 'a@utdallas.edu', status: 'suggested', observer: professorExample }] }, errors: [400, 403, 404] },
  { m: 'post', p: '/api/observation-requests', tag: 'Requests', auth: 'user', summary: 'Ask some or all suggested observers (each request expires after 48 hours)',
    body: { sectionId: SECTION_ID, observerEmails: ['a@utdallas.edu', 'b@utdallas.edu'] }, response: { requested: [{ observerEmail: 'a@utdallas.edu', expiresAt: '2026-10-14T15:00:00.000Z' }], rejected: [] }, errors: [400, 403, 404, 409, 422] },
  { m: 'get', p: '/api/observation-requests/incoming', tag: 'Requests', auth: 'user', summary: 'Requests addressed to you, with class time and hours left', response: { requests: [{ sectionId: SECTION_ID, status: 'requested', hoursLeft: 41.5 }] } },
  { m: 'post', p: '/api/observation-requests/{sectionId}/respond', tag: 'Requests', auth: 'user', summary: 'Answer a request. CONFIRM: first wins (default) or "accepted" (CONFIRMATION_MODE=observee_final).',
    body: { response: 'CONFIRM' }, response: { match: { status: 'confirmed' }, observation: observationExample, autoCancelled: ['b@utdallas.edu'] }, errors: [400, 404, 409, 410] },
  { m: 'post', p: '/api/observation-requests/{sectionId}/finalize', tag: 'Requests', auth: 'user', summary: 'Observee picks one accepted observer (CONFIRMATION_MODE=observee_final only)',
    body: { observerEmail: 'a@utdallas.edu' }, response: { observation: observationExample, observerEmail: 'a@utdallas.edu', autoCancelled: ['b@utdallas.edu'] }, errors: [400, 403, 404, 409] },

  // ---- Observations
  { m: 'get', p: '/api/observations/mine', tag: 'Observations', auth: 'user', summary: 'Everything you are part of this term (as observee and as observer). The report follows the visibility rule.', query: [termQuery],
    response: { term: 'Fall 2026', asObservee: [{ observation: observationExample, signedTemplate: null }], asObserver: [] } },
  { m: 'get', p: '/api/observations/{sectionId}', tag: 'Observations', auth: 'user', summary: 'One observation, both people and (if you may see it) the report. ' + NOTE_SECTION,
    response: { observation: observationExample, section: { sectionId: SECTION_ID }, observee: professorExample, observer: professorExample, signedTemplate: null }, errors: [400, 403, 404] },
  { m: 'patch', p: '/api/observations/{sectionId}/schedule', tag: 'Observations', auth: 'user', summary: 'Set the observation date (a class day) and, optionally, the time (the class start)',
    body: { observationDate: '2026-10-21', observationTime: '8:30 AM' }, response: { observation: observationExample }, errors: [400, 403, 404, 409] },
  { m: 'post', p: '/api/observations/{sectionId}/report-not-held', tag: 'Observations', auth: 'user', summary: '"Did Not Happen": mark the scheduled observation as missed so it can be rescheduled',
    body: { reason: 'The class was cancelled' }, response: { observation: { status: 'missed', missedReportedBy: 'a@utdallas.edu' } }, errors: [400, 403, 404, 409] },
  { m: 'post', p: '/api/observations/{sectionId}/record', tag: 'Observations', auth: 'user', summary: 'Observer starts their copy of the template (snapshots the current version)', response: { observation: observationExample }, errors: [403, 404, 409] },
  { m: 'put', p: '/api/observations/{sectionId}/record', tag: 'Observations', auth: 'user', summary: 'Observer saves ratings and comments (until the first signature)', body: { values: { organization: 4, comments: 'Clear and well paced.' } }, response: { observation: observationExample }, errors: [400, 403, 404, 409] },
  { m: 'post', p: '/api/observations/{sectionId}/sign', tag: 'Observations', auth: 'user', summary: 'Sign. The observer signs first and locks the record; the observee then signs and completes it.', response: { completed: false, observation: observationExample }, errors: [403, 404, 409, 422] },
  { m: 'put', p: '/api/observations/{sectionId}/files/signed-template', tag: 'Observations', auth: 'user', summary: 'Observer uploads the signed PDF (raw application/pdf body, optional ?filename=)', response: { file: { filename: 'signed-form.pdf', size: 20480, version: 1 } }, errors: [403, 404, 409, 413, 415] },
  { m: 'post', p: '/api/observations/{sectionId}/files/signed-template', tag: 'Observations', auth: 'user', summary: 'Same as PUT', response: { file: { filename: 'signed-form.pdf', size: 20480, version: 1 } }, errors: [403, 404, 409, 413, 415] },
  { m: 'get', p: '/api/observations/{sectionId}/files', tag: 'Observations', auth: 'user', summary: 'What files are on record (names and sizes, never the bytes)', response: { sectionId: SECTION_ID, files: [] }, errors: [403, 404] },
  { m: 'get', p: '/api/observations/{sectionId}/files/signed-template', tag: 'Observations', auth: 'user', summary: 'Download the signed PDF, subject to the report visibility rule', binary: 'application/pdf', errors: [403, 404] },
  { m: 'get', p: '/api/observations/{sectionId}/calendar.ics', tag: 'Observations', auth: 'user', summary: 'Calendar file for the scheduled observation (uses the chosen time)', binary: 'text/calendar', errors: [403, 404, 409] },

  // ---- Template and surveys
  { m: 'get', p: '/api/forms', tag: 'Template', auth: 'user', summary: 'Every form definition', response: { forms: [{ formId: 'observation', version: 1, fields: [{ key: 'organization', type: 'rating', min: 1, max: 5 }] }] } },
  { m: 'get', p: '/api/forms/{formId}', tag: 'Template', auth: 'user', summary: 'One form (the observation template is "observation")', response: { form: { formId: 'observation', version: 1 } }, errors: [404] },
  { m: 'post', p: '/api/forms', tag: 'Template', auth: 'committee', summary: 'Create a new form', body: { formId: 'followup', title: 'Follow-up', fields: [{ key: 'notes', label: 'Notes', type: 'text' }] }, response: { form: { formId: 'followup', version: 1 } }, errors: [400, 403, 409] },
  { m: 'put', p: '/api/forms/{formId}', tag: 'Template', auth: 'committee', summary: 'Publish a new version of a form (older observations keep their version)', body: { title: 'Peer Teaching Observation', fields: [{ key: 'organization', label: 'Organization', type: 'rating', min: 1, max: 5 }] }, response: { form: { version: 2 } }, errors: [400, 403, 404, 409] },
  { m: 'get', p: '/api/surveys/templates', tag: 'Surveys', auth: 'user', summary: 'Survey templates (all versions)', response: { templates: [{ templateId: 'end-of-process', version: 1, active: true }] } },
  { m: 'get', p: '/api/surveys/templates/active', tag: 'Surveys', auth: 'user', summary: 'The questions to show now',
    response: { template: { templateId: 'end-of-process', version: 1, questions: [{ key: 'process_ok', label: 'Was this observation process OK?', type: 'yes_no', required: true }] } } },
  { m: 'get', p: '/api/surveys/templates/{templateId}', tag: 'Surveys', auth: 'user', summary: 'The newest version of one template', response: { template: { templateId: 'end-of-process', version: 1 } }, errors: [404] },
  { m: 'get', p: '/api/surveys/status', tag: 'Surveys', auth: 'user', summary: 'Have I answered, may I still, when does it close? (no answers)', query: [termQuery],
    response: { term: 'Fall 2026', submitted: false, eligible: true, closed: false, deadline: '2026-11-20T00:00:00.000Z', canSubmit: true }, errors: [400, 404] },
  { m: 'post', p: '/api/surveys', tag: 'Surveys', auth: 'user', summary: 'Submit the survey. Answers are stored without your identity; only "finished" is recorded against your name.',
    body: { term: 'Fall 2026', process_ok: true, difficulties: 'Finding a time was hard.', improvements: 'Show class times earlier.', has_attachment: false }, response: { survey: { submitted: true, term: 'Fall 2026', submittedDate: '2026-10-27T00:00:00.000Z' } }, errors: [400, 404, 409] },
  { m: 'get', p: '/api/surveys/mine', tag: 'Surveys', auth: 'user', summary: 'The terms you finished the survey for', response: { surveys: [{ term: 'Spring 2026', submittedDate: '2026-04-20T00:00:00.000Z' }] } },
  { m: 'get', p: '/api/surveys', tag: 'Surveys', auth: 'committee', summary: 'Counts and anonymous answers for a term (answers withheld below the minimum count)', query: [termQuery, ...pagingQuery],
    response: { term: 'Fall 2026', submittedCount: 14, expectedCount: 20, completionRate: 0.7, detailsWithheld: false, summary: { processOk: 11, processNotOk: 3 }, responses: [{ responseId: '0b0e0c8e-...', answers: { process_ok: true }, hasAttachment: false }], pagination: paginationExample }, errors: [400, 403, 404] },

  // ---- Notifications
  { m: 'get', p: '/api/notifications', tag: 'Notifications', auth: 'user', summary: 'Your notifications, newest first (paged if page or pageSize is sent)', query: [{ name: 'unread', example: 'true' }, { name: 'limit' }, ...pagingQuery], response: { unreadCount: 2, notifications: [{ type: 'REQUEST_RECEIVED', message: '...', readAt: null }] } },
  { m: 'post', p: '/api/notifications/read-all', tag: 'Notifications', auth: 'user', summary: 'Mark all read', response: { marked: 2 } },
  { m: 'post', p: '/api/notifications/{id}/read', tag: 'Notifications', auth: 'user', summary: 'Mark one read', response: { ok: true }, errors: [400, 404] },

  // ---- Committee dashboards, reports, operations
  { m: 'get', p: '/api/admin/dashboard-stats', tag: 'Committee dashboard', auth: 'committee', summary: 'All KPIs for a term', query: [termQuery], response: { term: 'Fall 2026', facultyDueForEvaluation: { total: 42 }, participation: { assessmentParticipationRate: 0.8 } }, errors: [403] },
  { m: 'get', p: '/api/admin/dashboard-stats/faculty-due-for-evaluation', tag: 'Committee dashboard', auth: 'committee', summary: 'KPI: faculty due', query: [termQuery], response: { total: 42 }, errors: [403] },
  { m: 'get', p: '/api/admin/dashboard-stats/overdue-evaluations', tag: 'Committee dashboard', auth: 'committee', summary: 'KPI: overdue evaluations', query: [termQuery], response: { overdueAtCycleStart: 10 }, errors: [403] },
  { m: 'get', p: '/api/admin/dashboard-stats/eligibility-violations', tag: 'Committee dashboard', auth: 'committee', summary: 'KPI: eligibility accuracy and violations', query: [termQuery], response: { evaluationEligibilityAccuracy: 0.29 }, errors: [403] },
  { m: 'get', p: '/api/admin/dashboard-stats/unmatched-faculty', tag: 'Committee dashboard', auth: 'committee', summary: 'KPI: faculty with no or too few observers', query: [termQuery], response: { noOrInsufficientObservers: 4 }, errors: [403] },
  { m: 'get', p: '/api/admin/dashboard-stats/outstanding-observations', tag: 'Committee dashboard', auth: 'committee', summary: 'KPI: outstanding observations', query: [termQuery], response: { missingObservationCount: 1 }, errors: [403] },
  { m: 'get', p: '/api/admin/dashboard-stats/participation', tag: 'Committee dashboard', auth: 'committee', summary: 'KPI: participation and observer utilization', query: [termQuery], response: { signups: 40 }, errors: [403] },
  { m: 'get', p: '/api/admin/dashboard-stats/survey-completion', tag: 'Committee dashboard', auth: 'committee', summary: 'KPI: survey completion (counts only)', query: [termQuery], response: { surveyed: 14 }, errors: [403] },
  { m: 'get', p: '/api/admin/analytics/observer-workload', tag: 'Committee dashboard', auth: 'committee', summary: 'Observer workload and acceptance rates', query: [termQuery], response: { term: 'Fall 2026', summary: { professorsAsked: 60, requestsSent: 140, observersWithAssignments: 38, assignments: 40, meanAssignmentsPerObserver: 1.05, maxAssignments: 3, busiest: [] }, byHireLevel: [{ hireLevel: 'assistant', observers: 10, assignments: 12 }], professors: [{ email: 'a@utdallas.edu', asked: 4, confirmed: 1, acceptRate: 0.5 }] }, errors: [403] },
  { m: 'get', p: '/api/reports/due', tag: 'Reports (CSV)', auth: 'committee', summary: 'CSV: due and overdue faculty', query: [termQuery], binary: 'text/csv', errors: [403] },
  { m: 'get', p: '/api/reports/signups', tag: 'Reports (CSV)', auth: 'committee', summary: 'CSV: signups', query: [termQuery], binary: 'text/csv', errors: [403] },
  { m: 'get', p: '/api/reports/observations', tag: 'Reports (CSV)', auth: 'committee', summary: 'CSV: observations. Scores appear only for completed observations.', query: [termQuery], binary: 'text/csv', errors: [403] },
  { m: 'get', p: '/api/reports/workload', tag: 'Reports (CSV)', auth: 'committee', summary: 'CSV: observer workload', query: [termQuery], binary: 'text/csv', errors: [403] },
  { m: 'get', p: '/api/reports/kpis', tag: 'Reports (CSV)', auth: 'committee', summary: 'CSV: the KPI dashboard', query: [termQuery], binary: 'text/csv', errors: [403] },
  { m: 'post', p: '/api/admin/jobs/run', tag: 'Operations', auth: 'committee', summary: 'Run both sweeps now', response: { expiredRequests: 2, missedObservations: 0 }, errors: [403] },
  { m: 'post', p: '/api/admin/jobs/expire-requests', tag: 'Operations', auth: 'committee', summary: 'Expire requests older than 48 hours', response: { expiredCount: 2 }, errors: [403] },
  { m: 'post', p: '/api/admin/jobs/mark-missed', tag: 'Operations', auth: 'committee', summary: 'Mark scheduled observations whose day passed as missed', response: { missedCount: 0 }, errors: [403] },
  { m: 'get', p: '/api/admin/audit-log', tag: 'Operations', auth: 'committee', summary: 'Who did what and when (filterable, paged, newest first). `detail` is an object whose keys depend on the action, or null.',
    query: [{ name: 'actor' }, { name: 'action', example: 'observation.signed' }, { name: 'actionPrefix', example: 'observation.' }, { name: 'targetType' }, { name: 'targetId' }, termQuery, { name: 'from', example: '2026-10-01' }, { name: 'to', example: '2026-10-31' }, ...pagingQuery],
    response: { entries: [{ at: '2026-10-21T15:00:00.000Z', actorEmail: 'a@utdallas.edu', actorRole: 'professor', action: 'observation.signed', targetType: 'observation', targetId: SECTION_ID, detail: null }], pagination: paginationExample }, errors: [400, 403] },
  { m: 'get', p: '/api/admin/course-book/status', tag: 'Operations', auth: 'committee', summary: 'Course Book adapter settings and last error', response: { mode: 'local', configured: false, timeoutMs: 3000, retries: 2, cacheSeconds: 600, lastError: null }, errors: [403] },
  { m: 'post', p: '/api/admin/course-book/refresh', tag: 'Operations', auth: 'committee', summary: 'Forget the cached Course Book answer', body: { term: 'Fall 2026' }, response: { cleared: 'Fall 2026' }, errors: [400, 403] },
  { m: 'post', p: '/api/admin/surveys/anonymize-legacy', tag: 'Operations', auth: 'committee', summary: 'Move older name-linked survey answers into anonymous responses', response: { checked: 61, moved: 61 }, errors: [403] },
];
/* eslint-enable object-curly-newline */

const ERROR_TEXT = {
  400: 'Bad input (the message says what).', 401: 'Not signed in, or the token is invalid or expired.', 403: 'Signed in but not allowed.', 404: 'Not found.',
  409: 'Wrong state, or someone else got there first (the code says which).', 410: 'The request expired.', 413: 'Too large.', 415: 'Wrong file type.', 422: 'The rules rejected it (the details say which).',
};

const toParams = (op) => {
  const params = [];
  for (const [, name] of op.p.matchAll(/\{(\w+)\}/g)) {
    params.push({
      name, in: 'path', required: true, schema: { type: 'string' }, example: name === 'sectionId' ? SECTION_ID : name === 'term' ? 'Fall 2026' : undefined, description: name === 'sectionId' ? NOTE_SECTION : undefined,
    });
  }
  for (const q of op.query || []) params.push({ name: q.name, in: 'query', required: false, schema: { type: 'string' }, description: q.description, example: q.example });
  return params;
};

function buildOperation(op) {
  const out = {
    tags: [op.tag],
    summary: op.summary,
    operationId: `${op.m}${op.p.replace(/\{(\w+)\}/g, '_$1').replace(/[^A-Za-z0-9_]+/g, '_')}`,
    parameters: toParams(op),
    responses: {},
  };
  if (op.auth !== 'public') out.security = [{ bearerAuth: [] }];
  out['x-access'] = op.auth;
  if (op.body !== undefined) out.requestBody = { required: true, content: { 'application/json': { schema: { type: 'object' }, example: op.body } } };
  if (op.p.endsWith('/files/signed-template') && ['put', 'post'].includes(op.m)) {
    out.requestBody = { required: true, content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } };
  }
  out.responses[op.m === 'post' && op.p === '/api/signups' ? '201' : '200'] = op.binary
    ? { description: 'The file.', content: { [op.binary]: { schema: { type: 'string', format: op.binary === 'application/pdf' ? 'binary' : undefined } } } }
    : { description: 'Success.', content: { 'application/json': { schema: { type: 'object' }, example: op.response } } };
  const errors = new Set(op.errors || []);
  if (op.auth !== 'public') errors.add(401);
  if (op.auth === 'committee') errors.add(403);
  for (const code of [...errors].sort()) out.responses[String(code)] = { $ref: `#/components/responses/E${code}` };
  if (!out.parameters.length) delete out.parameters;
  return out;
}

function openApiDocument() {
  const paths = {};
  for (const op of OPERATIONS) {
    paths[op.p] = paths[op.p] || {};
    paths[op.p][op.m] = buildOperation(op);
  }
  const responses = {};
  for (const [code, description] of Object.entries(ERROR_TEXT)) {
    responses[`E${code}`] = {
      description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: description, code: 'OPTIONAL_MACHINE_CODE' } } },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Assessment Helper API',
      version: '1.0.0',
      description: 'Peer teaching observations for UTD CS: signup, observer matching, in-app observation record, signatures, anonymous survey, committee dashboard. '
        + 'JSON uses camelCase. A course section is identified by one string, the sectionId ("CS 2117~001~Fall 2026"). Lists that can grow use ?page=&pageSize= and return { pagination }. '
        + 'Errors are { error, code?, details? }. Sign in with POST /api/auth/login (or the NetID mock flow) and send "Authorization: Bearer <token>".',
    },
    servers: [{ url: 'http://localhost:5000', description: 'Local development' }],
    tags: [...new Set(OPERATIONS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object', required: ['error'], properties: { error: { type: 'string' }, code: { type: 'string' }, details: {} },
        },
      },
      responses,
    },
  };
}

module.exports = { OPERATIONS, openApiDocument };
