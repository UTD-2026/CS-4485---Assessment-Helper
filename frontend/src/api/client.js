export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 204) return null;

  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown content type';
    const excerpt = responseText.replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new ApiError(
      `The API returned non-JSON data (HTTP ${response.status}, ${contentType})${excerpt ? `: ${excerpt}` : '.'}`,
      response.status
    );
  }

  if (!response.ok) {
    throw new ApiError(result.error || `Request failed (${response.status}).`, response.status);
  }

  return result.data;
}

export function queryString(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

const segment = (value) => encodeURIComponent(value);

export const assessmentApi = {
  login: (credentials) => apiRequest('/api/auth/login', { method: 'POST', body: credentials }),
  listProfessors: () => apiRequest('/api/professors'),
  getProfessor: (email) => apiRequest(`/api/professors/${segment(email)}`),
  patchProfessor: (email, changes) => apiRequest(`/api/professors/${segment(email)}`, { method: 'PATCH', body: changes }),
  getProfessorEvaluationStatus: (email) => apiRequest(`/api/professors/${segment(email)}/evaluation-status`),

  listCourseSections: (filters) => apiRequest(`/api/course-sections${queryString(filters)}`),
  getCourseSection: ({ course_code, section_number, term }) => apiRequest(
    `/api/course-sections/${segment(course_code)}/${segment(section_number)}/${segment(term)}`
  ),
  createCourseSection: (section) => apiRequest('/api/course-sections', { method: 'POST', body: section }),
  patchCourseSection: ({ course_code, section_number, term }, changes) => apiRequest(
    `/api/course-sections/${segment(course_code)}/${segment(section_number)}/${segment(term)}`,
    { method: 'PATCH', body: changes }
  ),

  listEvaluationCycles: () => apiRequest('/api/evaluation-cycles'),
  getEvaluationCycle: (term) => apiRequest(`/api/evaluation-cycles/${segment(term)}`),
  createEvaluationCycle: (cycle) => apiRequest('/api/evaluation-cycles', { method: 'POST', body: cycle }),
  patchEvaluationCycle: (term, changes) => apiRequest(
    `/api/evaluation-cycles/${segment(term)}`,
    { method: 'PATCH', body: changes }
  ),
  getDueProfessors: (term) => apiRequest(`/api/evaluation-cycles/${segment(term)}/due-professors`),
  getEvaluationTemplate: (term) => apiRequest(`/api/evaluation-cycles/${segment(term)}/template`),

  listObservations: (filters) => apiRequest(`/api/observations${queryString(filters)}`),
  getObservation: ({ course_code, section_number, term }) => apiRequest(
    `/api/observations/${segment(course_code)}/${segment(section_number)}/${segment(term)}`
  ),
  createObservation: (observation) => apiRequest('/api/observations', { method: 'POST', body: observation }),
  patchObservation: ({ course_code, section_number, term }, changes) => apiRequest(
    `/api/observations/${segment(course_code)}/${segment(section_number)}/${segment(term)}`,
    { method: 'PATCH', body: changes }
  ),
  patchObservationStatus: (key, status) => apiRequest(
    `/api/observations/${segment(key.course_code)}/${segment(key.section_number)}/${segment(key.term)}/status`,
    { method: 'PATCH', body: { status } }
  ),
  patchObservationForm: (key, form) => apiRequest(
    `/api/observations/${segment(key.course_code)}/${segment(key.section_number)}/${segment(key.term)}/form`,
    { method: 'PATCH', body: form }
  ),
  reportMissedObservation: (key) => apiRequest(
    `/api/observations/${segment(key.course_code)}/${segment(key.section_number)}/${segment(key.term)}/missed`,
    { method: 'PATCH', body: {} }
  ),

  getSurveyStatus: (professor_email, term) => apiRequest(
    `/api/surveys/status${queryString({ professor_email, term })}`
  ),
  submitSurvey: (response) => apiRequest('/api/surveys', { method: 'POST', body: response }),
  getSurveyResponses: (term) => apiRequest(`/api/surveys/responses${queryString({ term })}`),
};
