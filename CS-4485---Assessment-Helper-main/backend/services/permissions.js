// What each role may do, in one place. The routes enforce these rules (requireAc, "only the observee", ...); this list is
// what GET /api/me/permissions tells the frontend so it can show or hide buttons. It is a description, not the lock: a hidden
// button never replaces the server-side check.
const rolesOf = (user) => (user.is_ac_member ? ['professor', 'committee'] : ['professor']);

const PROFESSOR = [
  'me:read',
  'cycles:read',
  'signup:create-own',
  'requests:send-own',
  'requests:answer-own',
  'observation:read-participant',
  'observation:schedule-participant',
  'observation:record-as-observer',
  'observation:sign-participant',
  'observation:report-not-held-participant',
  'report:read-own-after-rules',
  'survey:submit-own',
  'notifications:read-own',
  'course-offerings:read',
  'forms:read',
];

const COMMITTEE = [
  'cycles:write',
  'faculty:read-all',
  'faculty:eligibility-read-all',
  'selection:run',
  'reminders:send',
  'forms:write',
  'dashboard:read',
  'reports:export',
  'report:read-after-both-signed',
  'survey:read-anonymous-results',
  'audit-log:read',
  'jobs:run',
  'course-book:manage',
];

function permissionsOf(user) {
  const roles = rolesOf(user);
  const permissions = [...PROFESSOR, ...(roles.includes('committee') ? COMMITTEE : [])];
  const has = (p) => permissions.includes(p);
  return {
    roles,
    permissions,
    // The yes/no switches a screen usually wants
    capabilities: {
      canSignUp: has('signup:create-own'),
      canManageCycles: has('cycles:write'),
      canEditTemplate: has('forms:write'),
      canRunObserverSelection: has('selection:run'),
      canSeeAllFaculty: has('faculty:read-all'),
      canSeeDashboard: has('dashboard:read'),
      canExportReports: has('reports:export'),
      canSeeSurveyResults: has('survey:read-anonymous-results'),
      canSeeAuditLog: has('audit-log:read'),
    },
    scope: {
      department: user.department,
      // Observers must come from the same department (an eligibility rule); the committee sees every department.
      viewsAllDepartments: roles.includes('committee'),
    },
  };
}

module.exports = { rolesOf, permissionsOf, PROFESSOR, COMMITTEE };
