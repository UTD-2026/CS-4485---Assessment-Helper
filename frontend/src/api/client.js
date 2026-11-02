// Every call to the backend goes through here. Vite proxies /api to http://localhost:5000 in development
// (frontend/vite.config.js, from the mikael_backend_db branch). Endpoints follow the team's "API Endpoints" doc.

const TOKEN_KEY = 'assessment-helper-token';
let token = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* storage unavailable: stay in memory */ }

export const setToken = (value) => {
  token = value;
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
};
export const hasToken = () => Boolean(token);

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the Assessment Helper API. Is the backend running (npm run backend:dev)?');
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') setToken(null);
    throw new ApiError(res.status, json.error || `Request failed (${res.status}).`);
  }
  return json;
}

const q = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return s ? `?${s}` : '';
};
const enc = encodeURIComponent;
/** "CS 2117|001|Fall 2026" -> "/CS%202117/001/Fall%202026" */
export const keyPath = (id) => '/' + String(id).split('|').map(enc).join('/');

export const api = {
  // Auth
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  me: () => request('GET', '/auth/me'),

  // 1. Professors
  professors: (term) => request('GET', `/professors${q({ term })}`),
  evaluationStatus: (email, term) => request('GET', `/professors/${enc(email)}/evaluation-status${q({ term })}`),

  // 2. Course sections
  courseSections: (params) => request('GET', `/course-sections${q(params)}`),

  // 3. Evaluation cycles
  cycles: () => request('GET', '/evaluation-cycles'),
  updateCycle: (term, deadlines) => request('PATCH', `/evaluation-cycles/${enc(term)}`, deadlines),
  dueProfessors: (term) => request('GET', `/evaluation-cycles/${enc(term)}/due-professors`),
  template: (term) => request('GET', `/evaluation-cycles/${enc(term)}/template`),
  saveTemplate: (term, criteria) => request('PUT', `/evaluation-cycles/${enc(term)}/template`, { criteria }),

  // 4. Observations
  observations: (params) => request('GET', `/observations${q(params)}`),
  signUp: (course_code, section_number, term) => request('POST', '/observations', { course_code, section_number, term }),
  schedule: (id, observation_date, observation_time) => request('PATCH', `/observations${keyPath(id)}`, { observation_date, observation_time }),
  setStatus: (id, status, reason) => request('PATCH', `/observations${keyPath(id)}/status`, { status, reason }),
  form: (id, body) => request('PATCH', `/observations${keyPath(id)}/form`, body),
  reportMissed: (id, reason) => request('PATCH', `/observations${keyPath(id)}/missed`, { reason }),

  // 5. Observer matches
  observerMatches: (params) => request('GET', `/observer-matches${q(params)}`),
  generateList: (id) => request('POST', `/observations${keyPath(id)}/generate-observer-list`),
  releaseList: (id) => request('POST', `/observations${keyPath(id)}/release-observer-list`),
  sendRequests: (id, observer_emails) => request('POST', `/observations${keyPath(id)}/observer-requests`, { observer_emails }),
  respond: (observationId, observerEmail, response) =>
    request('PATCH', `/observer-matches${keyPath(observationId)}/${enc(observerEmail)}/response`, { response }),
  selectObserver: (id, observer_email) => request('POST', `/observations${keyPath(id)}/select-observer`, { observer_email }),

  // 6. Surveys
  surveyStatus: (term, all) => request('GET', `/surveys/status${q({ term, all: all ? 'true' : undefined })}`),
  submitSurvey: (answers) => request('POST', '/surveys', answers),
  surveyResponses: (term) => request('GET', `/surveys/responses${q({ term })}`),
  surveyReminders: (term) => request('POST', '/surveys/reminders', { term }),

  // 7. Reports and KPIs
  kpis: (term) => request('GET', `/reports/kpis${q({ term })}`),
  outstanding: (term) => request('GET', `/reports/outstanding-observations${q({ term })}`),
  unmatched: (term, includeAllDue) => request('GET', `/reports/unmatched-faculty${q({ term, include: includeAllDue ? 'all_due' : undefined })}`),

  // 8. Notifications
  notifications: () => request('GET', '/notifications'),
  markRead: (id) => request('PATCH', `/notifications/${enc(id)}/read`),
  archive: (id) => request('PATCH', `/notifications/${enc(id)}/archive`),
};
