import React, { useState, useEffect, useCallback, useRef } from 'react';
import './styles/App.css';
import FeedbackSurvey from './components/FeedbackSurvey.jsx';
import AdminSurveyResults from './components/AdminSurveyResults.jsx';
import AdminKpiDashboard from './components/AdminKpiDashboard.jsx';
import ScheduleObservationForm from './components/ScheduleObservationForm.jsx';
import CommitteeReports from './components/CommitteeReports.jsx';
import TestAccountsDialog from './components/TestAccountsDialog.jsx';
import Toaster from './components/Toaster.jsx';
import LoginBackground from './components/LoginBackground.jsx';
import Icon from './components/Icon.jsx';
import { AppShell, PageHeader, Badge, Card, Notice, EmptyState, Meter, UserMenu } from './components/ui.jsx';
import { daysUntil, initials, plural } from './utils/format.js';
import { validateObservationSlot, todayLocalISO } from './utils/scheduling.js';
import { isPastDeadline, isSurveyClosed as surveyIsClosed, formatDeadline, formatTime12 } from './utils/deadlines.js';
import { createFacultyCsv } from './utils/facultyCsv.js';
import { toast } from './utils/toast.js';
import { api, setToken, hasToken } from './api/client.js';
import { adaptProfessor, formatDate, notifDateParts } from './api/adapters.js';
import useAppData from './api/useAppData.js';

/** Fixed-width date/time column of a notification card, so the divider sits at the same spot on every card. */
function NotifWhen({ value }) {
  const { date, time } = notifDateParts(value);
  return (
    <span className="notif-when">
      <span>{date}</span>
      {time && <span>{time}</span>}
    </span>
  );
}

// "Fall 2026" -> "Spring 2027"
function nextTermOf(term = '') {
  const [season, year] = term.split(' ');
  if (!year) return term;
  return season === 'Spring' ? `Fall ${year}` : `Spring ${Number(year) + 1}`;
}

// Runs an API action; shows a toast with the result. Returns true on success.
async function run(action, successMessage) {
  try {
    await action();
    if (successMessage) toast.success(successMessage);
    return true;
  } catch (error) {
    toast.error(error.message);
    return false;
  }
}

// "2026-11-09" -> "Mon, Nov 9"
function shortDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return value || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ("2026-11-13", "17:00") -> "Fri, Nov 13 at 5:00 PM";  no time -> "Fri, Nov 13" (closes at the end of the day)
function shortDeadline(date, time) {
  if (!date) return '';
  return time ? `${shortDate(date)} at ${formatTime12(time)}` : shortDate(date);
}

// One deadline card on the committee's Deadlines tab: big date + close time, a date picker and an optional time picker.
function DeadlineCard({ id, title, date, time, onChange, status, hint, className = '' }) {
  return (
    <div className={`card deadline-card ${className}`.trim()}>
      <span className="row-between"><strong>{title}</strong>{status}</span>
      <span className="deadline-date">{date ? shortDate(date) : '—'} <small>{formatTime12(time)}</small></span>
      <span className="field-hint">
        {date ? `Closes ${formatDeadline(date, time)}.` : ''} {hint}
        {!time && ' Leave the time blank to close at the end of the day.'}
      </span>
      <div className="row">
        <input id={`${id}-date`} aria-label={`${title} date`} className="input field-grow" type="date" value={date} onChange={e => onChange({ date: e.target.value })} />
        <input id={`${id}-time`} aria-label={`${title} time`} className="input field-grow" type="time" value={time || ''} onChange={e => onChange({ time: e.target.value })} />
      </div>
    </div>
  );
}

const RATING_SCALES = ['1 to 5 (Poor to Excellent)', 'Yes / No / N/A', 'Text Feedback Only'];

// Explains what each rating option means for a criterion's rating scale
function getRatingLegend(ratingScale = '') {
  if (ratingScale.includes('1 to 5')) return '1 = Poor · 2 = Fair · 3 = Good · 4 = Very good · 5 = Excellent';
  if (ratingScale.includes('Yes / No')) return 'Yes = observed or met · No = not observed or met · N/A = not applicable to this session';
  if (ratingScale.includes('Text Feedback')) return 'No rating for this item. Write your feedback in the notes.';
  return ratingScale ? `Rating scale: ${ratingScale}` : '';
}

const OBS_TONE = { Completed: 'good', Scheduled: 'info', 'Pending Scheduling': 'warn', 'Awaiting Confirmation': 'warn', Missed: 'bad', 'Deferred / Rolled Over': 'warn' };
const REQ_TONE = { Pending: 'warn', Accepted: 'info', Confirmed: 'good', Declined: 'bad', Cancelled: 'neutral' };
const FLAG = {
  OK: ['OK', 'good'],
  'INSUFFICIENT OBSERVERS': ['Insufficient', 'warn'],
  'NO ELIGIBLE OBSERVER': ['No eligible observer', 'bad'],
};

function StatusBadge({ status }) {
  return <Badge tone={OBS_TONE[status] || 'neutral'}>{status}</Badge>;
}

function DueBadge({ prof }) {
  if (prof.status === 'Overdue') return <Badge tone="bad">Overdue · {prof.overdue_by} sem</Badge>;
  if (prof.status === 'Due') return <Badge tone="warn">Due</Badge>;
  return <Badge tone="neutral">Not due · next {prof.next_eval}</Badge>;
}

// Read-only view of a submitted evaluation form (committee "Digital evaluations" and professor "My evaluations")
function EvaluationDetail({ evaluation, evaluationTemplate, onBack, backLabel = 'Back' }) {
  // Prefer the criteria snapshot saved at submission time, so later template edits don't change old forms
  const items = evaluation.items || (evaluationTemplate || []).filter((t) => evaluation.answers?.[t.id]);
  const numeric = items.map((i) => Number(evaluation.answers?.[i.id]?.rating)).filter((n) => n >= 1 && n <= 5);
  const average = numeric.length ? (numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(1) : null;

  return (
    <section className="card card-lg max-880">
      <button type="button" className="btn btn-ghost btn-sm section-gap" onClick={onBack}><Icon name="chevronLeft" size={16} /> {backLabel}</button>
      <div className="row-between section-gap">
        <div>
          <h2 className="page-title">{evaluation.observeeName}</h2>
          <p className="page-sub">
            <span className="mono">{evaluation.courseCode}</span>{evaluation.timing ? ` · ${evaluation.timing}` : ''} · observed by {evaluation.observerName} · submitted {formatDate(evaluation.dateSubmitted)}
          </p>
        </div>
        {average && (
          <div>
            <div className="kpi-value text-good">{average}</div>
            <div className="faint">average of {numeric.length}</div>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <p className="muted">No answers were recorded for this evaluation.</p>
      ) : items.map((item, index) => {
        const answer = evaluation.answers?.[item.id] || {};
        const value = Number(answer.rating);
        const isScore = value >= 1 && value <= 5;
        const tone = isScore ? (value >= 4 ? 'good' : value === 3 ? 'neutral' : 'warn') : answer.rating === 'Yes' ? 'good' : answer.rating === 'No' ? 'bad' : 'neutral';
        return (
          <div key={item.id} className="rating-row">
            <span className="mono faint">{index + 1}</span>
            <span>{item.criteria}</span>
            {isScore ? <Meter size="md" tone="good" value={value * 20} label={`${value} of 5`} /> : <span />}
            <span>{answer.rating ? <Badge tone={tone}>{isScore ? `${value}/5` : answer.rating}</Badge> : <span className="faint">—</span>}</span>
            {answer.notes && <span className="notes">{answer.notes}</span>}
          </div>
        );
      })}
      {items.some((i) => i.ratingScale?.includes('1 to 5')) && <p className="formula">{getRatingLegend('1 to 5')}</p>}
    </section>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [restoring, setRestoring] = useState(hasToken());

  // Re-open the session after a page refresh (the token is kept for this browser tab)
  useEffect(() => {
    if (!hasToken()) return;
    api.me()
      .then(res => setCurrentUser(adaptProfessor(res.data)))
      .catch(() => setToken(null))
      .finally(() => setRestoring(false));
  }, []);

  const data = useAppData(currentUser);

  const handleLogin = (user) => setCurrentUser(user);
  const handleLogout = () => { setToken(null); setCurrentUser(null); };

  const handleSurveySubmit = async (answers) => {
    if (data.surveyStatus?.submitted) return;
    await run(() => api.submitSurvey({ term: data.term, ...answers }), 'Survey submitted. Thank you for the feedback.');
    await data.refresh();
  };

  let screen;
  if (restoring) screen = <div className="app-loading">Loading…</div>;
  else if (!currentUser) screen = <Login onLogin={handleLogin} />;
  else if (data.loading) screen = <div className="app-loading">{data.error ? `Could not load data: ${data.error}` : 'Loading your evaluation cycle…'}</div>;
  // Committee (AC) members get the Committee portal; everyone else gets the Professor portal
  else if (currentUser.is_ac_member) {
    screen = (
      <AdminDashboard
        user={currentUser}
        onLogout={handleLogout}
        data={data}
        globalRequests={data.requests}
        surveyResponses={data.surveyResponses}
        submittedCount={data.surveyResponses.length}
        totalProfessors={data.surveyExpected}
        globalSignups={data.signups}
        globalObservations={data.observations}
        globalDeadlines={data.deadlines}
        surveySubmissions={data.surveySubmissions}
        evaluationTemplate={data.template}
        globalEvaluations={data.evaluations.filter(ev => ev.term === data.term).sort((x, y) => String(y.dateSubmitted).localeCompare(String(x.dateSubmitted)))}
      />
    );
  } else {
    screen = (
      <ProfessorDashboard
        user={currentUser}
        onLogout={handleLogout}
        data={data}
        globalRequests={data.requests}
        globalSignups={data.signups}
        globalObservations={data.observations}
        hasSubmittedSurvey={Boolean(data.surveyStatus?.submitted)}
        onSurveySubmit={handleSurveySubmit}
        evaluationTemplate={data.template}
        globalDeadlines={data.deadlines}
        globalNotifications={data.notifications}
        globalEvaluations={data.evaluations}
        evaluationDrafts={data.drafts}
      />
    );
  }

  return <>{screen}<Toaster /></>;
}

/* =========================================
   LOGIN PAGE (Credential Validation)
========================================= */
function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const closeAccounts = useCallback(() => setShowAccounts(false), []);

  // POST /api/auth/login: accepts a NetID (the part of the email before @) or the full email
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.login(username.trim(), password);
      setToken(res.data.token);
      setError('');
      onLogin(adaptProfessor(res.data.professor));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <LoginBackground />
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo" aria-hidden="true">UTD</div>
          <h1>ASSESSMENT HELPER</h1>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <Notice tone="bad">{error}</Notice>}
          <label className="field" htmlFor="username">
            Username
            <input id="username" type="text" placeholder="NetID, e.g., ddr199513" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="field" htmlFor="password">
            Password
            <input id="password" type="password" placeholder="Enter your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        </form>

        <div className="login-hint">
          <span className="section-label login-hint-title">Test credentials</span>
          <div className="login-hint-cols">
            <div className="login-hint-col">
              <span className="login-hint-head">Professors</span>
              <span className="login-hint-acct"><span className="mono">nal595463</span><small>(observee)</small></span>
              <span className="login-hint-acct"><span className="mono">jlh753843</span><small>(observer)</small></span>
              <span className="login-hint-acct"><span className="mono">jdf262865</span><small>(scheduled)</small></span>
            </div>
            <div className="login-hint-col">
              <span className="login-hint-head">Committee</span>
              <span className="login-hint-acct"><span className="mono">ddr199513</span></span>
            </div>
          </div>
          <span className="login-hint-pw">Password: <span className="mono">Password123!</span></span>
          <span>Need more? <button type="button" className="btn-link login-hint-link" onClick={() => setShowAccounts(true)}>Browse all test accounts</button></span>
        </div>
      </div>

      {showAccounts && (
        <TestAccountsDialog
          onClose={closeAccounts}
          onPick={(netid) => { setUsername(netid); setPassword('Password123!'); setShowAccounts(false); }}
        />
      )}
    </div>
  );
}

