import React, { useState, useEffect } from 'react';
import { generateObserverMatches } from './utils/matchmaker.js';
import './styles/App.css';
import FeedbackSurvey from './components/FeedbackSurvey.jsx';
import AdminSurveyResults from './components/AdminSurveyResults.jsx';
import AdminKpiDashboard from './components/AdminKpiDashboard.jsx';
import ScheduleObservationForm from './components/ScheduleObservationForm.jsx';
import { validateObservationSlot, todayLocalISO } from './utils/scheduling.js';
import { isPastDeadline } from './utils/deadlines.js';
import { mockProfessors, mockAdmins, mockCourses, calculateEvaluationStatus, currentSemester, initialDeadlines, mockEvaluationTemplate } from './data/mockDatabase.js';

// Builds avatar initials from a person's first + last name, skipping titles like "Dr." / "Prof."
const TITLE_PREFIXES = ['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'mx'];
function getInitials(fullName) {
  if (!fullName) return 'U';
  const parts = fullName.trim().split(/\s+/).filter(p => !TITLE_PREFIXES.includes(p.replace(/\./g, '').toLowerCase()));
  if (parts.length === 0) return 'U';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

// Explains what each rating option means for a criterion's rating scale
// (matches the scale options available in the admin Evaluation Template Editor)
function getRatingLegend(ratingScale = '') {
  if (ratingScale.includes('1 to 5')) {
    return '1 = Poor · 2 = Fair · 3 = Good · 4 = Very Good · 5 = Excellent';
  }
  if (ratingScale.includes('Yes / No')) {
    return 'Yes = Criterion observed/met · No = Criterion not observed/met · N/A = Not applicable to this class session';
  }
  if (ratingScale.includes('Text Feedback')) {
    return 'No numeric rating for this item, so provide written feedback in the notes box below.';
  }
  return ratingScale ? `Rating scale: ${ratingScale}` : '';
}

// Read-only view of a submitted evaluation form (used on the professor "My Evaluations" tab)
function EvaluationDetail({ evaluation, evaluationTemplate, onBack }) {
  // Prefer the criteria snapshot saved at submission time, so later template edits don't change old forms
  const items = evaluation.items || (evaluationTemplate || []).filter(t => evaluation.answers?.[t.id]);
  return (
    <div className="bento-card full-span">
      <div className="card-header-flex" style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '15px' }}>
        <div>
          <h3 style={{ fontSize: '1.4rem', color: 'var(--utd-green)' }}>Evaluation: {evaluation.observeeName}</h3>
          <p className="subtitle" style={{ marginTop: '5px' }}>
            {evaluation.courseCode}{evaluation.timing ? ` (${evaluation.timing})` : ''} · Observed by {evaluation.observerName} · Submitted {evaluation.dateSubmitted}
          </p>
        </div>
        <button type="button" className="btn-secondary sm" onClick={onBack}>← Back</button>
      </div>
      {items.length === 0 ? (
        <p style={{ color: '#64748b' }}>No answers were recorded for this evaluation.</p>
      ) : items.map((item, index) => {
        const answer = evaluation.answers?.[item.id] || {};
        return (
          <div key={item.id} className="eval-view-item">
            <p className="eval-view-criteria"><strong>{index + 1}.</strong> {item.criteria}</p>
            <p style={{ margin: '0 0 8px 0' }}>
              Rating: {answer.rating ? <span className="badge badge-neutral">{answer.rating}</span> : <span style={{ color: '#94a3b8' }}>Not rated</span>}
            </p>
            {getRatingLegend(item.ratingScale) && <p className="rating-legend">{getRatingLegend(item.ratingScale)}</p>}
            <div className="eval-view-notes">{answer.notes || <span style={{ color: '#94a3b8' }}>No notes provided.</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  
  // GLOBAL STATE
  const [globalRequests, setGlobalRequests] = useState([]);
  const [surveySubmissions, setSurveySubmissions] = useState([]);
  const [surveyResponses, setSurveyResponses] = useState([]);
  const [globalSignups, setGlobalSignups] = useState([]);
  const [globalEvaluations, setGlobalEvaluations] = useState([]);
  const [globalObservations, setGlobalObservations] = useState([]);
  const [globalDeadlines, setGlobalDeadlines] = useState(initialDeadlines);
  // NEW: Template State
  const [evaluationTemplate, setEvaluationTemplate] = useState(mockEvaluationTemplate);
  const [globalNotifications, setGlobalNotifications] = useState([]);
  // NEW: Saved (unsubmitted) evaluation progress, keyed by observation id
  const [evaluationDrafts, setEvaluationDrafts] = useState({});

  const handleSurveySubmit = (professorId, answers) => {
    if (surveySubmissions.some(s => s.professor_id === professorId)) return;
      setSurveySubmissions(prev => [...prev, { professor_id: professorId }]);
      setSurveyResponses(prev => [...prev, { response_id: crypto.randomUUID(), ...answers }]);
  };

  if (!currentUser) return <Login onLogin={setCurrentUser} />;

  if (currentUser.role === 'admin') {
    return (
      <AdminDashboard
        user={currentUser}
        onLogout={() => setCurrentUser(null)}
        globalRequests={globalRequests}
        surveyResponses={surveyResponses}
        submittedCount={surveySubmissions.length}
        totalProfessors={mockProfessors.length}
        globalSignups={globalSignups}
        setGlobalSignups={setGlobalSignups}
        globalObservations={globalObservations}
        setGlobalObservations={setGlobalObservations}
        globalDeadlines={globalDeadlines}
        setGlobalDeadlines={setGlobalDeadlines}
        surveySubmissions={surveySubmissions}
        // NEW: Pass template state to Admin
        evaluationTemplate={evaluationTemplate}
        setEvaluationTemplate={setEvaluationTemplate}
        // NEW: Pass notifications to Professor
      globalNotifications={globalNotifications}
      setGlobalNotifications={setGlobalNotifications}
      globalEvaluations={globalEvaluations}
      
      />
    );
  }

  return (
    <ProfessorDashboard
      user={currentUser}
      onLogout={() => setCurrentUser(null)}
      globalRequests={globalRequests}
      setGlobalRequests={setGlobalRequests}
      globalSignups={globalSignups}
      setGlobalSignups={setGlobalSignups}
      globalObservations={globalObservations}
      setGlobalObservations={setGlobalObservations}
      hasSubmittedSurvey={surveySubmissions.some(s => s.professor_id === currentUser.professor_id)}
      onSurveySubmit={(answers) => handleSurveySubmit(currentUser.professor_id, answers)}
      evaluationTemplate={evaluationTemplate} 
      globalDeadlines={globalDeadlines}
      globalNotifications={globalNotifications}
      setGlobalNotifications={setGlobalNotifications}
      globalEvaluations={globalEvaluations}
      setGlobalEvaluations={setGlobalEvaluations}
      evaluationDrafts={evaluationDrafts}
      setEvaluationDrafts={setEvaluationDrafts}
    />
  );
}
/* =========================================
   LOGIN PAGE (Credential Validation)
========================================= */
function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const user = mockProfessors.find(p => p.username === username)
          || mockAdmins.find(a => a.username === username);
    
    if (!user) {
      setError("Professor not found.");
      return;
    }
    if (user.password !== password) {
      setError("Incorrect password.");
      return;
    }
    
    setError('');
    onLogin(user);
  };

  return (
    <div className="login-container">
      {/* Background dots: styled .orb-1 ... .orb-14 in App.css */}
      {Array.from({ length: 14 }, (_, i) => (
    <div key={i} className={`login-orb orb-${i + 1}`} />
))}

      <div className="login-card">
        <div className="logo-placeholder">UTD</div>
        <h2>Assessment Helper</h2>
        <p className="login-subtitle">Faculty Sign In</p>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="login-error" role="alert">{error}</div>}

          <div className="input-group">
            <label htmlFor="username">Username</label>
            <input id="username" type="text" placeholder="e.g., asmith" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" placeholder="Enter your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          <button type="submit" className="btn-primary btn-3d">Sign In</button>
        </form>

        <div className="login-hint">
          <span>Test credentials</span>
          <div>Professors: asmith / bjones / cwhite / dbrown</div>
          <div>Admin (committee): admin</div>
          <div>Password: 123</div>
        </div>
      </div>
    </div>
  );
}

/* =========================================
   ADMIN DASHBOARD
========================================= */
function AdminDashboard({ user, onLogout, globalSignups, setGlobalSignups, globalRequests, globalObservations, setGlobalObservations, globalDeadlines, setGlobalDeadlines, surveyResponses, submittedCount, totalProfessors, surveySubmissions, evaluationTemplate, setEvaluationTemplate, globalEvaluations, globalNotifications, setGlobalNotifications }) {
  const [activeTab, setActiveTab] = useState('metrics');
  const [viewingEvaluation, setViewingEvaluation] = useState(null); 
  
  // Local state for the new criterion form
  const [newCriteria, setNewCriteria] = useState('');
  const [newRating, setNewRating] = useState('1 to 5 (Poor to Excellent)');

  // State for inline editing & viewing
  const [editingId, setEditingId] = useState(null);
  const [editCriteria, setEditCriteria] = useState('');
  const [editRating, setEditRating] = useState('1 to 5 (Poor to Excellent)');
  const [expandedSignup, setExpandedSignup] = useState(null); 

  // NEW: Manual Resolution & Deadline States
  const [resolvingSignupId, setResolvingSignupId] = useState(null);
  const [manualObserverId, setManualObserverId] = useState('');
  
  // Check if observation deadline passed
  const isPastObservationDeadline = globalDeadlines?.observation 
    ? new Date() > new Date(`${globalDeadlines.observation}T23:59:59`) 
    : false;

  // NEW: Blast out end-of-process survey reminders
  const handleSurveyBlast = () => {
    const newNotifs = globalSignups.map(s => ({
      id: Math.random().toString(), recipientId: s.observeeId,
      message: `Action Required: The observation period has officially ended. Please complete your end-of-process feedback survey.`,
      read: false, timestamp: new Date().toLocaleDateString()
    }));
    setGlobalNotifications(prev => [...(prev || []), ...newNotifs]);
    alert("End-of-process survey reminders blasted to all observees!");
  };

  // NEW: Manually assign an observer
  const handleManualAssignment = (signup) => {
    if (!manualObserverId) {
      alert("Please select a faculty member from the dropdown first.");
      return;
    }
    // FIX: Convert both IDs to strings to prevent strict equality failures from the HTML <select> element
    const observer = mockProfessors.find(p => p.professor_id.toString() === manualObserverId.toString());
    
    if (!observer) {
      alert("Error: Observer not found in database.");
      return;
    }

    const newObservation = {
      id: Date.now(), observeeId: signup.observeeId, observeeName: signup.observeeName,
      observerId: observer.professor_id, observerName: observer.name,
      courseCode: signup.courseCode, timing: signup.timing,
      status: 'Pending Scheduling', scheduledDate: null, observerConfirmed: false, observeeConfirmed: false,
    };
    
    setGlobalObservations(prev => [...(prev || []), newObservation]);
    // FIX: Force matchFlag to 'OK' and bypass the list release step so it jumps straight to scheduling
    setGlobalSignups(prev => prev.map(s => s.id === signup.id ? { ...s, matchFlag: 'OK', listReleased: true } : s));
    
    // Notify both parties of the manual committee assignment
    setGlobalNotifications(prev => [...(prev || []), 
      { id: Math.random().toString(), recipientId: observer.professor_id, message: `System Assignment: You have been manually assigned by the Committee to observe ${signup.observeeName} (${signup.courseCode}).`, read: false, timestamp: new Date().toLocaleDateString() },
      { id: Math.random().toString(), recipientId: signup.observeeId, message: `System Update: The Committee has manually assigned ${observer.name} as your observer for ${signup.courseCode}. Head to 'Observee Status' to schedule the date.`, read: false, timestamp: new Date().toLocaleDateString() }
    ]);
    
    setResolvingSignupId(null);
    setManualObserverId('');
    alert(`Successfully assigned ${observer.name} to observe ${signup.observeeName}! They can now schedule the date.`);
  };
  const startEditing = (item) => {
    setEditingId(item.id); setEditCriteria(item.criteria); setEditRating(item.ratingScale);
  };
  const saveEdit = (id) => {
    setEvaluationTemplate(evaluationTemplate.map(item => item.id === id ? { ...item, criteria: editCriteria, ratingScale: editRating, effective: 'Fall 2027' } : item));
    setEditingId(null);
  };
  const cancelEdit = () => setEditingId(null);

  const allFacultyStatus = mockProfessors.map(prof => ({ ...prof, ...calculateEvaluationStatus(prof) }));
  const dueFaculty = allFacultyStatus.filter(f => f.status === 'Due' || f.status === 'Overdue');
  const NavItem = ({ id, label }) => (<li className={activeTab === id ? 'active' : ''} onClick={() => { setActiveTab(id); setViewingEvaluation(null); }}><span>{label}</span></li>);

  const handleAddCriteria = () => {
    if (!newCriteria) return;
    // NEW: Semester-locked template additions
    setEvaluationTemplate([...evaluationTemplate, { id: Date.now(), criteria: newCriteria, ratingScale: newRating, effective: 'Fall 2027' }]);
    setNewCriteria('');
  };

  const handleDeleteCriteria = (id) => {
    setEvaluationTemplate(evaluationTemplate.filter(item => item.id !== id));
  };

  // NEW: Admin releases the list of potential observers
  const handleReleaseList = (signup) => {
    setGlobalSignups(prev => prev.map(s => s.id === signup.id ? { ...s, listReleased: true } : s));
    setGlobalNotifications(prev => [...(prev || []), {
      id: Math.random().toString(), recipientId: signup.observeeId,
      message: `Action Required: The Assessment Committee has released your list of potential observers for ${signup.courseCode}. You may now send requests.`,
      read: false, timestamp: new Date().toLocaleDateString()
    }]);
    alert(`List successfully released to ${signup.observeeName}!`);
  };

  return (
    <div className="dashboard-layout">
      <div className="sidebar premium-glass-dark" style={{ background: '#1e293b' }}>
        <div className="sidebar-header"><div className="logo-small">AC</div><div><h3>Committee</h3><small>Executive Portal</small></div></div>
        <ul className="nav-menu">
          <NavItem id="metrics" label="📊 Live Metrics & KPIs" />
          <NavItem id="faculty" label="👥 Due / Overdue Faculty" />
          <NavItem id="signups" label="📝 Signup Monitor" />
          <NavItem id="deadlines" label="📅 Deadlines" />
          <NavItem id="template" label="⚙️ Template Editor" />
          <NavItem id="evaluations" label="📄 Digital Evaluations" />
          <NavItem id="surveys" label="📋 Survey Responses" />
          <li onClick={onLogout} className="logout-btn"><span>🚪</span> <span>Logout</span></li>
        </ul>
      </div>

      <div className="main-content">
        <header className="top-header premium-glass">
          <div className="header-title"><h2>System Overview</h2><p>Welcome, {user.name} (Committee Member)</p></div>
        </header>

        <div className="content-scroll">
          {activeTab === 'metrics' && (
            <AdminKpiDashboard
              signups={globalSignups}
              requests={globalRequests}
              observations={globalObservations}
              surveySubmissions={surveySubmissions}
              deadlines={globalDeadlines}
            />
          )}

          {activeTab === 'faculty' && (
            <div className="bento-card full-span">
              <h3>Faculty Due for Evaluation ({currentSemester})</h3>
              <table className="data-table">
                <thead><tr><th>Professor</th><th>Level</th><th>Dept</th><th>Last Eval</th><th>Status</th></tr></thead>
                <tbody>
                  {dueFaculty.map(f => (
                    <tr key={f.professor_id}>
                      <td><strong>{f.name}</strong></td><td>{f.hire_level}</td><td>{f.department}</td><td>{f.last_evaluation || 'None'}</td>
                      <td>
                        {f.status === 'Overdue' ? <span className="badge badge-danger" style={{background: '#ef4444', color:'white'}}>Overdue ({f.overdue_by} sem)</span> : <span className="badge badge-warning">Due</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'signups' && (
            <div className="bento-card full-span">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>Signup & Matching Monitor</h3>
                {isPastObservationDeadline && (
                  <button className="btn-primary btn-3d" onClick={handleSurveyBlast} style={{ background: 'var(--utd-orange)', border: 'none' }}>
                    📢 Request End-of-Process Surveys
                  </button>
                )}
              </div>
              <div className="table-scroll-x">
              <table className="data-table nowrap-table">
                <thead><tr><th>Observee</th><th>Course</th><th>Matches Found</th><th>Match Status</th><th>Confirmed Observer</th><th>AC Action</th></tr></thead>
                <tbody>
                  {globalSignups.length === 0 ? <tr><td colSpan="6" style={{textAlign: 'center'}}>No signups yet.</td></tr> : 
                    globalSignups.map(signup => {
                      const obs = globalObservations.find(o => o.observeeId === signup.observeeId);
                      const isExpanded = expandedSignup === signup.id;
                      const isResolving = resolvingSignupId === signup.id;
                      
                      return (
                        <React.Fragment key={signup.id}>
                          <tr>
                            <td><strong>{signup.observeeName}</strong></td><td>{signup.courseCode}</td>
                            <td>{signup.matchesCount} Observers</td>
                            <td>
                              {signup.matchFlag === 'NO ELIGIBLE OBSERVER' && <span className="badge badge-danger" style={{background: '#ef4444', color:'white'}}>No Eligible Observer</span>}
                              {signup.matchFlag === 'INSUFFICIENT OBSERVERS' && <span className="badge badge-warning">Insufficient Observers</span>}
                              {signup.matchFlag === 'OK' && <span className="badge badge-success">OK</span>}
                            </td>
                            <td>{obs ? <><strong>{obs.observerName}</strong> <span className={`badge ${obs.status === 'Completed' ? 'badge-success' : obs.status === 'Missed' ? 'badge-error' : 'badge-warning'}`}>{obs.status}</span></> : <span style={{color: '#94a3b8'}}>Pending</span>}</td>
                            <td>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="btn-secondary sm" onClick={() => { setExpandedSignup(isExpanded ? null : signup.id); setResolvingSignupId(null); }}>
                                  {isExpanded ? 'Hide List' : 'View List'}
                                </button>
                                {(signup.matchFlag === 'NO ELIGIBLE OBSERVER' || signup.matchFlag === 'INSUFFICIENT OBSERVERS') && !obs && (
                                  <button className="btn-danger sm" onClick={() => { setResolvingSignupId(isResolving ? null : signup.id); setExpandedSignup(null); }}>
                                    Resolve Manually
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          
                          {/* MANUAL RESOLUTION DROPDOWN ROW */}
                          {isResolving && (
                            <tr style={{ background: '#fffbeb', borderBottom: '2px solid #fde68a' }}>
                              <td colSpan="6" style={{ padding: '20px' }}>
                                <h4 style={{ marginBottom: '10px', color: '#b45309' }}>Manual Observer Assignment for {signup.observeeName}</h4>
                                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                                  <select value={manualObserverId} onChange={(e) => setManualObserverId(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #d97706', width: '350px' }}>
                                    <option value="">-- Select Faculty Member --</option>
                                    {mockProfessors.filter(p => p.professor_id !== signup.observeeId).map(p => (
                                      <option key={p.professor_id} value={p.professor_id}>{p.name} ({p.department}) - ID: {p.professor_id}</option>
                                    ))}
                                  </select>
                                  <button className="btn-primary btn-3d sm" onClick={() => handleManualAssignment(signup)}>Assign & Confirm Pair</button>
                                  <button className="btn-secondary sm" onClick={() => setResolvingSignupId(null)}>Cancel</button>
                                </div>
                              </td>
                            </tr>
                          )}

                          {/* STANDARD POTENTIAL OBSERVERS ROW */}
                          {isExpanded && !isResolving && (
                            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                              <td colSpan="6" style={{ padding: '20px' }}>
                                <h4 style={{ marginBottom: '10px', color: 'var(--utd-orange)' }}>Generated Observer List for {signup.observeeName}</h4>
                                <ul style={{ marginBottom: '15px', paddingLeft: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                  {(signup.eligibleObservers || []).length === 0 ? (
                                    <li style={{ color: '#ef4444' }}>No eligible observers found in database.</li>
                                  ) : (
                                    (signup.eligibleObservers || []).map(po => <li key={po.professor_id}><strong>{po.name}</strong> ({po.department})</li>)
                                  )}
                                </ul>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                  {(signup.matchFlag === 'NO ELIGIBLE OBSERVER' || signup.matchFlag === 'INSUFFICIENT OBSERVERS') ? (
                                    <span className="badge badge-error" style={{ fontSize: '0.9rem', padding: '6px 12px' }}>🔒 List cannot be released. Please click 'Resolve Manually'.</span>
                                  ) : signup.listReleased ? (
                                    <span className="badge badge-success" style={{ fontSize: '0.9rem', padding: '6px 12px' }}>✓ List has been released to {signup.observeeName}</span>
                                  ) : (
                                    <button className="btn-primary btn-3d sm" onClick={() => handleReleaseList(signup)}>Release List & Notify Observee</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  }
                </tbody>
              </table>
              </div>
            </div>
          )}

          {activeTab === 'deadlines' && (
            <div className="bento-grid">
              <div className="bento-card">
                <h3>Global Deadlines</h3>
                <form className="modern-form">
                  <div className="form-group"><label>Signup Deadline</label><input type="date" value={globalDeadlines.signup} onChange={e => setGlobalDeadlines({...globalDeadlines, signup: e.target.value})} /></div>
                  <div className="form-group"><label>Observation Period Ends</label><input type="date" value={globalDeadlines.observation} onChange={e => setGlobalDeadlines({...globalDeadlines, observation: e.target.value})} /></div>
                  <div className="form-group"><label>Survey Deadline (Hand-off)</label><input type="date" value={globalDeadlines.survey} onChange={e => setGlobalDeadlines({...globalDeadlines, survey: e.target.value})} /></div>
                  <button type="button" className="btn-primary" onClick={() => alert("Deadlines updated! Notifications dispatched.")}>Update Deadlines</button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'template' && (
            <div className="bento-grid">
              <div className="bento-card full-span">
                <h3>Evaluation Template Editor</h3>
                <p className="subtitle">Configure the criteria and rating scales that observers will use during in-person evaluations.</p>
                
                <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', marginBottom: '24px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ marginBottom: '15px' }}>Add New Criterion</h4>
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '5px' }}>Criteria Description</label>
                      <input type="text" value={newCriteria} onChange={(e) => setNewCriteria(e.target.value)} placeholder="e.g., Uses multimedia effectively" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '5px' }}>Rating Scale</label>
                      <select value={newRating} onChange={(e) => setNewRating(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <option value="1 to 5 (Poor to Excellent)">1 to 5 (Poor to Excellent)</option>
                        <option value="Yes / No / N/A">Yes / No / N/A</option>
                        <option value="Text Feedback Only">Text Feedback Only</option>
                      </select>
                    </div>
                    <button className="btn-primary btn-3d" onClick={handleAddCriteria} style={{ padding: '10px 20px' }}>Add</button>
                  </div>
                </div>

                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Evaluation Criteria</th><th>Rating Scale</th><th>Action</th></tr></thead>
                    <tbody>
                      {evaluationTemplate.length === 0 ? (
                        <tr><td colSpan="3" style={{ textAlign: 'center' }}>No criteria defined. Template is empty.</td></tr>
                      ) : (
                        evaluationTemplate.map(item => (
                          <tr key={item.id}>
                            {editingId === item.id ? (
                              <>
                                {/* EDIT MODE */}
                                <td>
                                  <input 
                                    type="text" 
                                    value={editCriteria} 
                                    onChange={(e) => setEditCriteria(e.target.value)} 
                                    style={{width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1'}} 
                                  />
                                </td>
                                <td>
                                  <select 
                                    value={editRating} 
                                    onChange={(e) => setEditRating(e.target.value)} 
                                    style={{width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1'}}
                                  >
                                    <option value="1 to 5 (Poor to Excellent)">1 to 5 (Poor to Excellent)</option>
                                    <option value="Yes / No / N/A">Yes / No / N/A</option>
                                    <option value="Text Feedback Only">Text Feedback Only</option>
                                  </select>
                                </td>
                                <td>
                                  <div style={{display: 'flex', gap: '8px'}}>
                                    <button className="btn-primary sm" onClick={() => saveEdit(item.id)} style={{padding: '6px 12px', borderRadius: '6px', border: 'none'}}>Save</button>
                                    <button className="btn-secondary sm" onClick={cancelEdit} style={{padding: '6px 12px', borderRadius: '6px', cursor: 'pointer'}}>Cancel</button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                {/* VIEW MODE */}
                                <td><strong>{item.criteria}</strong></td>
                                <td><span className="badge badge-neutral">{item.ratingScale}</span></td>
                                <td>
                                  <div style={{display: 'flex', gap: '8px'}}>
                                    <button className="btn-secondary sm" onClick={() => startEditing(item)} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold' }}>Edit</button>
                                    <button className="btn-danger sm" onClick={() => handleDeleteCriteria(item.id)} style={{ background: '#ef4444', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}>Remove</button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                
                <div style={{ marginTop: '20px', textAlign: 'right' }}>
                  <button className="btn-primary btn-3d" onClick={() => alert("Template saved and published to Observer Portals!")}>Save & Publish Template</button>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'evaluations' && (
            <div className="bento-grid">
              {viewingEvaluation ? (
                <EvaluationDetail evaluation={viewingEvaluation} evaluationTemplate={evaluationTemplate} onBack={() => setViewingEvaluation(null)} />
              ) : (
                <div className="bento-card full-span">
                  <h3>Submitted Digital Evaluations</h3>
                  <div className="modern-table-wrapper">
                    <table className="data-table">
                      <thead><tr><th>Date Submitted</th><th>Observer</th><th>Observee</th><th>Course</th><th>Action</th></tr></thead>
                      <tbody>
                        {!globalEvaluations || globalEvaluations.length === 0 ? (
                          <tr><td colSpan="5" style={{textAlign: 'center', padding: '20px'}}>No evaluations submitted yet.</td></tr>
                        ) : (
                          globalEvaluations.map(ev => (
                            <tr key={ev.id}>
                              <td>{ev.dateSubmitted}</td>
                              <td>{ev.observerName}</td>
                              <td><strong>{ev.observeeName}</strong></td>
                              <td>{ev.courseCode}</td>
                              <td>
                                <button type="button" className="btn-secondary sm" onClick={() => setViewingEvaluation(ev)}>View Form</button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'surveys' && (
            <AdminSurveyResults
              surveyResponses={surveyResponses}
              submittedCount={submittedCount}
              totalCount={totalProfessors}
            />
          )}
        </div>
      </div>
    </div>
  )
}
/* =========================================
   PROFESSOR DASHBOARD 
========================================= */
function ProfessorDashboard({ user, onLogout, globalRequests, setGlobalRequests, hasSubmittedSurvey, onSurveySubmit, globalSignups, setGlobalSignups, globalObservations, setGlobalObservations, evaluationTemplate, globalDeadlines, globalNotifications, setGlobalNotifications, globalEvaluations, setGlobalEvaluations, evaluationDrafts, setEvaluationDrafts }) {
  const [activeTab, setActiveTab] = useState('home');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [activeEvaluationTarget, setActiveEvaluationTarget] = useState(null);
  const [toastNotif, setToastNotif] = useState(null);
  // NEW: Answers for the evaluation form currently open: { [criteriaId]: { rating, notes } }
  const [evalAnswers, setEvalAnswers] = useState({});
  // NEW: Submitted evaluation currently opened (read-only) on the "My Evaluations" tab
  const [viewingEvaluation, setViewingEvaluation] = useState(null);
  const [notifTab, setNotifTab] = useState('inbox');
  // NEW: State for deferred observation reasoning
  const [deferReason, setDeferReason] = useState('');
  const [showDeferForm, setShowDeferForm] = useState(false);

  const handleDeferObservation = (obsId) => {
    if (!deferReason.trim()) {
      alert("Please provide a reason why the observation could not be completed.");
      return;
    }
    setGlobalObservations(prev => prev.map(o => o.id === obsId ? { 
      ...o, 
      status: 'Deferred / Rolled Over', 
      deferralReason: deferReason,
      deferredBy: user.name 
    } : o));

    setGlobalNotifications(prev => [...(prev || []), {
      id: Math.random().toString(), 
      recipientId: 0, // Admin ID
      message: `Observation Deferred: ${user.name} reported that their observation could not be completed this cycle. Reason: "${deferReason}"`, 
      read: false, 
      timestamp: new Date().toLocaleDateString()
    }]);

    setShowDeferForm(false);
    setDeferReason('');
    alert("Reason submitted to the Assessment Committee. Your cycle status has been updated.");
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

  // Save & Return: keep progress without requiring every field to be filled in
  const handleSaveDraft = () => {
    const obsId = activeEvaluationTarget.id;
    setEvaluationDrafts(prev => ({ ...prev, [obsId]: { answers: evalAnswers, savedAt: new Date().toLocaleString() } }));
    alert("Progress saved. You can come back and finish this evaluation later.");
    closeEvaluation();
  };

  // Cancel & Return: discard changes made since the last save (asks first if there are any)
  const handleCancelEvaluation = () => {
    const saved = evaluationDrafts?.[activeEvaluationTarget.id]?.answers || {};
    const hasUnsavedChanges = JSON.stringify(saved) !== JSON.stringify(evalAnswers);
    if (hasUnsavedChanges && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    closeEvaluation();
  };

  // SAFE DEFAULTS: Added fallbacks (|| []) to prevent null-reference crashes
  const myStatus = calculateEvaluationStatus(user) || { status: 'Unknown', next_eval: 'TBD' };
  const myCourses = (mockCourses || []).filter(c => c.instructor_id === user?.professor_id);
  const mySignup = (globalSignups || []).find(s => s.observeeId === user?.professor_id);
  const myConfirmedObservation = (globalObservations || []).find(o => o.observeeId === user?.professor_id);
  const isPastSignupDeadline = globalDeadlines?.signup 
    ? new Date() > new Date(`${globalDeadlines.signup}T00:00:00`) 
    : false;

  // NEW: Check if the observation-period deadline has passed
  const isPastObservationDeadline = globalDeadlines?.observation
    ? new Date() > new Date(`${globalDeadlines.observation}T23:59:59`)
    : false;

  // Once the admin-set survey deadline passes, the survey tab only shows a "closed" notice
  const isSurveyClosed = isPastDeadline(globalDeadlines?.survey);

  const dynamicSystemNotifs = [];
  if ((myStatus.status === 'Due' || myStatus.status === 'Overdue') && !mySignup) {
    dynamicSystemNotifs.push({
      id: 'sys-due', recipientId: user?.professor_id,
      message: `System Alert: You are ${myStatus.status} for an evaluation this cycle. Please sign up for a course.`,
      read: false, timestamp: new Date().toLocaleDateString()
    });
  }
  
  const myNotifications = [...dynamicSystemNotifs, ...((globalNotifications || []).filter(n => n.recipientId === user?.professor_id))];
  const unreadCount = myNotifications.filter(n => !n.read).length;

  // SAFE EFFECT: Locked dependency to length to prevent infinite loops
  useEffect(() => {
    const unread = myNotifications.filter(n => !n.read);
    if (unread.length > 0) {
      setToastNotif(unread[unread.length - 1]);
      const timer = setTimeout(() => setToastNotif(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [globalNotifications?.length]);

  const NavItem = ({ id, icon: Icon, label, badge }) => (
  <li className={activeTab === id ? 'active' : ''} onClick={() => { setActiveTab(id); setViewingEvaluation(null); }}>
    <Icon /> <span>{label}</span>
      {badge > 0 && (
        <span style={{ marginLeft: 'auto', background: '#ef4444', color: 'white', fontSize: '0.75rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '999px' }}>
          {badge > 5 ? '5+' : badge}
        </span>
      )}
    </li>
  );

  const confirmObservation = (obsId, side) => {
    // VALIDATION: the observer can't mark the observation complete until the evaluation form is submitted
    if (side === 'observer' && !(globalEvaluations || []).some(e => e.observationId === obsId)) {
      alert("Please complete and submit the evaluation form (Begin Evaluation) before marking this evaluation as completed.");
      return false;
    }
    setGlobalObservations(prev => {
      let justCompleted = false;
      let observeeId, observerId;
      const nextObs = prev.map(o => {
        if (o.id !== obsId) return o;
        const next = { ...o, [side === 'observer' ? 'observerConfirmed' : 'observeeConfirmed']: true };
        if (next.observerConfirmed && next.observeeConfirmed && o.status !== 'Completed') {
          next.status = 'Completed';
          justCompleted = true;
          observeeId = o.observeeId;
          observerId = o.observerId;
        } else {
          next.status = 'Awaiting Confirmation';
        }
        return next;
      });

      if (justCompleted) {
        const completionNotifs = [
          { id: Math.random().toString(), recipientId: observeeId, message: `Observation Completed: Both parties successfully confirmed the observation!`, read: false, timestamp: new Date().toLocaleDateString() },
          { id: Math.random().toString(), recipientId: observerId, message: `Observation Completed: Both parties successfully confirmed the observation!`, read: false, timestamp: new Date().toLocaleDateString() }
        ];
        setGlobalNotifications(n => [...(n || []), ...completionNotifs]);
      }
      return nextObs;
    });
    return true;
  }

  const handleSendRequest = (observer) => {
    const newRequest = {
      id: Date.now(), observeeId: user.professor_id, observeeName: user.name,
      observerId: observer.professor_id, observerName: observer.name,
      courseCode: mySignup.courseCode, timing: mySignup.timing, status: 'Pending'
    };
    setGlobalRequests([...(globalRequests || []), newRequest]);
    setGlobalNotifications(prev => [...(prev || []), {
      id: Math.random().toString(), recipientId: observer.professor_id,
      message: `${user.name} sent you a request to observe ${mySignup.courseCode}.`,
      read: false, timestamp: new Date().toLocaleDateString()
    }]);
    alert(`Request Sent to ${observer.name}!`);
  };

  const handleObserverAction = (reqId, action) => {
    const req = globalRequests.find(r => r.id === reqId);
    if (!req) return;
    setGlobalRequests(globalRequests.map(r => r.id === reqId ? { ...r, status: action } : r));
    setGlobalNotifications(prev => [...(prev || []), {
      id: Math.random().toString(), recipientId: req.observeeId,
      message: `${user.name} has ${action.toLowerCase()} your request to observe ${req.courseCode}.`,
      read: false, timestamp: new Date().toLocaleDateString()
    }]);
  };

  const handleFinalConfirm = (acceptedRequest) => {
    const newObservation = {
      id: Date.now(), observeeId: user.professor_id, observeeName: user.name,
      observerId: acceptedRequest.observerId, observerName: acceptedRequest.observerName,
      courseCode: acceptedRequest.courseCode, timing: acceptedRequest.timing,
      status: 'Pending Scheduling',
      scheduledDate: null, observerConfirmed: false, observeeConfirmed: false,
    };
    setGlobalObservations(prev => [...(prev || []), newObservation]);

    const newNotifs = [];
    newNotifs.push({
      id: Math.random().toString(), recipientId: acceptedRequest.observerId,
      message: `${user.name} confirmed you as their official observer for ${acceptedRequest.courseCode}! They will set a specific date soon.`,
      read: false, timestamp: new Date().toLocaleDateString()
    });

    (globalRequests || []).forEach(req => {
      if (req.observeeId === user.professor_id && req.id !== acceptedRequest.id && req.status === 'Accepted') {
        newNotifs.push({
          id: Math.random().toString(36).substr(2, 9), recipientId: req.observerId,
          message: `${user.name} finalized their observer match. Your offer to observe ${req.courseCode} was respectfully declined. Thank you for volunteering!`,
          read: false, timestamp: new Date().toLocaleDateString()
        });
      }
    });

    setGlobalNotifications(prev => [...(prev || []), ...newNotifs]);
    setGlobalRequests(globalRequests.map(req => 
      req.observeeId === user.professor_id ? { ...req, status: req.id === acceptedRequest.id ? 'Confirmed' : 'Cancelled' } : req
    ));
    alert(`${acceptedRequest.observerName} is confirmed! Please set the specific observation date.`);
  };

  const handleScheduleDate = (obsId, dateStr, timeStr) => {
    const obs = (globalObservations || []).find(o => o.id === obsId);
    if (!obs) return;

    // VALIDATION: date must be a day the class meets and time must be the class meeting time
    const slotError = validateObservationSlot(dateStr, timeStr, obs.timing, {
      minDate: todayLocalISO(),
      maxDate: globalDeadlines?.observation || undefined,
    });
    if (slotError) { alert(slotError); return; }

    setGlobalObservations(prev => prev.map(o => o.id === obsId ? { ...o, status: 'Scheduled', scheduledDate: dateStr, scheduledTime: timeStr } : o));

    const schedulingNotifs = [
      { id: Math.random().toString(), recipientId: obs.observeeId, message: `Meeting Set: Your observation with ${obs.observerName} is scheduled for ${dateStr} at ${timeStr} during class (${obs.timing}).`, read: false, timestamp: new Date().toLocaleDateString() },
      { id: Math.random().toString(), recipientId: obs.observerId, message: `Meeting Set: You are scheduled to observe ${obs.observeeName} on ${dateStr} at ${timeStr} during class (${obs.timing}).`, read: false, timestamp: new Date().toLocaleDateString() },
      { id: Math.random().toString(), recipientId: obs.observeeId, message: `Reminder: Your evaluation with ${obs.observerName} is coming up on ${dateStr} at ${timeStr}.`, read: false, timestamp: new Date().toLocaleDateString() },
      { id: Math.random().toString(), recipientId: obs.observerId, message: `Reminder: You have an upcoming observation duty for ${obs.observeeName} on ${dateStr} at ${timeStr}.`, read: false, timestamp: new Date().toLocaleDateString() }
    ];
    setGlobalNotifications(prev => [...(prev || []), ...schedulingNotifs]);
    alert("Date confirmed! Both parties have been notified and reminders are set.");
  };

  const handleSignup = () => {
    if (!selectedCourseId) { alert("Select a course first."); return; }
    const course = myCourses.find(c => c.section_id.toString() === selectedCourseId);
    const result = generateObserverMatches(user.professor_id, course.course_code, course.timing);
    setGlobalSignups(prev => [
      ...(prev || []).filter(s => s.observeeId !== user.professor_id),
      {
        id: Date.now(), observeeId: user.professor_id, observeeName: user.name,
        courseCode: course.course_code, section: course.section, timing: course.timing,
        matchesCount: result.matches.length, matchFlag: result.flag, eligibleObservers: result.matches
      }
    ]);
    alert("Signed up successfully! View your eligible observers on the Observee Status tab.");
    setActiveTab('observee-status');
  };

  const reportMissedObservation = (obsId) => {
    if (!window.confirm("Report that this observation did NOT take place?")) return;
    setGlobalObservations(prev => prev.map(o => o.id === obsId ? { ...o, status: 'Missed', missedReportedBy: user.name } : o));
  };

  const mySentRequests = (globalRequests || []).filter(req => req.observeeId === user?.professor_id);
  const myIncomingDuties = (globalRequests || []).filter(req => req.observerId === user?.professor_id);
  const myAssignedObservations = (globalObservations || []).filter(o => o.observerId === user?.professor_id);
  // NEW: Evaluations this professor submitted as an observer, and evaluations submitted about them as an observee
  const mySubmittedEvaluations = (globalEvaluations || []).filter(ev => ev.observerId === user?.professor_id);
  const evaluationsOfMe = (globalEvaluations || []).filter(ev => {
  const observeeId = ev.observeeId ?? (globalObservations || []).find(o => o.id === ev.observationId)?.observeeId;
  return observeeId === user?.professor_id;
});

  return (
    <div className="dashboard-layout">
      {toastNotif && (
        <div 
          onClick={() => { setActiveTab('notifications'); setToastNotif(null); }}
          style={{ position: 'fixed', top: '24px', right: '24px', background: 'white', borderLeft: '4px solid var(--utd-orange)', padding: '16px 20px', borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)', zIndex: 9999, cursor: 'pointer', maxWidth: '320px', transition: 'all 0.3s ease' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'center' }}>
            <strong style={{ color: '#0f172a', fontSize: '0.9rem' }}>New Notification ({unreadCount} pending)</strong>
            <span onClick={(e) => { e.stopPropagation(); setToastNotif(null); }} style={{ color: '#94a3b8', fontSize: '1.2rem', paddingLeft: '10px' }}>&times;</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {toastNotif?.message}
          </p>
        </div>
      )}
      <div className="sidebar premium-glass-dark">
        <div className="sidebar-header">
          <div className="logo-small">UTD</div>
          <div><h3>Professor Portal</h3><small>Assessment System</small></div>
        </div>
        <ul className="nav-menu">
          <NavItem id="home" icon={() => <span>🏠</span>} label="My Cycle" />
          <NavItem id="observee-status" icon={() => <span>👥</span>} label="Observee Status" />
          <NavItem id="observer-duties" icon={() => <span>✅</span>} label="My Duties" />
          <NavItem id="my-evaluations" icon={() => <span>📋</span>} label="My Evaluations" />
          <NavItem id="survey" icon={() => <span>📄</span>} label="End Survey" />
          <NavItem id="notifications" icon={() => <span>🔔</span>} label="Notifications" badge={unreadCount} />
          <li onClick={onLogout} className="logout-btn"><span>🚪</span> <span>Logout</span></li>
        </ul>
      </div>

      <div className="main-content">
        <header className="top-header premium-glass">
          <div className="header-title">
            <h2>Welcome back, {user?.name}</h2>
            <p>Spring 2027 Evaluation Cycle</p>
          </div>
          {/* Shows first + last name initials (e.g. "Dr. Alice Smith" -> "AS"); hover shows full name */}
          <div className="user-profile"><div className="avatar" title={user?.name || ''}>{getInitials(user?.name)}</div></div>
        </header>

        <div className="content-scroll">
          {activeTab === 'home' && (
            <div className="bento-grid">
              {(myStatus.status === 'Due' || myStatus.status === 'Overdue') && !mySignup && (
                <div className="bento-card" style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.8)' }}>
                  <h3 style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '10px' }}>Step 1: Course Sign-Up</h3>
                  <form style={{ marginTop: '1rem' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Select Course to be Observed</label>
                    <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                      <option value="">-- Choose a Course --</option>
                      {myCourses.map(c => (
                        <option key={c.section_id} value={c.section_id}>{c.course_code} Sec {c.section} ({c.timing})</option>
                      ))}
                    </select>
                    <button type="button" onClick={handleSignup} className="btn-primary btn-3d" style={{ marginTop: '15px' }}>Submit & Enter Observer Pool</button>
                  </form>
                </div>
              )}

              {mySignup && (
                <div className="bento-card" style={{ gridColumn: '1 / -1', background: '#f0fdf4', border: '1px solid #16a34a' }}>
                  <h3 style={{color: '#16a34a'}}>✓ Signed Up for {currentSemester}</h3>
                  <p>Course: {mySignup.courseCode} ({mySignup.timing}). Head to <strong>Observee Status</strong> to manage your observers.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'observee-status' && (
            <div className="bento-grid">
              {myConfirmedObservation ? (
                <div className="bento-card full-span" style={{borderLeft: '5px solid #10b981'}}>
                  <h3>Final Confirmed Observer</h3>
                  <p style={{ marginTop: '0.5rem', lineHeight: 1.6 }}>
                    <strong>{myConfirmedObservation.observerName}</strong> is confirmed to observe <strong>{myConfirmedObservation.courseCode} ({myConfirmedObservation.timing})</strong>.
                  </p>
                  <p style={{ marginTop: '0.75rem', marginBottom: '15px'}}>Status: <span className={`badge ${myConfirmedObservation.status === 'Completed' ? 'badge-success' : myConfirmedObservation.status === 'Missed' ? 'badge-error' : myConfirmedObservation.status === 'Scheduled' ? 'badge-neutral' : 'badge-warning'}`}>{myConfirmedObservation.status}</span></p>
                  
                  {myConfirmedObservation.status === 'Pending Scheduling' && (
                    <ScheduleObservationForm
                      observation={myConfirmedObservation}
                      observationDeadline={globalDeadlines?.observation}
                      onSchedule={handleScheduleDate}
                    />
                  )}

                  {myConfirmedObservation.scheduledDate && (
                    <p style={{ background: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '15px', fontWeight: '500' }}>
                      🗓️ Scheduled Date: <strong>{myConfirmedObservation.scheduledDate}</strong>
                      {myConfirmedObservation.scheduledTime && <> at <strong>{myConfirmedObservation.scheduledTime}</strong></>}
                    </p>
                  )}

                  {(myConfirmedObservation.status === 'Scheduled' || myConfirmedObservation.status === 'Awaiting Confirmation') && (
                    <div style={{padding: '15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '15px'}}>
                      <h4>Pair Confirmation & Status</h4>
                      <p style={{fontSize: '0.9rem', color: '#64748b', marginTop: '6px'}}>
                        Observer: {myConfirmedObservation.observerConfirmed ? '✓ Confirmed' : '✗ Not confirmed'}
                      </p>
                      <p style={{fontSize: '0.9rem', color: '#64748b', margin: '4px 0 10px'}}>
                        You: {myConfirmedObservation.observeeConfirmed ? '✓ Confirmed' : '✗ Not confirmed'}
                      </p>
                      
                      {!myConfirmedObservation.observeeConfirmed && myConfirmedObservation.status !== 'Deferred / Rolled Over' && (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px'}}>
                          <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                            <button className="btn-primary sm" onClick={() => confirmObservation(myConfirmedObservation.id, 'observee')}>I Was Observed</button>
                            <button className="btn-danger sm" onClick={() => reportMissedObservation(myConfirmedObservation.id)}>Did Not Happen</button>
                            <button className="btn-secondary sm" style={{background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a'}} onClick={() => setShowDeferForm(!showDeferForm)}>
                              {showDeferForm ? 'Cancel' : '⚠️ Could Not Complete Cycle'}
                            </button>
                          </div>

                          {showDeferForm && (
                            <div style={{background: 'white', padding: '15px', borderRadius: '6px', border: '1px solid #cbd5e1', marginTop: '10px'}}>
                              <label style={{display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '5px', color: '#0f172a'}}>
                                Provide Reasoning for Incompletion / Rollover
                              </label>
                              <textarea 
                                rows="3" 
                                value={deferReason} 
                                onChange={(e) => setDeferReason(e.target.value)} 
                                placeholder="e.g., Extended medical leave or scheduling conflicts prevented this observation..." 
                                style={{width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', marginBottom: '10px'}}
                              />
                              <button className="btn-danger sm" onClick={() => handleDeferObservation(myConfirmedObservation.id)}>
                                Submit Reason to Committee
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {myConfirmedObservation.status === 'Deferred / Rolled Over' && (
                    <div style={{padding: '15px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '15px'}}>
                      <h4 style={{color: '#b45309', marginBottom: '5px'}}>Status: Deferred / Rolled Over</h4>
                      <p style={{fontSize: '0.9rem', color: '#92400e', margin: 0}}>
                        Reason submitted: "{myConfirmedObservation.deferralReason}"
                      </p>
                      <small style={{color: '#b45309', display: 'block', marginTop: '5px'}}>The Assessment Committee has been notified of your reasoning.</small>
                    </div>
                  )}

                  {myConfirmedObservation.status === 'Missed' && (
                    <p style={{color: '#b91c1c', fontSize: '0.9rem'}}>This observation was reported as not held by {myConfirmedObservation.missedReportedBy}. Please contact the Assessment Committee.</p>
                  )}
                  {myConfirmedObservation.status === 'Completed' && (
                     <div style={{padding: '15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px'}}>
                        <h4>Observation Completed!</h4>
                        {isSurveyClosed ? (
                          <p style={{fontSize: '0.9rem', color: '#64748b', margin: 0}}>You and your observer both confirmed the observation. The survey deadline ({globalDeadlines.survey}) has passed.</p>
                        ) : (
                          <>
                            <p style={{fontSize: '0.9rem', color: '#64748b', marginBottom: '10px'}}>You and your observer both confirmed the observation. Please proceed to the final survey.</p>
                            <button className="btn-primary sm" onClick={() => setActiveTab('survey')}>Take Survey</button>
                          </>
                        )}
                     </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="bento-card full-span">
                    <h3>Step 2: Request Observers</h3>
                    {!mySignup ? <p>Please sign up on the My Cycle tab first.</p> : 
                      !isPastSignupDeadline ? (
                        <div style={{ textAlign: 'center', padding: '40px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '10px' }}>⏳</div>
                          <h4 style={{ color: '#0f172a', marginBottom: '5px' }}>List Hidden</h4>
                          <p style={{ color: '#64748b', fontSize: '1rem', fontWeight: '500' }}>
                            Potential observers will show up once the Signup Deadline ({globalDeadlines?.signup || 'TBD'}) passes.
                          </p>
                        </div>
                      ) : !mySignup.listReleased ? (
                        <div style={{ textAlign: 'center', padding: '40px', background: '#fffbeb', borderRadius: '12px', border: '1px dashed #fde68a' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '10px' }}>🔒</div>
                          <h4 style={{ color: '#b45309', marginBottom: '5px' }}>Pending Committee Approval</h4>
                          <p style={{ color: '#92400e', fontSize: '1rem', fontWeight: '500' }}>
                            Waiting for the Assessment Committee to review and release your list of potential observers. You will be notified.
                          </p>
                        </div>
                      ) : (
                      <div className="modern-table-wrapper">
                        <table className="data-table">
                          <thead><tr><th>Colleague</th><th>Action</th></tr></thead>
                          <tbody>
                            {mySignup.eligibleObservers?.length === 0 ? (
                              <tr><td colSpan="2" style={{textAlign: 'center', padding: '20px'}}>No eligible observers found.</td></tr>
                            ) : (
                              (mySignup.eligibleObservers || []).map(observer => {
                                const hasRequested = mySentRequests.some(req => req.observerId === observer.professor_id);
                                return (
                                  <tr key={observer.professor_id}>
                                    <td><strong>{observer.name}</strong></td>
                                    <td>{hasRequested ? <span className="badge badge-warning">Request Sent</span> : <button className="btn-secondary btn-3d sm" onClick={() => handleSendRequest(observer)}>Send Request</button>}</td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="bento-card full-span">
                    <h3>Step 3: Track & Confirm</h3>
                    <div className="modern-table-wrapper">
                      <table className="data-table">
                        <thead><tr><th>Observer</th><th>Status</th><th>Final Action</th></tr></thead>
                        <tbody>
                          {mySentRequests.length === 0 ? <tr><td colSpan="3" style={{textAlign: 'center'}}>No requests sent yet.</td></tr> : (
                            mySentRequests.map(req => (
                              <tr key={req.id}>
                                <td><strong>{req.observerName}</strong></td>
                                <td>
                                  {req.status === 'Pending' && <span className="badge badge-warning">Pending</span>}
                                  {req.status === 'Accepted' && <span className="badge badge-success">Accepted</span>}
                                  {req.status === 'Declined' && <span className="badge badge-danger" style={{background: '#ef4444', color:'white'}}>Declined</span>}
                                  {req.status === 'Cancelled' && <span>Cancelled</span>}
                                </td>
                                <td>
                                  {req.status === 'Accepted' && <button className="btn-primary sm" onClick={() => handleFinalConfirm(req)}>Confirm Final Match</button>}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'observer-duties' && (
            <div className="bento-grid">
              <div className="bento-card full-span">
                <h3>Incoming Observation Requests</h3>
                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Requesting Professor</th><th>Course to Observe</th><th>Status/Action</th></tr></thead>
                    <tbody>
                      {myIncomingDuties.filter(r => r.status === 'Pending').length === 0 ? (
                        <tr><td colSpan="3" style={{textAlign: 'center'}}>No pending duties.</td></tr>
                      ) : (
                        myIncomingDuties.filter(r => r.status === 'Pending').map(req => (
                          <tr key={req.id}>
                            <td><strong>{req.observeeName}</strong></td>
                            <td>{req.courseCode} ({req.timing})</td>
                            <td>
                              <div style={{display: 'flex', gap: '10px'}}>
                                <button className="btn-success btn-3d sm" onClick={() => handleObserverAction(req.id, 'Accepted')}>Accept</button>
                                <button className="btn-danger btn-3d sm" onClick={() => handleObserverAction(req.id, 'Declined')}>Decline</button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bento-card full-span">
                <h3>My Confirmed Observation Appointments</h3>
                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Observee</th><th>Course</th><th>Time</th><th>Status & Action</th></tr></thead>
                    <tbody>
                      {myAssignedObservations.length === 0 ? (
                        <tr><td colSpan="4" style={{textAlign: 'center'}}>No confirmed duties.</td></tr>
                      ) : (
                        myAssignedObservations.map(obs => {
                          // VALIDATION: "Evaluation Completed" is locked until the evaluation form is submitted
                          const hasSubmittedEvaluation = (globalEvaluations || []).some(e => e.observationId === obs.id);
                          return (
                          <tr key={obs.id}>
                            <td><strong>{obs.observeeName}</strong></td>
                            <td style={{ whiteSpace: 'nowrap' }}>{obs.courseCode}</td>
                            <td>
                              <div style={{ whiteSpace: 'nowrap' }}>{obs.timing}</div>
                              {obs.scheduledDate && (
                                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px', whiteSpace: 'nowrap' }}>
                                  🗓️ {obs.scheduledDate}{obs.scheduledTime ? ` at ${obs.scheduledTime}` : ''}
                                </div>
                              )}
                            </td>
                            <td>
                              {obs.status === 'Missed' ? (
                                <span className="badge badge-error">Missed</span>
                              ) : obs.status === 'Completed' ? (
                                <span className="badge badge-success">Completed</span>
                              ) : obs.observerConfirmed ? (
                                <span className="badge badge-warning">Awaiting observee confirmation</span>
                              ) : (
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: '10px'}}>
                                  {hasSubmittedEvaluation ? (
                                    <span className="badge badge-success">✓ Evaluation Submitted</span>
                                  ) : isPastObservationDeadline ? (
                                    <span className="badge badge-error" style={{ padding: '8px', fontSize: '0.85rem' }}>🔒 Deadline Passed</span>
                                  ) : (
                                    <button 
                                      className="btn-secondary sm" 
                                      style={{background: '#f0f9ff', color: '#0284c7', border: '1px solid #bae6fd', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'}} 
                                      onClick={() => openEvaluation(obs)}
                                    >
                                      {evaluationDrafts?.[obs.id] ? '📝 Continue Evaluation' : '📝 Begin Evaluation'}
                                    </button>
                                  )}
                                  
                                  <button
                                    className="btn-primary sm"
                                    disabled={!hasSubmittedEvaluation || isPastObservationDeadline}
                                    title={isPastObservationDeadline ? 'Observation deadline has passed' : hasSubmittedEvaluation ? '' : 'Submit the evaluation form (Begin Evaluation) first'}
                                    style={{padding: '5px 10px', borderRadius: '4px', opacity: (hasSubmittedEvaluation && !isPastObservationDeadline) ? 1 : 0.5, cursor: (hasSubmittedEvaluation && !isPastObservationDeadline) ? 'pointer' : 'not-allowed'}}
                                    onClick={() => {
                                      if (!confirmObservation(obs.id, 'observer')) return;
                                      alert("Observation confirmed. It will be marked Completed once the observee also confirms.");
                                    }}
                                  >Evaluation Completed</button>

                                  <button className="btn-danger sm" style={{background: '#ef4444', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px'}} onClick={() => reportMissedObservation(obs.id)}>Did Not Happen</button>

                                  {!hasSubmittedEvaluation && !isPastObservationDeadline && (
                                    <small style={{ width: '100%', color: '#64748b', fontSize: '0.8rem' }}>
                                      {evaluationDrafts?.[obs.id] ? `Draft saved ${evaluationDrafts[obs.id].savedAt}. ` : ''}Complete the evaluation form before marking it completed.
                                    </small>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'live-evaluation' && activeEvaluationTarget && (
            <div className="bento-grid">
              <div className="bento-card full-span">
                <div className="card-header-flex" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '15px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.4rem', color: 'var(--utd-green)' }}>Live Observation: {activeEvaluationTarget.observeeName}</h3>
                    <p className="subtitle" style={{ marginTop: '5px' }}>Evaluating {activeEvaluationTarget.courseCode} ({activeEvaluationTarget.timing})</p>
                    {evaluationDrafts?.[activeEvaluationTarget.id] && (
                      <small style={{ color: '#64748b' }}>Last saved: {evaluationDrafts[activeEvaluationTarget.id].savedAt}</small>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" className="btn-secondary sm" onClick={handleCancelEvaluation}>Cancel & Return</button>
                    <button type="button" className="btn-success sm" onClick={handleSaveDraft}>💾 Save & Return</button>
                  </div>
                </div>

                <form className="modern-form" onSubmit={(e) => {
                  e.preventDefault();
                  const activeItems = (evaluationTemplate || []).filter(item => !item.effective || item.effective === currentSemester);
                  setGlobalEvaluations(prev => [...(prev || []), {
                    id: Date.now(), observationId: activeEvaluationTarget.id,
                    observerId: user.professor_id, observerName: user.name,
                    observeeId: activeEvaluationTarget.observeeId,
                    observeeName: activeEvaluationTarget.observeeName, courseCode: activeEvaluationTarget.courseCode,
                    timing: activeEvaluationTarget.timing,
                    dateSubmitted: new Date().toLocaleDateString(),
                    // Snapshot of the criteria as they were when submitted (so later template edits don't alter this form)
                    items: activeItems.map(({ id, criteria, ratingScale }) => ({ id, criteria, ratingScale })),
                    answers: evalAnswers
                  }]);
                  // NEW: Notify the submitter (observer) and the observee that the evaluation was submitted
                  setGlobalNotifications(prev => [...(prev || []),
                    { id: Math.random().toString(), recipientId: user.professor_id, message: `Evaluation Submitted: Your evaluation of ${activeEvaluationTarget.observeeName} (${activeEvaluationTarget.courseCode}) was submitted successfully. You can view it under My Evaluations.`, read: false, timestamp: new Date().toLocaleDateString() },
                    { id: Math.random().toString(), recipientId: activeEvaluationTarget.observeeId, message: `Evaluation Received: ${user.name} submitted the evaluation for your ${activeEvaluationTarget.courseCode} class. You can view it under My Evaluations.`, read: false, timestamp: new Date().toLocaleDateString() }
                  ]);
                  // Submitted, so the saved draft is no longer needed
                  setEvaluationDrafts(prev => { const next = { ...prev }; delete next[activeEvaluationTarget.id]; return next; });
                  alert("Digital evaluation successfully recorded and sent to the Committee!");
                  closeEvaluation();
                }}>
                  {(evaluationTemplate || []).filter(item => !item.effective || item.effective === currentSemester).map((item, index) => (
                    <div key={item.id} style={{ marginBottom: '30px', paddingBottom: '25px', borderBottom: '1px solid #f1f5f9' }}>
                      <label style={{ fontSize: '1.1rem', marginBottom: '15px', display: 'block', color: '#0f172a' }}>
                        <strong>{index + 1}.</strong> {item.criteria}
                      </label>
                      
                      <div style={{ marginBottom: '15px', paddingLeft: '20px' }}>
                        {getRatingLegend(item.ratingScale) && (
                          <p className="rating-legend">{getRatingLegend(item.ratingScale)}</p>
                        )}
                        {item.ratingScale.includes('1 to 5') && (
                          <div className="radio-group" style={{ display: 'flex', gap: '20px' }}>
                            {[1, 2, 3, 4, 5].map(num => (
                              <label key={num} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500', cursor: 'pointer' }}>
                                <input type="radio" name={`rating-${item.id}`} value={num} required checked={evalAnswers[item.id]?.rating === String(num)} onChange={(e) => updateEvalAnswer(item.id, 'rating', e.target.value)} style={{ width: '18px', height: '18px', accentColor: 'var(--utd-green)' }} /> {num}
                              </label>
                            ))}
                          </div>
                        )}
                        
                        {item.ratingScale.includes('Yes / No') && (
                          <div className="radio-group" style={{ display: 'flex', gap: '20px' }}>
                            {['Yes', 'No', 'N/A'].map(opt => (
                              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500', cursor: 'pointer' }}>
                                <input type="radio" name={`rating-${item.id}`} value={opt} required checked={evalAnswers[item.id]?.rating === opt} onChange={(e) => updateEvalAnswer(item.id, 'rating', e.target.value)} style={{ width: '18px', height: '18px', accentColor: 'var(--utd-green)' }} /> {opt}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      <div style={{ paddingLeft: '20px' }}>
                        <textarea placeholder="Observer notes and feedback..." rows="3" required value={evalAnswers[item.id]?.notes || ''} onChange={(e) => updateEvalAnswer(item.id, 'notes', e.target.value)} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}></textarea>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '30px' }}>
                    <button type="submit" className="btn-primary btn-3d" style={{ padding: '12px 30px', fontSize: '1.1rem' }}>Submit Digital Evaluation</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'my-evaluations' && (
            <div className="bento-grid">
              {viewingEvaluation ? (
                <EvaluationDetail evaluation={viewingEvaluation} evaluationTemplate={evaluationTemplate} onBack={() => setViewingEvaluation(null)} />
              ) : (
                <>
                  <div className="bento-card full-span">
                    <h3>Evaluations I Submitted (as Observer)</h3>
                    <div className="modern-table-wrapper">
                      <table className="data-table nowrap-table">
                        <thead><tr><th>Date Submitted</th><th>Observee</th><th>Course</th><th>Action</th></tr></thead>
                        <tbody>
                          {mySubmittedEvaluations.length === 0 ? (
                            <tr><td colSpan="4" style={{ textAlign: 'center' }}>You haven't submitted any evaluations yet.</td></tr>
                          ) : mySubmittedEvaluations.slice().reverse().map(ev => (
                            <tr key={ev.id}>
                              <td>{ev.dateSubmitted}</td>
                              <td><strong>{ev.observeeName}</strong></td>
                              <td>{ev.courseCode}</td>
                              <td><button type="button" className="btn-secondary sm" onClick={() => setViewingEvaluation(ev)}>View Form</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bento-card full-span">
                    <h3>Evaluations of My Teaching (as Observee)</h3>
                    <div className="modern-table-wrapper">
                      <table className="data-table nowrap-table">
                        <thead><tr><th>Date Submitted</th><th>Observer</th><th>Course</th><th>Action</th></tr></thead>
                        <tbody>
                          {evaluationsOfMe.length === 0 ? (
                            <tr><td colSpan="4" style={{ textAlign: 'center' }}>No evaluations have been submitted for you yet.</td></tr>
                          ) : evaluationsOfMe.slice().reverse().map(ev => (
                            <tr key={ev.id}>
                              <td>{ev.dateSubmitted}</td>
                              <td><strong>{ev.observerName}</strong></td>
                              <td>{ev.courseCode}</td>
                              <td><button type="button" className="btn-secondary sm" onClick={() => setViewingEvaluation(ev)}>View Form</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="bento-grid">
              <div className="bento-card full-span">
                <div className="card-header-flex" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>My Notifications</h3>
                    <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
                      <button className="btn-secondary sm" style={{ border: 'none', background: notifTab === 'inbox' ? 'white' : 'transparent', boxShadow: notifTab === 'inbox' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', color: notifTab === 'inbox' ? '#0f172a' : '#64748b' }} onClick={() => setNotifTab('inbox')}>Inbox ({unreadCount})</button>
                      <button className="btn-secondary sm" style={{ border: 'none', background: notifTab === 'archive' ? 'white' : 'transparent', boxShadow: notifTab === 'archive' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', color: notifTab === 'archive' ? '#0f172a' : '#64748b' }} onClick={() => setNotifTab('archive')}>Archive</button>
                    </div>
                  </div>
                  {unreadCount > 0 && notifTab === 'inbox' && (
                    <button className="btn-secondary sm" onClick={() => {
                      setGlobalNotifications((globalNotifications || []).map(n => n.recipientId === user.professor_id ? { ...n, read: true } : n));
                    }}>Move All to Archive</button>
                  )}
                </div>
                
                {myNotifications.filter(n => notifTab === 'inbox' ? !n.read : n.read).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📭</div>
                    <p style={{ color: '#64748b' }}>{notifTab === 'inbox' ? "You're all caught up!" : "No archived notifications."}</p>
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {myNotifications.filter(n => notifTab === 'inbox' ? !n.read : n.read).slice().reverse().map(notif => (
                      <li key={notif.id} style={{ padding: '16px 20px', marginBottom: '10px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: '1.5rem' }}>{notifTab === 'inbox' ? '📬' : '🗄️'}</div>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, color: '#0f172a', fontWeight: notifTab === 'inbox' ? '700' : '500' }}>{notif.message}</p>
                          <small style={{ color: '#64748b', marginTop: '5px', display: 'block' }}>{notif.timestamp}</small>
                        </div>
                        {notifTab === 'inbox' && (
                          <button className="btn-secondary sm" style={{ padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => {
                            setGlobalNotifications((globalNotifications || []).map(n => n.id === notif.id ? { ...n, read: true } : n));
                          }}>Archive</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {activeTab === 'survey' && (
            <FeedbackSurvey hasSubmitted={hasSubmittedSurvey} onSubmit={onSurveySubmit} isClosed={isSurveyClosed} deadline={globalDeadlines?.survey} />
          )}
        </div>
      </div>
    </div>
  );
}