/* =========================================
   COMMITTEE PORTAL
========================================= */
const ADMIN_TITLES = {
  metrics: ['Live metrics', 'KPIs recalculated as faculty act'],
  faculty: ['Faculty search', 'Find professors and their evaluation status'],
  reports: ['Committee reports', 'Current-cycle reports from the database'],
  signups: ['Signup monitor', 'Release observer lists or resolve gaps by hand'],
  deadlines: ['Deadlines', 'Milestones for this evaluation cycle'],
  template: ['Template editor', 'Criteria observers rate during in-person evaluations'],
  evaluations: ['Digital evaluations', 'Forms submitted this cycle'],
  surveys: ['Survey responses', 'Anonymous end-of-process feedback'],
};

function AdminDashboard({ user, onLogout, data, globalSignups, globalRequests, globalObservations, globalDeadlines, surveyResponses, submittedCount, totalProfessors, surveySubmissions, evaluationTemplate, globalEvaluations }) {
  const { term: currentSemester, professors, courses, refresh } = data;
  const [activeTab, setActiveTab] = useState('metrics');
  const [reportsVersion, setReportsVersion] = useState(0);
  // Deadlines form edits a local copy, saved with PATCH /api/evaluation-cycles/:term
  const [deadlineForm, setDeadlineForm] = useState(globalDeadlines);
  useEffect(() => { setDeadlineForm(globalDeadlines); }, [globalDeadlines.signup, globalDeadlines.signupTime, globalDeadlines.observation, globalDeadlines.observationTime, globalDeadlines.survey, globalDeadlines.surveyTime]);
  // Template Editor: each term has its own template JSON file; edits default to NEXT term so the form in use doesn't change mid-cycle
  const termOptions = [...new Set([...(data.cycles || []).map(c => c.term), nextTermOf(currentSemester)])];
  const [templateTerm, setTemplateTerm] = useState(nextTermOf(currentSemester));
  const [editedTemplate, setEditedTemplate] = useState([]);
  const [templateSource, setTemplateSource] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.template(templateTerm).then(res => { if (!cancelled) { setEditedTemplate(res.data.criteria || []); setTemplateSource(res.data.source); } }).catch(e => toast.error(e.message));
    return () => { cancelled = true; };
  }, [templateTerm]);
  // Faculty Search (from the sriproflookup branch)
  const [facultySearch, setFacultySearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('due-overdue');
  const [viewingEvaluation, setViewingEvaluation] = useState(null);

  // New criterion form
  const [newCriteria, setNewCriteria] = useState('');
  const [newRating, setNewRating] = useState(RATING_SCALES[0]);

  // Inline editing of a criterion
  const [editingId, setEditingId] = useState(null);
  const [editCriteria, setEditCriteria] = useState('');
  const [editRating, setEditRating] = useState(RATING_SCALES[0]);

  // Signup monitor: one expanded sign-up at a time, with its manual-assignment choice
  const [expandedSignup, setExpandedSignup] = useState(null);
  const [signupFilter, setSignupFilter] = useState('needs');
  const [manualObserverId, setManualObserverId] = useState('');

  // Check if observation deadline passed
  const isPastObservationDeadline = isPastDeadline(globalDeadlines?.observation, globalDeadlines?.observationTime);

  const goTo = (id, filters = {}) => {
    setActiveTab(id);
    setViewingEvaluation(null);
    setEditingId(null);
    if (id === 'reports') setReportsVersion(v => v + 1);
    if (filters.status) { setStatusFilter(filters.status); setFacultySearch(''); setDepartmentFilter('all'); }
  };

  // Blast out end-of-process survey reminders (POST /api/surveys/reminders)
  const handleSurveyBlast = async () => {
    try {
      const res = await api.surveyReminders(currentSemester);
      toast.success(`Survey reminders sent to ${plural(res.data.notified, 'observee')} who have not submitted yet.`);
    } catch (e) { toast.error(e.message); }
  };

  // Manually assign an observer (POST .../select-observer as a committee member)
  const handleManualAssignment = async (signup) => {
    if (!manualObserverId) {
      toast.error('Select a faculty member from the list first.');
      return;
    }
    const observer = professors.find(p => p.professor_id === manualObserverId);
    if (!observer) {
      toast.error('That observer was not found in the database.');
      return;
    }
    const ok = await run(() => api.selectObserver(signup.id, observer.email),
      `${observer.name} is assigned to observe ${signup.observeeName}. They can now schedule the date.`);
    if (ok) { setExpandedSignup(null); setManualObserverId(''); }
    await refresh();
  };

  // Template Editor: every change writes the selected term's template file (PUT /api/evaluation-cycles/:term/template)
  const saveTemplate = async (criteria, message) => {
    try {
      const res = await api.saveTemplate(templateTerm, criteria);
      setEditedTemplate(res.data.criteria);
      setTemplateSource(res.data.source);
      if (message) toast.success(message);
      await refresh();
      return true;
    } catch (e) { toast.error(e.message); return false; }
  };
  const startEditing = (item) => {
    setEditingId(item.id); setEditCriteria(item.criteria); setEditRating(item.ratingScale);
  };
  const saveEdit = async (id) => {
    if (await saveTemplate(editedTemplate.map(item => item.id === id ? { ...item, criteria: editCriteria, ratingScale: editRating } : item), 'Criterion updated.')) setEditingId(null);
  };
  const handleAddCriteria = async () => {
    if (!newCriteria.trim()) { toast.error('Write the criterion first.'); return; }
    if (await saveTemplate([...editedTemplate, { id: `custom-${Date.now()}`, criteria: newCriteria.trim(), ratingScale: newRating }], 'Criterion added.')) setNewCriteria('');
  };
  const handleDeleteCriteria = (item) => {
    if (!window.confirm(`Remove "${item.criteria}" from the ${templateTerm} template?`)) return;
    saveTemplate(editedTemplate.filter(c => c.id !== item.id), 'Criterion removed.');
  };

  // Due status comes from the backend (committee rule: Assistant yearly, Associate/Full every 2 years)
  const allFacultyStatus = professors;
  const dueFaculty = allFacultyStatus.filter(f => f.status === 'Due' || f.status === 'Overdue');
  const departments = [...new Set(allFacultyStatus.map(f => f.department))].sort();
  const searchQuery = facultySearch.trim().toLowerCase();
  const filteredFaculty = allFacultyStatus.filter(f => (
    f.name.toLowerCase().includes(searchQuery)
    && (departmentFilter === 'all' || f.department === departmentFilter)
    && (statusFilter === 'all'
      || (statusFilter === 'due-overdue' ? f.status === 'Due' || f.status === 'Overdue' : f.status === statusFilter))
  ));
  const clearFacultyFilters = () => { setFacultySearch(''); setDepartmentFilter('all'); setStatusFilter('all'); };
  const exportFacultyCsv = () => {
    if (filteredFaculty.length === 0) return;
    const blob = new Blob([createFacultyCsv(filteredFaculty)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `faculty-${currentSemester.toLowerCase().replaceAll(' ', '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Admin releases the list of potential observers (POST .../release-observer-list)
  const handleReleaseList = async (signup) => {
    await run(() => api.releaseList(signup.id), `List released to ${signup.observeeName}.`);
    await refresh();
  };

  // Re-run the matching engine for one signup (POST .../generate-observer-list)
  const handleRegenerateList = async (signup) => {
    try {
      const res = await api.generateList(signup.id);
      toast.success(`Observer list regenerated: ${plural(res.data.candidates.length, 'candidate')} (${res.data.flag.replaceAll('_', ' ').toLowerCase()}).`);
    } catch (e) { toast.error(e.message); }
    await refresh();
  };

  const handleSaveDeadlines = async () => {
    await run(() => api.updateCycle(currentSemester, {
      signup_deadline: deadlineForm.signup, signup_deadline_time: deadlineForm.signupTime || null,
      observation_deadline: deadlineForm.observation, observation_deadline_time: deadlineForm.observationTime || null,
      feedback_deadline: deadlineForm.survey, feedback_deadline_time: deadlineForm.surveyTime || null,
    }),
      'Deadlines updated. Faculty have been notified.');
    await refresh();
  };

  // Signup monitor rows: the confirmed observation is matched by observation id (one per sign-up),
  // and rows that need the committee come first.
  const signupRows = (globalSignups || []).map(signup => {
    const obs = (globalObservations || []).find(o => o.id === signup.id);
    const flagged = signup.matchFlag === 'NO ELIGIBLE OBSERVER' || signup.matchFlag === 'INSUFFICIENT OBSERVERS';
    return { signup, obs, flagged, needsAction: !obs && (flagged || !signup.listReleased) };
  }).sort((a, b) => Number(b.needsAction) - Number(a.needsAction));
  const needsActionCount = signupRows.filter(r => r.needsAction).length;
  const SIGNUP_FILTERS = [
    ['all', 'All', () => true],
    ['completed', 'Completed', (r) => r.obs?.status === 'Completed'],
    ['progress', 'In progress', (r) => !r.needsAction && !(r.obs && (r.obs.status === 'Completed'))],
    ['needs', 'Needs action', (r) => r.needsAction],
  ];
  const shownSignups = signupRows.filter(SIGNUP_FILTERS.find(f => f[0] === signupFilter)[2]);
  const flagCount = (flag) => (globalSignups || []).filter(s => s.matchFlag === flag).length;

  const nav = [
    { id: 'metrics', label: 'Metrics', icon: 'metrics' },
    { id: 'faculty', label: 'Faculty', icon: 'users' },
    { id: 'reports', label: 'Reports', icon: 'report' },
    { id: 'signups', label: 'Signups', icon: 'signups', count: needsActionCount },
    { id: 'deadlines', label: 'Deadlines', icon: 'calendar' },
    { id: 'template', label: 'Template', icon: 'sliders' },
    { id: 'evaluations', label: 'Evaluations', icon: 'form' },
    { id: 'surveys', label: 'Surveys', icon: 'message' },
  ];

  const obsDays = daysUntil(globalDeadlines?.observation);
  const deadlineStatus = (dateStr, timeStr) => {
    const days = daysUntil(dateStr);
    if (days == null) return <Badge>Not set</Badge>;
    if (isPastDeadline(dateStr, timeStr)) return <Badge>Closed</Badge>;
    if (days === 0) return <Badge tone="warn">Today</Badge>;
    return <Badge tone={days <= 14 ? 'warn' : 'info'}>{plural(days, 'day')} left</Badge>;
  };
  const [title, subtitle] = ADMIN_TITLES[activeTab];

  return (
    <AppShell label="Committee sections" items={nav} active={activeTab} onSelect={goTo} onLogout={onLogout}>
      <PageHeader eyebrow={`Assessment Committee · ${currentSemester}`} title={title} subtitle={activeTab === 'evaluations' ? `${plural(globalEvaluations.length, 'form')} submitted this cycle` : subtitle}>
        {obsDays != null && (
          <span className="countdown-pill">
            <Icon name="clock" size={16} />
            {obsDays > 0 ? <><strong>{obsDays}d</strong> until observations close</> : obsDays === 0 ? 'Observations close today' : 'Observation period has ended'}
          </span>
        )}
        <UserMenu name={user.name} initials={initials(user.name)} role="Assessment Committee" />
      </PageHeader>

      {data.error && <Notice tone="bad" title="Could not refresh data" className="section-gap">{data.error}</Notice>}

      {activeTab === 'metrics' && (
        <AdminKpiDashboard
          signups={globalSignups}
          requests={globalRequests}
          observations={globalObservations}
          surveySubmissions={surveySubmissions}
          deadlines={globalDeadlines}
          professors={professors}
          courses={courses}
          onNavigate={goTo}
        />
      )}

      {activeTab === 'reports' && <CommitteeReports term={currentSemester} refreshKey={reportsVersion} />}

      {activeTab === 'faculty' && (
        <>
          <div className="filter-bar" role="search" aria-label="Faculty search and filters">
            <label className="field field-grow-2" htmlFor="faculty-search">
              Professor name
              <input id="faculty-search" type="search" placeholder="Search professors" value={facultySearch} onChange={e => setFacultySearch(e.target.value)} />
            </label>
            <label className="field field-grow" htmlFor="faculty-department">
              Department
              <select id="faculty-department" value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}>
                <option value="all">All departments</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="field field-grow" htmlFor="faculty-status">
              Evaluation status
              <select id="faculty-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="due-overdue">Due or overdue</option>
                <option value="all">All statuses</option>
                <option value="Due">Due</option>
                <option value="Overdue">Overdue</option>
                <option value="Not Due">Not due</option>
              </select>
            </label>
            <button type="button" className="btn btn-ghost" onClick={clearFacultyFilters}>Clear</button>
            <button type="button" className="btn btn-primary" onClick={exportFacultyCsv} disabled={filteredFaculty.length === 0}><Icon name="download" size={16} /> Export CSV</button>
          </div>
          <p className="muted section-gap" role="status">
            Showing <span className="mono">{filteredFaculty.length}</span> of {allFacultyStatus.length} professors · <span className="mono">{dueFaculty.length}</span> due or overdue
          </p>
          <Card flush>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Professor</th><th>Level</th><th>Dept</th><th>Last evaluation</th><th>Status</th></tr></thead>
                <tbody>
                  {filteredFaculty.length === 0 && (
                    <tr><td colSpan="5" className="empty-cell">No professors match your search and filters.</td></tr>
                  )}
                  {filteredFaculty.map(f => (
                    <tr key={f.professor_id}>
                      <td className="strong">{f.name}</td>
                      <td>{f.hire_level}</td>
                      <td>{f.department}</td>
                      <td className="mono">{f.last_evaluation || 'None'}</td>
                      <td><DueBadge prof={f} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {activeTab === 'signups' && (
        <>
          <div className="chips section-gap">
            <span className="chip"><strong>{globalSignups.length}</strong> sign-ups</span>
            <span className="chip chip-good"><strong>{flagCount('OK')}</strong> full lists</span>
            <span className="chip chip-warn"><strong>{flagCount('INSUFFICIENT OBSERVERS')}</strong> insufficient</span>
            <span className="chip chip-bad"><strong>{flagCount('NO ELIGIBLE OBSERVER')}</strong> no eligible observer</span>
            <span className="chip"><strong>{globalSignups.filter(s => s.listReleased).length}</strong> lists released</span>
          </div>
          <div className="segmented section-gap" role="tablist" aria-label="Filter sign-ups">
            {SIGNUP_FILTERS.map(([id, label, test]) => (
              <button key={id} type="button" role="tab" aria-selected={signupFilter === id} className={signupFilter === id ? 'active' : ''} onClick={() => { setSignupFilter(id); setExpandedSignup(null); }}>
                {label} <span className="mono">{signupRows.filter(test).length}</span>
              </button>
            ))}
          </div>
          {shownSignups.length === 0 ? (
            <EmptyState icon="signups" title={signupRows.length ? 'Nothing here' : 'No sign-ups yet'}>{signupRows.length ? 'No sign-ups match this filter.' : 'Sign-ups appear here as due faculty choose a course.'}</EmptyState>
          ) : (
            <div className="stack-sm">
              <div className="signup-row signup-head" aria-hidden="true">
                <span>Observee</span>
                <span>Class and day &amp; time</span>
                <span>Status</span>
                <span className="signup-observer">Observer</span>
                <span className="signup-head-more">See more</span>
              </div>
              {shownSignups.map(({ signup, obs, flagged }) => {
                const isOpen = expandedSignup === signup.id;
                const [flagLabel, flagTone] = FLAG[signup.matchFlag] || [signup.matchFlag, 'neutral'];
                const people = signup.eligibleObservers || [];
                return (
                  <div key={signup.id} className={`signup-card${isOpen ? ' open' : ''}`}>
                    <div className="signup-row">
                      <span>
                        <span className="list-title">{signup.observeeName}</span>
                        <span className="list-sub">{plural(signup.matchesCount, 'observer')} matched</span>
                      </span>
                      <span>
                        <span className="mono">{signup.courseCode}-{signup.section}</span>
                        <span className="list-sub">{signup.timing}</span>
                      </span>
                      <span><Badge tone={flagTone}>{flagLabel}</Badge></span>
                      <span className="signup-observer">
                        {obs ? <><span className="signup-observer-name">{obs.observerName}</span><StatusBadge status={obs.status} /></> : <span className="faint">No observer yet</span>}
                      </span>
                      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={isOpen} onClick={() => { setExpandedSignup(isOpen ? null : signup.id); setManualObserverId(''); }}>
                        {isOpen ? 'Hide' : 'Review'}
                      </button>
                    </div>
                    {isOpen && (
                      <div className="signup-detail">
                        <div className="inset stack-sm">
                          <div className="section-label">Generated observer list</div>
                          {people.length === 0 ? (
                            <p className="text-bad">No eligible observers found in the database.</p>
                          ) : people.map(po => (
                            <div key={po.professor_id} className="row-between">
                              <span>{po.name} <span className="faint">· {po.department}</span></span>
                              {po.matchStatus && <Badge tone={{ confirmed: 'good', declined: 'bad', requested: 'warn', accepted: 'info' }[po.matchStatus] || 'neutral'}>{po.matchStatus}</Badge>}
                            </div>
                          ))}
                        </div>
                        <div className="stack-sm">
                          {obs ? (
                            <Notice tone="good" title="Observer confirmed">{obs.observerName} is observing {signup.observeeName} ({obs.status.toLowerCase()}).</Notice>
                          ) : flagged ? (
                            <>
                              <Notice tone="warn" title="This list cannot be released as is">
                                {signup.listReleased ? 'The observee already has this short list. ' : ''}Assign an observer by hand; both people are notified.
                              </Notice>
                              <label className="field" htmlFor={`manual-${signup.id}`}>
                                Assign manually
                                <select id={`manual-${signup.id}`} value={manualObserverId} onChange={(e) => setManualObserverId(e.target.value)}>
                                  <option value="">Select a faculty member</option>
                                  {professors.filter(p => p.professor_id !== signup.observeeId).map(p => (
                                    <option key={p.professor_id} value={p.professor_id}>{p.name} ({p.department}) · {p.username}</option>
                                  ))}
                                </select>
                              </label>
                              <div className="row">
                                <button type="button" className="btn btn-primary" onClick={() => handleManualAssignment(signup)}>Assign and confirm pair</button>
                                {!signup.listReleased && <button type="button" className="btn btn-ghost" onClick={() => handleRegenerateList(signup)}><Icon name="refresh" size={16} /> Regenerate</button>}
                              </div>
                            </>
                          ) : signup.listReleased ? (
                            <Notice tone="good" title="List released">{signup.observeeName} can send requests from this list.</Notice>
                          ) : (
                            <>
                              <p className="muted">Full list. Releasing it notifies {signup.observeeName} so they can send requests.</p>
                              <div className="row">
                                <button type="button" className="btn btn-primary" onClick={() => handleReleaseList(signup)}><Icon name="send" size={16} /> Release and notify</button>
                                <button type="button" className="btn btn-ghost" onClick={() => handleRegenerateList(signup)}><Icon name="refresh" size={16} /> Regenerate</button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {activeTab === 'deadlines' && (
        <>
          <div className="grid grid-260 deadline-grid section-gap-lg">
            <DeadlineCard
              id="deadline-signup" title="Sign-up deadline"
              date={deadlineForm.signup} time={deadlineForm.signupTime}
              onChange={({ date = deadlineForm.signup, time = deadlineForm.signupTime }) => setDeadlineForm({ ...deadlineForm, signup: date, signupTime: time })}
              status={deadlineStatus(deadlineForm.signup, deadlineForm.signupTime)}
              hint="Professors can no longer sign up after this."
            />
            <DeadlineCard
              id="deadline-observation" title="Observation period ends"
              className={obsDays != null && obsDays >= 0 && obsDays <= 14 ? 'card-warn' : ''}
              date={deadlineForm.observation} time={deadlineForm.observationTime}
              onChange={({ date = deadlineForm.observation, time = deadlineForm.observationTime }) => setDeadlineForm({ ...deadlineForm, observation: date, observationTime: time })}
              status={deadlineStatus(deadlineForm.observation, deadlineForm.observationTime)}
              hint="Unconfirmed observations count as missing after this. Survey reminders unlock."
            />
            <DeadlineCard
              id="deadline-survey" title="Survey hand-off"
              date={deadlineForm.survey} time={deadlineForm.surveyTime}
              onChange={({ date = deadlineForm.survey, time = deadlineForm.surveyTime }) => setDeadlineForm({ ...deadlineForm, survey: date, surveyTime: time })}
              status={deadlineStatus(deadlineForm.survey, deadlineForm.surveyTime)}
            />
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-lg" onClick={handleSaveDeadlines}>Update deadlines</button>
            <span className="muted">Every professor in the {currentSemester} cycle gets a notification.</span>
          </div>
        </>
      )}

      {activeTab === 'template' && (
        <div className="stack">
          <div className="template-term-row">
            <label className="template-term-label" htmlFor="template-term">
              <strong>Template for</strong>
              <select id="template-term" className="select" value={templateTerm} onChange={e => { setTemplateTerm(e.target.value); setEditingId(null); }}>
                {termOptions.map(t => <option key={t} value={t}>{t}{t === currentSemester ? ' (current)' : ''}</option>)}
              </select>
            </label>
            <span className="muted">
              {templateTerm === currentSemester ? 'Changes apply to the form observers are using this cycle.' : `Saved for ${templateTerm}. The ${currentSemester} form in use stays the same.`}
              {templateSource === 'default.json' ? ' No file for this term yet: showing the default template; saving creates it.' : ''}
            </span>
          </div>

          <div className="card card-dashed">
            <div className="row align-end">
              <label className="field field-grow-3" htmlFor="new-criterion">
                Add a criterion
                <input id="new-criterion" type="text" value={newCriteria} onChange={(e) => setNewCriteria(e.target.value)} placeholder="e.g., Uses multimedia effectively" />
              </label>
              <label className="field field-grow" htmlFor="new-criterion-scale">
                Rating scale
                <select id="new-criterion-scale" value={newRating} onChange={(e) => setNewRating(e.target.value)}>
                  {RATING_SCALES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn-accent" onClick={handleAddCriteria}><Icon name="plus" size={16} /> Add</button>
            </div>
          </div>
          <div>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => saveTemplate(editedTemplate, `Template saved and published for ${templateTerm}.`)}>Save and publish for {templateTerm}</button>
          </div>

          {editedTemplate.length === 0 && <EmptyState icon="sliders" title="No criteria yet">Add the first criterion above.</EmptyState>}
          {editedTemplate.map((item, index) => (
            <div key={item.id} className="card">
              {editingId === item.id ? (
                <div className="row align-end">
                  <label className="field field-grow-3">
                    Criterion
                    <input type="text" value={editCriteria} onChange={(e) => setEditCriteria(e.target.value)} />
                  </label>
                  <label className="field field-grow">
                    Rating scale
                    <select value={editRating} onChange={(e) => setEditRating(e.target.value)}>
                      {RATING_SCALES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn btn-primary" onClick={() => saveEdit(item.id)}>Save</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <div className="criterion-row">
                  <span className="criterion-num">{String(index + 1).padStart(2, '0')}</span>
                  <span className="stack-sm">
                    <strong>{item.criteria}</strong>
                    <span><Badge>{item.ratingScale}</Badge></span>
                  </span>
                  <span className="row">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEditing(item)}><Icon name="edit" size={15} /> Edit</button>
                    <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => handleDeleteCriteria(item)}><Icon name="trash" size={15} /> Remove</button>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'evaluations' && (
        viewingEvaluation ? (
          <EvaluationDetail evaluation={viewingEvaluation} evaluationTemplate={evaluationTemplate} onBack={() => setViewingEvaluation(null)} backLabel="All evaluations" />
        ) : !globalEvaluations || globalEvaluations.length === 0 ? (
          <EmptyState icon="form" title="No evaluations submitted yet">Forms appear here as observers submit them.</EmptyState>
        ) : (
          <div className="grid grid-300">
            {globalEvaluations.map(ev => (
              <Card as="article" key={ev.id} className="stack-sm">
                <div className="row-between"><span className="mono text-good">{ev.courseCode}</span><span className="faint">{formatDate(ev.dateSubmitted)}</span></div>
                <div className="card-title">{ev.observeeName}</div>
                <div className="muted">Observed by {ev.observerName}</div>
                <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewingEvaluation(ev)}>Open form</button></div>
              </Card>
            ))}
          </div>
        )
      )}

      {activeTab === 'surveys' && (
        <AdminSurveyResults
          surveyResponses={surveyResponses}
          submittedCount={submittedCount}
          totalCount={totalProfessors}
          onSendReminders={handleSurveyBlast}
          canSendReminders={isPastObservationDeadline}
          remindersHint={isPastObservationDeadline
            ? 'Notifies observees who have not submitted yet.'
            : `Available after the observation period ends${globalDeadlines?.observation ? ` (${shortDeadline(globalDeadlines.observation, globalDeadlines.observationTime)})` : ''}.`}
        />
      )}
    </AppShell>
  );
}

/* =========================================
   PROFESSOR PORTAL
========================================= */
const PROF_TITLES = {
  home: ['', 'Where your evaluation cycle stands'],
  'observee-status': ['Observee status', 'Your observation and the colleagues you asked'],
  'observer-duties': ['My duties', 'Requests to observe colleagues and your appointments'],
  'live-evaluation': ['', ''],
  'my-evaluations': ['My evaluations', 'Forms you submitted and forms about your teaching'],
  survey: ['End-of-process survey', 'Anonymous feedback for the Assessment Committee'],
  notifications: ['Notifications', 'Updates from the evaluation workflow'],
};

function ProfessorDashboard({ user, onLogout, data, globalRequests, hasSubmittedSurvey, onSurveySubmit, globalSignups, globalObservations, evaluationTemplate, globalDeadlines, globalNotifications, globalEvaluations, evaluationDrafts }) {
  const { term: currentSemester, refresh } = data;
  const [activeTab, setActiveTab] = useState('home');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [activeEvaluationTarget, setActiveEvaluationTarget] = useState(null);
  // Answers for the evaluation form currently open: { [criteriaId]: { rating, notes } }
  const [evalAnswers, setEvalAnswers] = useState({});
  // Submitted evaluation currently opened (read-only) on the "My Evaluations" tab
  const [viewingEvaluation, setViewingEvaluation] = useState(null);
  const [notifTab, setNotifTab] = useState('inbox');
  const [deferReason, setDeferReason] = useState('');
  const [showDeferForm, setShowDeferForm] = useState(false);

  const goTo = (id) => { setActiveTab(id); setViewingEvaluation(null); };

  // "Could Not Complete Cycle": PATCH .../status { status: 'deferred', reason } (the committee is notified)
  const handleDeferObservation = async (obsId) => {
    if (!deferReason.trim()) {
      toast.error('Please give a reason why the observation could not be completed.');
      return;
    }
    const ok = await run(() => api.setStatus(obsId, 'deferred', deferReason.trim()),
      'Reason sent to the Assessment Committee. Your cycle status is updated.');
    if (ok) { setShowDeferForm(false); setDeferReason(''); }
    await refresh();
  };

  // Open the evaluation form, restoring any saved progress for this observation
  const openEvaluation = (obs) => {
    setActiveEvaluationTarget(obs);
    setEvalAnswers(evaluationDrafts?.[obs.id]?.answers || {});
    setActiveTab('live-evaluation');
  };

  const updateEvalAnswer = (criteriaId, field, value) => {
    setEvalAnswers(prev => ({ ...prev, [criteriaId]: { ...prev[criteriaId], [field]: value } }));
  };

  const closeEvaluation = () => {
    setActiveEvaluationTarget(null);
    setEvalAnswers({});
    setActiveTab('observer-duties');
  };

  // Save & Return: keep progress (saved on the server) without requiring every field to be filled in
  const handleSaveDraft = async () => {
    const ok = await run(() => api.form(activeEvaluationTarget.id, { ratings: evalAnswers, draft: true }),
      'Progress saved. You can finish this evaluation later.');
    if (ok) { await refresh(); closeEvaluation(); }
  };

  // Cancel & Return: discard changes made since the last save (asks first if there are any)
  const handleCancelEvaluation = () => {
    const saved = evaluationDrafts?.[activeEvaluationTarget.id]?.answers || {};
    const hasUnsavedChanges = JSON.stringify(saved) !== JSON.stringify(evalAnswers);
    if (hasUnsavedChanges && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    closeEvaluation();
  };

  // Due status is calculated by the backend (GET /api/professors includes evaluation_status)
  const myStatus = (data.professors || []).find(p => p.professor_id === user?.professor_id) || { status: 'Unknown', next_eval: 'TBD' };
  const isDue = myStatus.status === 'Due' || myStatus.status === 'Overdue';
  const myCourses = (data.courses || []).filter(c => c.instructor_id === user?.professor_id);
  const mySignup = (globalSignups || []).find(s => s.observeeId === user?.professor_id);
  const myConfirmedObservation = (globalObservations || []).find(o => o.observeeId === user?.professor_id);
  // Sign-up closes at the deadline's time, or the end of the deadline day (same rule the backend enforces)
  const isPastSignupDeadline = isPastDeadline(globalDeadlines?.signup, globalDeadlines?.signupTime);

  const isPastObservationDeadline = isPastDeadline(globalDeadlines?.observation, globalDeadlines?.observationTime);

  // Once the admin-set survey deadline passes, the survey tab only shows a "closed" notice
  const isSurveyClosed = surveyIsClosed(globalDeadlines?.survey, globalDeadlines?.surveyTime);
  const surveyDeadlineLabel = globalDeadlines?.survey ? formatDeadline(globalDeadlines.survey, globalDeadlines.surveyTime) : '';

  const dynamicSystemNotifs = [];
  if (isDue && !mySignup) {
    dynamicSystemNotifs.push({
      id: 'sys-due', recipientId: user?.professor_id,
      message: `You are ${myStatus.status.toLowerCase()} for an evaluation this cycle. Please sign up a course.`,
      read: false, timestamp: new Date().toLocaleDateString(), createdAt: new Date().toISOString()
    });
  }

  const myNotifications = [...dynamicSystemNotifs, ...((globalNotifications || []).filter(n => n.recipientId === user?.professor_id))];
  const unreadCount = myNotifications.filter(n => !n.read).length;

  // Show the newest unread notification as a toast when new ones arrive (once per notification)
  const lastToasted = useRef(null);
  useEffect(() => {
    const unread = myNotifications.filter(n => !n.read);
    const latest = unread[unread.length - 1];
    if (latest && lastToasted.current !== latest.id) {
      lastToasted.current = latest.id;
      toast.info(latest.message, { title: `New notification (${unread.length} unread).`, duration: 6000, onClick: () => goTo('notifications') });
    }
  }, [globalNotifications?.length]);

  // Pair confirmation: PATCH .../form { observer_signed | observee_signed }. Completed once both have confirmed.
  const confirmObservation = async (obsId, side) => {
    // VALIDATION: the observer can't mark the observation complete until the evaluation form is submitted
    if (side === 'observer' && !(globalEvaluations || []).some(e => e.observationId === obsId)) {
      toast.error('Submit the evaluation form before marking this observation completed.');
      return false;
    }
    const ok = await run(() => api.form(obsId, side === 'observer' ? { observer_signed: true } : { observee_signed: true }),
      side === 'observer' ? 'Observation confirmed. It is marked completed once the observee also confirms.' : 'Thanks. Your confirmation is recorded.');
    await refresh();
    return ok;
  };

  // POST .../observer-requests
  const handleSendRequest = async (observer) => {
    await run(() => api.sendRequests(mySignup.id, [observer.professor_id]), `Request sent to ${observer.name}.`);
    await refresh();
  };

  // PATCH /api/observer-matches/.../:observer_email/response
  const handleObserverAction = async (reqId, action) => {
    const req = globalRequests.find(r => r.id === reqId);
    if (!req) return;
    await run(() => api.respond(req.observationId, req.observerId, action === 'Accepted' ? 'accept' : 'decline'),
      action === 'Accepted' ? `You accepted ${req.observeeName}'s request.` : `You declined ${req.observeeName}'s request.`);
    await refresh();
  };

  // POST .../select-observer: the other requests are cancelled and those observers notified by the server
  const handleFinalConfirm = async (acceptedRequest) => {
    await run(() => api.selectObserver(acceptedRequest.observationId, acceptedRequest.observerId),
      `${acceptedRequest.observerName} is confirmed. Next, pick the observation date.`);
    await refresh();
  };

  const handleScheduleDate = async (obsId, dateStr, timeStr) => {
    const obs = (globalObservations || []).find(o => o.id === obsId);
    if (!obs) return;

    // VALIDATION: date must be a day the class meets and time must be the class meeting time
    const slotError = validateObservationSlot(dateStr, timeStr, obs.timing, {
      minDate: todayLocalISO(),
      maxDate: globalDeadlines?.observation || undefined,
    });
    if (slotError) { toast.error(slotError); return; }

    // PATCH /api/observations/:course_code/:section_number/:term (the server re-validates and notifies both)
    await run(() => api.schedule(obsId, dateStr, timeStr.split('-')[0].trim()),
      'Date confirmed. You and your observer have been notified.');
    await refresh();
  };

  // POST /api/observations: the backend also generates the observer list right away
  const handleSignup = async () => {
    if (!selectedCourseId) { toast.error('Select a course first.'); return; }
    const course = myCourses.find(c => c.section_id.toString() === selectedCourseId);
    const ok = await run(() => api.signUp(course.course_code, course.section, course.term),
      "You're signed up. Your observer list appears on Observee status once it's released.");
    await refresh();
    if (ok) setActiveTab('observee-status');
  };

  // PATCH .../missed
  const reportMissedObservation = async (obsId) => {
    if (!window.confirm('Report that this observation did NOT take place?')) return;
    await run(() => api.reportMissed(obsId), 'Reported to the Assessment Committee.');
    await refresh();
  };

  const mySentRequests = (globalRequests || []).filter(req => req.observeeId === user?.professor_id);
  const myIncomingDuties = (globalRequests || []).filter(req => req.observerId === user?.professor_id);
  const pendingDuties = myIncomingDuties.filter(r => r.status === 'Pending');
  const pastDuties = myIncomingDuties.filter(r => r.status !== 'Pending');
  const myAssignedObservations = (globalObservations || []).filter(o => o.observerId === user?.professor_id);
  // Evaluations this professor submitted as an observer, and evaluations submitted about them as an observee
  const mySubmittedEvaluations = (globalEvaluations || []).filter(ev => ev.observerId === user?.professor_id);
  const evaluationsOfMe = (globalEvaluations || []).filter(ev => {
    const observeeId = ev.observeeId ?? (globalObservations || []).find(o => o.id === ev.observationId)?.observeeId;
    return observeeId === user?.professor_id;
  });

  // ----- My cycle: where the professor is in the 7-step process -----
  const obs = myConfirmedObservation;
  const obsBad = obs && (obs.status === 'Missed' || obs.status === 'Deferred / Rolled Over');
  const stepDefs = [
    ['Sign up', mySignup ? `${mySignup.courseCode} in the pool` : isDue ? `Closes ${shortDeadline(globalDeadlines?.signup, globalDeadlines?.signupTime)}` : 'Not due this cycle', Boolean(mySignup)],
    ['List released', mySignup?.listReleased ? plural((mySignup.eligibleObservers || []).length, 'eligible colleague') : 'By the committee', Boolean(obs) || Boolean(mySignup?.listReleased)],
    ['Requests sent', mySentRequests.length ? plural(mySentRequests.length, 'request') : 'Ask colleagues', Boolean(obs) || mySentRequests.length > 0],
    ['Observer confirmed', obs ? obs.observerName : 'Confirm one who accepts', Boolean(obs)],
    ['Date set', obs?.scheduledDate ? `${shortDate(obs.scheduledDate)}${obs.scheduledTime ? ` · ${obs.scheduledTime}` : ''}` : 'Pick a class day', Boolean(obs?.scheduledDate)],
    ['Confirm observation', obsBad ? obs.status : 'Both of you, after class', obs?.status === 'Completed'],
    ['End survey', hasSubmittedSurvey ? 'Submitted' : surveyDeadlineLabel ? `Closes ${shortDate(globalDeadlines.survey)}` : 'After observation', hasSubmittedSurvey],
  ];
  const currentStep = stepDefs.findIndex(s => !s[2]);
  const steps = stepDefs.map(([label, detail, done], i) => ({
    label, detail,
    state: done ? 'done' : i === currentStep ? (i === 5 && obsBad ? 'bad' : 'current') : 'upcoming',
  }));
  const doneCount = stepDefs.filter(s => s[2]).length;
  const draftFor = myAssignedObservations.find(o => evaluationDrafts?.[o.id] && !(globalEvaluations || []).some(e => e.observationId === o.id));
  const activeCriteria = (evaluationTemplate || []).filter(item => !item.effective || item.effective === currentSemester);
  const draftAnswered = draftFor ? Object.values(evaluationDrafts[draftFor.id].answers || {}).filter(a => a?.rating || a?.notes).length : 0;

  // The hero card: one clear next step
  let hero;
  if (!isDue && !mySignup) {
    hero = { tone: 'neutral', title: 'You are not due for an evaluation this cycle', text: `Next evaluation: ${myStatus.next_eval}. Colleagues may still ask you to observe them.` };
  } else if (!mySignup && isPastSignupDeadline) {
    hero = { tone: 'bad', title: 'Sign-up closed', text: `Sign-up for ${currentSemester} closed on ${shortDeadline(globalDeadlines?.signup, globalDeadlines?.signupTime)}. Please contact the Assessment Committee.` };
  } else if (!mySignup) {
    hero = { tone: 'warn', signup: true, title: 'Sign up a course to be observed', text: `You are ${myStatus.status.toLowerCase()} this cycle. Sign-up closes ${shortDeadline(globalDeadlines?.signup, globalDeadlines?.signupTime)}.` };
  } else if (!obs) {
    const accepted = mySentRequests.find(r => r.status === 'Accepted');
    if (!isPastSignupDeadline) hero = { tone: 'info', title: 'Your observer list is on its way', text: `Eligible colleagues appear after sign-up closes on ${shortDeadline(globalDeadlines?.signup, globalDeadlines?.signupTime)}.` };
    else if (!mySignup.listReleased) hero = { tone: 'info', title: 'Waiting for the committee', text: 'The Assessment Committee is reviewing your list of potential observers. You will be notified.' };
    else if (accepted) hero = { tone: 'good', title: `${accepted.observerName} accepted`, text: 'Confirm them as your observer to continue.', action: ['Confirm my observer', 'observee-status'] };
    else if (mySentRequests.some(r => r.status === 'Pending')) hero = { tone: 'info', title: 'Waiting for replies', text: `${plural(mySentRequests.filter(r => r.status === 'Pending').length, 'request')} pending. You can ask more colleagues meanwhile.`, action: ['View requests', 'observee-status'] };
    else hero = { tone: 'warn', title: 'Ask colleagues to observe you', text: `Your list of ${plural((mySignup.eligibleObservers || []).length, 'eligible colleague')} is ready.`, action: ['Choose observers', 'observee-status'] };
  } else if (obs.status === 'Pending Scheduling') {
    hero = { tone: 'warn', title: `Pick a date with ${obs.observerName}`, text: `Choose a day your class meets, before ${shortDate(globalDeadlines?.observation)}.`, action: ['Pick a date', 'observee-status'] };
  } else if (obs.status === 'Scheduled' || obs.status === 'Awaiting Confirmation') {
    const days = daysUntil(obs.scheduledDate);
    if (obs.observeeConfirmed) hero = { tone: 'info', title: `Waiting for ${obs.observerName} to confirm`, text: 'You confirmed the observation. It completes once your observer confirms too.' };
    else if (days != null && days > 0) hero = { tone: 'info', countdown: days, title: `${days === 1 ? 'day' : 'days'} until you are observed`, text: `${shortDate(obs.scheduledDate)}${obs.scheduledTime ? ` at ${obs.scheduledTime}` : ''} · ${obs.courseCode} with ${obs.observerName}`, action: ['View my observation', 'observee-status'] };
    else hero = { tone: 'warn', title: 'Confirm the observation', text: `Let the committee know ${obs.observerName} observed your class.`, action: ['Confirm now', 'observee-status'] };
  } else if (obs.status === 'Completed') {
    if (hasSubmittedSurvey) hero = { tone: 'good', title: `You're done for ${currentSemester}`, text: 'Your observation is complete and your survey is in. Thank you.' };
    else if (isSurveyClosed) hero = { tone: 'neutral', title: 'Observation complete', text: `The survey deadline (${surveyDeadlineLabel}) has passed.` };
    else hero = { tone: 'good', title: 'Observation complete', text: 'One last step: a short anonymous survey about the process.', action: ['Take the survey', 'survey'] };
  } else if (obs.status === 'Missed') {
    hero = { tone: 'bad', title: 'Observation reported as not held', text: `${obs.missedReportedBy ? `${obs.missedReportedBy} reported` : 'It was reported'} that the observation did not take place. Please contact the Assessment Committee.` };
  } else {
    hero = { tone: 'warn', title: 'Observation deferred', text: 'The Assessment Committee has your reason and will follow up.' };
  }

  const nav = [
    { id: 'home', label: 'My cycle', icon: 'home' },
    { id: 'observee-status', label: 'Observee', icon: 'userCheck' },
    { id: 'observer-duties', label: 'Duties', icon: 'signups', count: pendingDuties.length },
    { id: 'my-evaluations', label: 'Evaluations', icon: 'form' },
    { id: 'survey', label: 'Survey', icon: 'message' },
    { id: 'notifications', label: 'Inbox', icon: 'bell', count: unreadCount },
  ];
  const [titleText, subtitleText] = PROF_TITLES[activeTab] || ['', ''];
  const firstName = (user?.name || '').split(' ').filter(p => !/^(dr|prof)\.?$/i.test(p))[0] || '';
  const title = activeTab === 'home' ? `Hi, ${firstName}` : activeTab === 'live-evaluation' && activeEvaluationTarget ? `Evaluating ${activeEvaluationTarget.observeeName}` : titleText;
  const subtitle = activeTab === 'live-evaluation' && activeEvaluationTarget
    ? `${activeEvaluationTarget.courseCode} · ${activeEvaluationTarget.timing}${activeEvaluationTarget.scheduledDate ? ` · ${shortDate(activeEvaluationTarget.scheduledDate)}` : ''}`
    : activeTab === 'home' ? `Where your ${currentSemester} evaluation stands` : subtitleText;

  const answeredCount = activeCriteria.filter(item => evalAnswers[item.id]?.rating || (item.ratingScale.includes('Text') && evalAnswers[item.id]?.notes)).length;
  const inbox = myNotifications.filter(n => !n.read).slice().reverse();
  const archived = myNotifications.filter(n => n.read).slice().reverse();

  return (
    <AppShell label="Professor sections" items={nav} active={activeTab === 'live-evaluation' ? 'observer-duties' : activeTab} onSelect={goTo} onLogout={onLogout}>
      <PageHeader eyebrow={`Professor portal · ${currentSemester}`} title={title} subtitle={subtitle}>
        {/* First + last name initials (e.g. "Dr. Alice Smith" -> "AS"); click for account menu + theme switch */}
        <UserMenu name={user?.name || ''} initials={initials(user?.name)} role="Professor" />
      </PageHeader>

      {data.error && <Notice tone="bad" title="Could not refresh data" className="section-gap">{data.error}</Notice>}

      {/* ---------- MY CYCLE ---------- */}
      {activeTab === 'home' && (
        <div className="stack">
          <section className="card card-lg hero">
            <div>
              <DueBadge prof={myStatus} />
              {hero.countdown != null ? (
                <div className="hero-count"><span className="num">{hero.countdown}</span><span>{hero.title}</span></div>
              ) : (
                <h2 className={`hero-title text-${hero.tone === 'neutral' ? 'neutral' : hero.tone}`}>{hero.title}</h2>
              )}
              <p className="muted">{hero.text}</p>
              {hero.signup && (
                <div className="row align-end section-gap" >
                  <label className="field field-grow-2" htmlFor="signup-course">
                    Course to be observed
                    <select id="signup-course" value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
                      <option value="">Choose a course</option>
                      {myCourses.map(c => (
                        <option key={c.section_id} value={c.section_id}>{c.course_code} Sec {c.section} ({c.timing})</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={handleSignup} className="btn btn-primary">Submit and enter observer pool</button>
                </div>
              )}
            </div>
            <div className="hero-actions">
              {hero.action && <button type="button" className="btn btn-primary btn-lg" onClick={() => goTo(hero.action[1])}>{hero.action[0]}</button>}
              {pendingDuties.length > 0 && (
                <button type="button" className="btn btn-secondary btn-lg" onClick={() => goTo('observer-duties')}>
                  {pendingDuties.length === 1 ? '1 colleague needs your answer' : `${pendingDuties.length} colleagues need your answer`}
                </button>
              )}
            </div>
          </section>

          <section className="card card-lg">
            <div className="card-head"><h2 className="card-title">Your cycle</h2><span className="mono muted">{doneCount}/{steps.length}</span></div>
            <ol className="steps">
              {steps.map((s, i) => (
                <li key={s.label} className={`step ${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
                  <span className="step-dot">{s.state === 'done' ? <Icon name="check" size={15} strokeWidth={2.4} /> : i + 1}</span>
                  <span className="step-label">{s.label}</span>
                  <span className="step-detail">{s.detail}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="grid grid-260">
            <div className="card"><div className="faint">Last evaluated</div><div className="big-number">{myStatus.last_evaluation || 'No record'}</div></div>
            <div className="card"><div className="faint">{mySignup ? 'Course observed' : 'Sign-up deadline'}</div><div className="big-number">{mySignup ? mySignup.courseCode : shortDate(globalDeadlines?.signup) || 'TBD'}</div></div>
            {draftFor && (
              <div className="card stack-sm">
                <div className="faint">Your draft for {draftFor.observeeName}</div>
                <div className="big-number text-warn">{draftAnswered}/{activeCriteria.length} <span className="faint">answered</span></div>
                <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => openEvaluation(draftFor)}>Continue evaluation</button></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- OBSERVEE STATUS ---------- */}
      {activeTab === 'observee-status' && (
        myConfirmedObservation ? (
          <div className="grid grid-340">
            <section className="card card-lg stack">
              <div className="row">
                <div className="avatar avatar-lg">{initials(myConfirmedObservation.observerName)}</div>
                <div className="grow">
                  <div className="card-title">{myConfirmedObservation.observerName}</div>
                  <div className="muted">Your confirmed observer</div>
                </div>
                <span className="push-right"><StatusBadge status={myConfirmedObservation.status} /></span>
              </div>
              <div className="grid grid-200">
                <div className="info-tile"><div className="label">Date</div><div className="value">{myConfirmedObservation.scheduledDate ? `${shortDate(myConfirmedObservation.scheduledDate)}${myConfirmedObservation.scheduledTime ? ` · ${myConfirmedObservation.scheduledTime}` : ''}` : 'Not set yet'}</div></div>
                <div className="info-tile"><div className="label">Course</div><div className="value">{myConfirmedObservation.courseCode}</div><div className="faint">{myConfirmedObservation.timing}</div></div>
              </div>

              {myConfirmedObservation.status === 'Pending Scheduling' && (
                <ScheduleObservationForm
                  observation={myConfirmedObservation}
                  observationDeadline={globalDeadlines?.observation}
                  onSchedule={handleScheduleDate}
                />
              )}

              {(myConfirmedObservation.status === 'Scheduled' || myConfirmedObservation.status === 'Awaiting Confirmation') && (
                <>
                  <div className="grid grid-200">
                    <div className={`confirm-tile${myConfirmedObservation.observerConfirmed ? ' done' : ''}`}><span className="confirm-dot" />Observer {myConfirmedObservation.observerConfirmed ? 'confirmed' : 'has not confirmed'}</div>
                    <div className={`confirm-tile${myConfirmedObservation.observeeConfirmed ? ' done' : ''}`}><span className="confirm-dot" />You {myConfirmedObservation.observeeConfirmed ? 'confirmed' : 'have not confirmed'}</div>
                  </div>
                  {!myConfirmedObservation.observeeConfirmed && (
                    <>
                      <div className="row">
                        <button type="button" className="btn btn-primary" onClick={() => confirmObservation(myConfirmedObservation.id, 'observee')}>I was observed</button>
                        <button type="button" className="btn btn-ghost" aria-expanded={showDeferForm} onClick={() => setShowDeferForm(!showDeferForm)}>
                          {showDeferForm ? 'Cancel' : 'Could not complete cycle'}
                        </button>
                      </div>
                      {showDeferForm && (
                        <div className="card card-warn stack-sm">
                          <label className="field" htmlFor="defer-reason">
                            <span className="text-warn">Reason for incompletion or rollover</span>
                            <textarea id="defer-reason" rows="3" value={deferReason} onChange={(e) => setDeferReason(e.target.value)} placeholder="e.g., extended medical leave or scheduling conflicts prevented this observation" />
                          </label>
                          <div><button type="button" className="btn btn-danger" onClick={() => handleDeferObservation(myConfirmedObservation.id)}>Submit reason to committee</button></div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {myConfirmedObservation.status === 'Deferred / Rolled Over' && (
                <Notice tone="warn" title="Deferred / rolled over">
                  Reason submitted: "{myConfirmedObservation.deferralReason}". The Assessment Committee has been notified.
                </Notice>
              )}
              {myConfirmedObservation.status === 'Missed' && (
                <Notice tone="bad" title="Observation not held">
                  This observation was reported as not held{myConfirmedObservation.missedReportedBy ? ` by ${myConfirmedObservation.missedReportedBy}` : ''}. Please contact the Assessment Committee.
                </Notice>
              )}
              {myConfirmedObservation.status === 'Completed' && (
                <Notice tone="good" title="Observation completed">
                  You and your observer both confirmed the observation.
                  {isSurveyClosed ? ` The survey deadline (${surveyDeadlineLabel}) has passed.` : ' Please take the final survey.'}
                  {!isSurveyClosed && !hasSubmittedSurvey && <div className="section-gap" />}
                  {!isSurveyClosed && !hasSubmittedSurvey && <button type="button" className="btn btn-primary btn-sm" onClick={() => goTo('survey')}>Take survey</button>}
                </Notice>
              )}
            </section>
            <Card title="Requests you sent" sub={mySignup ? `From ${plural((mySignup.eligibleObservers || []).length, 'eligible colleague')}` : undefined}>
              {mySentRequests.length === 0 ? <p className="muted">The committee assigned your observer.</p> : mySentRequests.map(req => (
                <div className="list-row" key={req.id}>
                  <span className="grow list-title">{req.observerName}</span>
                  <Badge tone={REQ_TONE[req.status]}>{req.status}</Badge>
                </div>
              ))}
            </Card>
          </div>
        ) : (
          <div className="stack">
            <Card title="Request observers" sub="Ask one or more eligible colleagues; confirm the first who accepts.">
              {!mySignup ? (
                <Notice tone="info" title="Sign up first">
                  Sign up a course on My cycle to get a list of eligible observers.
                  <div className="section-gap" />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => goTo('home')}>Go to My cycle</button>
                </Notice>
              ) : !isPastSignupDeadline ? (
                <Notice tone="info" icon="clock" title="List hidden until sign-up closes">
                  Potential observers appear once the sign-up deadline ({shortDeadline(globalDeadlines?.signup, globalDeadlines?.signupTime) || 'TBD'}) passes.
                </Notice>
              ) : !mySignup.listReleased ? (
                <Notice tone="warn" icon="lock" title="Pending committee approval">
                  The Assessment Committee is reviewing your list of potential observers. You will be notified when it is released.
                </Notice>
              ) : (mySignup.eligibleObservers || []).length === 0 ? (
                <EmptyState icon="users" title="No eligible observers found">Contact the Assessment Committee.</EmptyState>
              ) : (mySignup.eligibleObservers || []).map(observer => {
                const hasRequested = mySentRequests.some(req => req.observerId === observer.professor_id);
                return (
                  <div className="list-row" key={observer.professor_id}>
                    <span className="avatar">{initials(observer.name)}</span>
                    <span className="grow"><span className="list-title">{observer.name}</span><span className="list-sub">{observer.department}</span></span>
                    {hasRequested ? <Badge tone="warn">Request sent</Badge> : <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleSendRequest(observer)}><Icon name="send" size={15} /> Send request</button>}
                  </div>
                );
              })}
            </Card>

            <Card title="Track and confirm" sub="When a colleague accepts, confirm them as your observer.">
              {mySentRequests.length === 0 ? <p className="muted">No requests sent yet.</p> : mySentRequests.map(req => (
                <div className="list-row" key={req.id}>
                  <span className="grow list-title">{req.observerName}</span>
                  <Badge tone={REQ_TONE[req.status]}>{req.status}</Badge>
                  {req.status === 'Accepted' && <button type="button" className="btn btn-primary btn-sm" onClick={() => handleFinalConfirm(req)}>Confirm final match</button>}
                </div>
              ))}
            </Card>
          </div>
        )
      )}

      {/* ---------- MY DUTIES ---------- */}
      {activeTab === 'observer-duties' && (
        <div className="stack">
          <div className="grid grid-340">
            {pendingDuties.map(req => (
              <section key={req.id} className="card card-warn stack-sm">
                <span><Badge tone="warn">New request</Badge></span>
                <div className="card-title">{req.observeeName}</div>
                <div className="muted">wants you to observe <span className="mono">{req.courseCode}</span> · {req.timing}</div>
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={() => handleObserverAction(req.id, 'Accepted')}>Accept</button>
                  <button type="button" className="btn btn-warn" onClick={() => handleObserverAction(req.id, 'Declined')}>Decline</button>
                </div>
              </section>
            ))}

            {myAssignedObservations.map(o => {
              // VALIDATION: "Evaluation Completed" is locked until the evaluation form is submitted
              const hasSubmittedEvaluation = (globalEvaluations || []).some(e => e.observationId === o.id);
              const draft = evaluationDrafts?.[o.id];
              const answered = draft ? Object.values(draft.answers || {}).filter(a => a?.rating || a?.notes).length : 0;
              const canComplete = hasSubmittedEvaluation && !isPastObservationDeadline;
              return (
                <section key={o.id} className="card stack-sm">
                  <div className="row-between">
                    {o.scheduledDate ? <Badge tone="info">{shortDate(o.scheduledDate)}{o.scheduledTime ? ` · ${o.scheduledTime}` : ''}</Badge> : <Badge tone="warn">Date not set</Badge>}
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="card-title">{o.observeeName}</div>
                  <div className="muted"><span className="mono">{o.courseCode}</span> · {o.timing}</div>

                  {o.status === 'Missed' || o.status === 'Completed' ? null : o.observerConfirmed ? (
                    <Notice tone="info" title="Waiting for the observee">You confirmed this observation. It completes once {o.observeeName} confirms.</Notice>
                  ) : (
                    <>
                      {hasSubmittedEvaluation ? (
                        <span className="row text-good"><Icon name="checkCircle" size={16} /> Evaluation submitted</span>
                      ) : draft ? (
                        <>
                          <Meter value={activeCriteria.length ? (answered / activeCriteria.length) * 100 : 0} tone="warn" label={`${answered} of ${activeCriteria.length} answered`} />
                          <span className="faint">Draft: {answered} of {activeCriteria.length} answered · saved {draft.savedAt}</span>
                        </>
                      ) : null}
                      <div className="row">
                        {!hasSubmittedEvaluation && (isPastObservationDeadline ? (
                          <Badge tone="bad"><Icon name="lock" size={13} /> Deadline passed</Badge>
                        ) : (
                          <button type="button" className="btn btn-primary" onClick={() => openEvaluation(o)}>{draft ? 'Continue evaluation' : 'Begin evaluation'}</button>
                        ))}
                        <button
                          type="button"
                          className={hasSubmittedEvaluation ? 'btn btn-primary' : 'btn btn-secondary'}
                          disabled={!canComplete}
                          title={isPastObservationDeadline ? 'Observation deadline has passed' : hasSubmittedEvaluation ? '' : 'Submit the evaluation form first'}
                          onClick={() => confirmObservation(o.id, 'observer')}
                        >Mark completed</button>
                        <button type="button" className="btn btn-text" onClick={() => reportMissedObservation(o.id)}>Did not happen</button>
                      </div>
                      {!hasSubmittedEvaluation && !isPastObservationDeadline && <span className="faint">Submit the evaluation form before marking it completed.</span>}
                    </>
                  )}
                </section>
              );
            })}
          </div>

          {pendingDuties.length === 0 && myAssignedObservations.length === 0 && (
            <EmptyState icon="signups" title="No duties right now">When a colleague asks you to observe them, the request shows up here.</EmptyState>
          )}

          {pastDuties.length > 0 && (
            <Card title="Past requests">
              {pastDuties.map(req => (
                <div className="list-row" key={req.id}>
                  <span className="grow">{req.observeeName} <span className="mono faint">{req.courseCode}</span></span>
                  <Badge tone={REQ_TONE[req.status]}>{req.status}</Badge>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* ---------- LIVE EVALUATION ---------- */}
      {activeTab === 'live-evaluation' && activeEvaluationTarget && (
        <form className="stack max-920" onSubmit={async (e) => {
          e.preventDefault();
          // PATCH .../form { ratings, items, submit: true }: the server keeps a snapshot of the criteria
          // (so later template edits don't alter this form), clears the draft and notifies both people
          const ok = await run(() => api.form(activeEvaluationTarget.id, {
            ratings: evalAnswers,
            items: activeCriteria.map(({ id, criteria, ratingScale }) => ({ id, criteria, ratingScale })),
            submit: true,
          }), 'Evaluation submitted and sent to the committee.');
          if (ok) { await refresh(); closeEvaluation(); }
        }}>
          <div className="card row-between">
            <span className="muted">
              <span className="mono text-warn">{answeredCount}/{activeCriteria.length}</span> answered
              {evaluationDrafts?.[activeEvaluationTarget.id] && ` · last saved ${evaluationDrafts[activeEvaluationTarget.id].savedAt}`}
            </span>
            <div className="row">
              <button type="button" className="btn btn-ghost" onClick={handleCancelEvaluation}>Cancel</button>
              <button type="button" className="btn btn-accent" onClick={handleSaveDraft}>Save and return</button>
            </div>
          </div>

          {activeCriteria.map((item, index) => {
            const isScore = item.ratingScale.includes('1 to 5');
            const isYesNo = item.ratingScale.includes('Yes / No');
            const options = isScore ? ['1', '2', '3', '4', '5'] : isYesNo ? ['Yes', 'No', 'N/A'] : [];
            return (
              <fieldset key={item.id} className="criterion-fieldset">
                <legend><span className="mono text-good">{String(index + 1).padStart(2, '0')}</span> {item.criteria}</legend>
                {getRatingLegend(item.ratingScale) && <span className="legend-text">{getRatingLegend(item.ratingScale)}</span>}
                {options.length > 0 && (
                  <div className="choice-group">
                    {options.map(opt => (
                      <label key={opt} className={`choice${evalAnswers[item.id]?.rating === opt ? ' selected' : ''}`}>
                        <input type="radio" name={`rating-${item.id}`} value={opt} required checked={evalAnswers[item.id]?.rating === opt} onChange={(e) => updateEvalAnswer(item.id, 'rating', e.target.value)} />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
                <textarea className="textarea" aria-label={`Notes for criterion ${index + 1}`} placeholder="Observer notes and feedback" rows="3" required value={evalAnswers[item.id]?.notes || ''} onChange={(e) => updateEvalAnswer(item.id, 'notes', e.target.value)} />
              </fieldset>
            );
          })}
          <div><button type="submit" className="btn btn-primary btn-lg">Submit evaluation</button></div>
        </form>
      )}

      {/* ---------- MY EVALUATIONS ---------- */}
      {activeTab === 'my-evaluations' && (
        viewingEvaluation ? (
          <EvaluationDetail evaluation={viewingEvaluation} evaluationTemplate={evaluationTemplate} onBack={() => setViewingEvaluation(null)} backLabel="My evaluations" />
        ) : (
          <div className="grid grid-340">
            <Card title="About my teaching" sub="Evaluations submitted for you as observee">
              {evaluationsOfMe.length === 0 ? <EmptyState icon="form" title="None yet">Forms about your teaching appear here once your observer submits them.</EmptyState>
                : evaluationsOfMe.slice().reverse().map(ev => (
                  <div className="list-row" key={ev.id}>
                    <span className="grow"><span className="list-title"><span className="mono">{ev.courseCode}</span> · {ev.term}</span><span className="list-sub">Observed by {ev.observerName} · {formatDate(ev.dateSubmitted)}</span></span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewingEvaluation(ev)}>Open form</button>
                  </div>
                ))}
            </Card>
            <Card title="Submitted as observer" sub="Evaluations you wrote">
              {mySubmittedEvaluations.length === 0 ? <EmptyState icon="form" title="Nothing submitted yet">Evaluations you submit as an observer appear here.</EmptyState>
                : mySubmittedEvaluations.slice().reverse().map(ev => (
                  <div className="list-row" key={ev.id}>
                    <span className="grow"><span className="list-title">{ev.observeeName}</span><span className="list-sub"><span className="mono">{ev.courseCode}</span> · {formatDate(ev.dateSubmitted)}</span></span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewingEvaluation(ev)}>Open form</button>
                  </div>
                ))}
            </Card>
          </div>
        )
      )}

      {/* ---------- NOTIFICATIONS ---------- */}
      {activeTab === 'notifications' && (
        <div className="stack">
          <div className="row">
            <div className="segmented" role="tablist" aria-label="Notification folders">
              <button type="button" role="tab" aria-selected={notifTab === 'inbox'} className={notifTab === 'inbox' ? 'active' : ''} onClick={() => setNotifTab('inbox')}>Inbox{notifTab === 'inbox' ? ` ${inbox.length}` : ''}</button>
              <button type="button" role="tab" aria-selected={notifTab === 'archive'} className={notifTab === 'archive' ? 'active' : ''} onClick={() => setNotifTab('archive')}>Archive{notifTab === 'archive' ? ` ${archived.length}` : ''}</button>
            </div>
            {unreadCount > 0 && notifTab === 'inbox' && (
              <button type="button" className="btn btn-ghost btn-sm push-right" onClick={async () => {
                await run(() => Promise.all(myNotifications.filter(n => !n.read && !String(n.id).startsWith('sys-')).map(n => api.archive(n.id))), 'All notifications archived.');
                await refresh();
              }}><Icon name="archive" size={15} /> Archive all</button>
            )}
          </div>

          {(notifTab === 'inbox' ? inbox : archived).length === 0 ? (
            <EmptyState icon="inbox" title={notifTab === 'inbox' ? "You're all caught up" : 'No archived notifications'} />
          ) : notifTab === 'inbox' ? inbox.map(notif => (
            <article key={notif.id} className="notif">
              <NotifWhen value={notif.createdAt} />
              <span className="notif-msg">{notif.message}</span>
              {!String(notif.id).startsWith('sys-') ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await run(() => api.archive(notif.id)); await refresh(); }}>Archive</button>
              ) : <span />}
            </article>
          )) : archived.map(notif => (
            <article key={notif.id} className="notif read">
              <NotifWhen value={notif.createdAt} />
              <span className="notif-msg">{notif.message}</span>
            </article>
          ))}
        </div>
      )}

      {activeTab === 'survey' && (
        <FeedbackSurvey hasSubmitted={hasSubmittedSurvey} onSubmit={onSurveySubmit} isClosed={isSurveyClosed} deadline={surveyDeadlineLabel} />
      )}
    </AppShell>
  );
}
