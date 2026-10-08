import React, { useState } from 'react';
import { generateObserverMatches } from './matchmaker.js';
import './App.css';
import FeedbackSurvey from './FeedbackSurvey.jsx';
import AdminSurveyResults from './AdminSurveyResults.jsx';
// BIG FIX: Added the missing imports here!
import { mockProfessors, mockAdmins, mockCourses, calculateEvaluationStatus, currentSemester, initialDeadlines } from './mockDatabase.js';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  
  // GLOBAL STATE
  const [globalRequests, setGlobalRequests] = useState([]);
  const [surveySubmissions, setSurveySubmissions] = useState([]);
  const [surveyResponses, setSurveyResponses] = useState([]);
  const [globalSignups, setGlobalSignups] = useState([]);
  const [globalObservations, setGlobalObservations] = useState([]);
  const [globalDeadlines, setGlobalDeadlines] = useState(initialDeadlines);

  const handleSurveySubmit = (professorId, answers) => {
    if (surveySubmissions.some(s => s.professor_id === professorId)) return;
      setSurveySubmissions(prev => [...prev, { professor_id: professorId }]);
      setSurveyResponses(prev => [...prev, { response_id: crypto.randomUUID(), ...answers }]);
  };

  const completedRequiredSurveys = surveySubmissions.filter(sub =>
    globalSignups.some(signup => signup.observeeId === sub.professor_id)).length;

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
        globalDeadlines={globalDeadlines}
        setGlobalDeadlines={setGlobalDeadlines}
        completedRequiredSurveys={completedRequiredSurveys}
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
      /* BIG FIX: Passed these down so your dashboard can use them! */
      globalObservations={globalObservations}
      setGlobalObservations={setGlobalObservations}
      hasSubmittedSurvey={surveySubmissions.some(s => s.professor_id === currentUser.professor_id)}
      onSurveySubmit={(answers) => handleSurveySubmit(currentUser.professor_id, answers)}
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
function AdminDashboard({ user, onLogout, globalSignups, globalRequests, globalObservations, globalDeadlines, setGlobalDeadlines, surveyResponses, submittedCount, totalProfessors, completedRequiredSurveys }) {
  const [activeTab, setActiveTab] = useState('metrics');

  const allFacultyStatus = mockProfessors.map(prof => ({
    ...prof,
    ...calculateEvaluationStatus(prof)
  }));

  const dueFaculty = allFacultyStatus.filter(f => f.status === 'Due' || f.status === 'Overdue');
  const overdueFaculty = allFacultyStatus.filter(f => f.status === 'Overdue');

  const NavItem = ({ id, label }) => (
    <li className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
      <span>{label}</span>
    </li>
  );

  return (
    <div className="dashboard-layout">
      <div className="sidebar premium-glass-dark" style={{ background: '#1e293b' }}>
        <div className="sidebar-header"><div className="logo-small">AC</div><div><h3>Committee</h3><small>Executive Portal</small></div></div>
        <ul className="nav-menu">
          <NavItem id="metrics" label="📊 Live Metrics & KPIs" />
          <NavItem id="faculty" label="👥 Due / Overdue Faculty" />
          <NavItem id="signups" label="📝 Signup & Matching Monitor" />
          <NavItem id="deadlines" label="📅 Deadline Management" />
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
            <div>
              <h3>Real-Time Operational Metrics</h3>
              <div className="bento-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="bento-card" style={{ textAlign: 'center', background: '#3b82f6', color: 'white' }}>
                  <h4>Total Faculty Due</h4><h1 style={{ margin: '10px 0 0 0', fontSize: '2.5rem' }}>{dueFaculty.length}</h1>
                </div>
                <div className="bento-card" style={{ textAlign: 'center', background: '#8b5cf6', color: 'white' }}>
                  <h4>Total Signups</h4><h1 style={{ margin: '10px 0 0 0', fontSize: '2.5rem' }}>{globalSignups.length}</h1>
                </div>
                <div className="bento-card" style={{ textAlign: 'center', background: '#f59e0b', color: 'white' }}>
                  <h4>Confirmed Observations</h4><h1 style={{ margin: '10px 0 0 0', fontSize: '2.5rem' }}>{globalObservations.length}</h1>
                </div>
                <div className="bento-card" style={{ textAlign: 'center', background: '#10b981', color: 'white' }}>
                  <h4>Completed Observations</h4><h1 style={{ margin: '10px 0 0 0', fontSize: '2.5rem' }}>{globalObservations.filter(o => o.status === 'Completed').length}</h1>
                </div>
                <div className="bento-card" style={{ textAlign: 'center', background: '#ef4444', color: 'white' }}>
                  <h4>Survey Complete Rate</h4>
                  <h1 style={{ margin: '10px 0 0 0', fontSize: '2.5rem' }}>
                    {/*will use surveyResponse.length later for numerator*/}
                    {globalSignups.length ? Math.round((completedRequiredSurveys / globalSignups.length) * 100) : 0}%
                  </h1>
                </div>
              </div>
              
              {/* TEAMMATE HANDOFF POINT FOR ANALYTICS */}
              <div className="bento-card" style={{ marginTop: '20px', border: '2px dashed #94a3b8', background: '#f8fafc' }}>
                <h3 style={{color: '#64748b'}}>Teammate Integration Zone: Executive KPIs</h3>
                <p style={{color: '#64748b', fontSize: '0.9rem'}}>*Survey participation metrics, utilization KPIs, and executive reporting components will be injected here.*</p>
              </div>
            </div>
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
              <h3>Signup & Matching Monitor</h3>
              <table className="data-table">
                <thead><tr><th>Observee</th><th>Course</th><th>Matches Found</th><th>Match Status</th><th>Confirmed Observer</th></tr></thead>
                <tbody>
                  {globalSignups.length === 0 ? <tr><td colSpan="5" style={{textAlign: 'center'}}>No signups yet.</td></tr> : 
                    globalSignups.map(signup => {
                      const obs = globalObservations.find(o => o.observeeId === signup.observeeId);
                      return (
                        <tr key={signup.id}>
                          <td><strong>{signup.observeeName}</strong></td><td>{signup.courseCode}</td>
                          <td>{signup.matchesCount} Observers</td>
                          <td>
                            {signup.matchFlag === 'NO ELIGIBLE OBSERVER' && <span className="badge badge-danger" style={{background: '#ef4444', color:'white'}}>No Eligible Observer</span>}
                            {signup.matchFlag === 'INSUFFICIENT OBSERVERS' && <span className="badge badge-warning">Insufficient Observers</span>}
                            {signup.matchFlag === 'OK' && <span className="badge badge-success">OK</span>}
                          </td>
                          <td>{obs ? <strong>{obs.observerName}</strong> : <span style={{color: '#94a3b8'}}>Pending</span>}</td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
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
function ProfessorDashboard({ user, onLogout, globalRequests, setGlobalRequests, hasSubmittedSurvey, onSurveySubmit, globalSignups, setGlobalSignups, globalObservations, setGlobalObservations }) {
  const [activeTab, setActiveTab] = useState('home');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  
  const myStatus = calculateEvaluationStatus(user);
  const myCourses = mockCourses.filter(c => c.instructor_id === user.professor_id);
  const mySignup = globalSignups.find(s => s.observeeId === user.professor_id);
  const myConfirmedObservation = globalObservations?.find(o => o.observeeId === user.professor_id);

  const NavItem = ({ id, icon: Icon, label }) => (
    <li className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
      <Icon /> <span>{label}</span>
    </li>
  );

  const handleSignup = () => {
    if (!selectedCourseId) { alert("Select a course first."); return; }
    const course = myCourses.find(c => c.section_id.toString() === selectedCourseId);
    
    const result = generateObserverMatches(user.professor_id, course.course_code, course.timing);
    
    setGlobalSignups(prev => [
      ...prev.filter(s => s.observeeId !== user.professor_id),
      {
        id: Date.now(),
        observeeId: user.professor_id,
        observeeName: user.name,
        courseCode: course.course_code,
        section: course.section,
        timing: course.timing,
        matchesCount: result.matches.length,
        matchFlag: result.flag,
        eligibleObservers: result.matches
      }
    ]);

    alert("Signed up successfully! View your eligible observers on the Observee Status tab.");
    setActiveTab('observee-status');
  };

  const handleSendRequest = (observer) => {
    const newRequest = {
      id: Date.now(),
      observeeId: user.professor_id, observeeName: user.name,
      observerId: observer.professor_id, observerName: observer.name,
      courseCode: mySignup.courseCode, timing: mySignup.timing,
      status: 'Pending'
    };
    setGlobalRequests([...globalRequests, newRequest]);
    alert(`Request Sent to ${observer.name}!`);
  };

  const handleObserverAction = (reqId, action) => {
    setGlobalRequests(globalRequests.map(req => req.id === reqId ? { ...req, status: action } : req));
  };

  const handleFinalConfirm = (acceptedRequest) => {
    const newObservation = {
      id: Date.now(),
      observeeId: user.professor_id, observeeName: user.name,
      observerId: acceptedRequest.observerId, observerName: acceptedRequest.observerName,
      courseCode: acceptedRequest.courseCode, timing: acceptedRequest.timing,
      status: 'Scheduled',
    };
    setGlobalObservations(prev => [...(prev || []), newObservation]);

    setGlobalRequests(globalRequests.map(req => 
      req.observeeId === user.professor_id ? { ...req, status: req.id === acceptedRequest.id ? 'Confirmed' : 'Cancelled' } : req
    ));
    alert(`${acceptedRequest.observerName} is now confirmed as your observer!`);
  };

  const mySentRequests = globalRequests.filter(req => req.observeeId === user.professor_id);
  const myIncomingDuties = globalRequests.filter(req => req.observerId === user.professor_id);
  const myAssignedObservations = globalObservations?.filter(o => o.observerId === user.professor_id) || [];

  return (
    <div className="dashboard-layout">
      <div className="sidebar premium-glass-dark">
        <div className="sidebar-header">
          <div className="logo-small">UTD</div>
          <div><h3>Professor Portal</h3><small>Assessment System</small></div>
        </div>
        <ul className="nav-menu">
          <NavItem id="home" icon={() => <span>🏠</span>} label="My Cycle" />
          <NavItem id="observee-status" icon={() => <span>👥</span>} label="Observee Status" />
          <NavItem id="observer-duties" icon={() => <span>✅</span>} label="My Duties" />
          <NavItem id="survey" icon={() => <span>📄</span>} label="End Survey" />
          <li onClick={onLogout} className="logout-btn"><span>🚪</span> <span>Logout</span></li>
        </ul>
      </div>

      <div className="main-content">
        <header className="top-header premium-glass">
          <div className="header-title">
            <h2>Welcome back, {user.name}</h2>
            <p>Spring 2027 Evaluation Cycle</p>
          </div>
          <div className="user-profile"><div className="avatar">{user.name.charAt(4)}</div></div>
        </header>

        <div className="content-scroll">
          {activeTab === 'home' && (
            <div className="bento-grid">
              <div className="bento-card highlight-card">
                <div className="card-icon">!</div>
                <div>
                  <h3>Evaluation Status: {myStatus.status === 'Overdue' ? <span style={{color: '#ef4444'}}>OVERDUE</span> : myStatus.status}</h3>
                  <p>Last Evaluated: <strong>{user.last_evaluation || 'Never'}</strong> | Next Due: <strong>{myStatus.next_eval}</strong></p>
                </div>
              </div>
              
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
                  <p><strong>{myConfirmedObservation.observerName}</strong> is confirmed to observe <strong>{myConfirmedObservation.courseCode}</strong> on {myConfirmedObservation.timing}.</p>
                  <p style={{marginBottom: '15px'}}>Status: <span className="badge badge-success">{myConfirmedObservation.status}</span></p>
                  
                  {myConfirmedObservation.status === 'Completed' && (
                     <div style={{padding: '15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px'}}>
                        <h4>Observation Completed!</h4>
                        <p style={{fontSize: '0.9rem', color: '#64748b', marginBottom: '10px'}}>The observer has completed their observation. Please proceed to the final survey.</p>
                        <button className="btn-primary sm" onClick={() => setActiveTab('survey')}>Take Survey</button>
                     </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="bento-card full-span">
                    <h3>Step 2: Request Observers</h3>
                    {!mySignup ? <p>Please sign up on the My Cycle tab first.</p> : (
                      <div className="modern-table-wrapper">
                        <table className="data-table">
                          <thead><tr><th>Colleague</th><th>Action</th></tr></thead>
                          <tbody>
                            {mySignup.eligibleObservers.length === 0 ? (
                              <tr><td colSpan="2" style={{textAlign: 'center', padding: '20px'}}>No eligible observers found.</td></tr>
                            ) : (
                              mySignup.eligibleObservers.map(observer => {
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
                                <button className="btn-primary sm" onClick={() => handleObserverAction(req.id, 'Accepted')} style={{background: '#16a34a', border: 'none', color: 'white', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer'}}>Accept</button>
                                <button className="btn-danger sm" onClick={() => handleObserverAction(req.id, 'Declined')} style={{background: '#ef4444', border: 'none', color: 'white', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer'}}>Decline</button>
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
                    <thead><tr><th>Observee</th><th>Course</th><th>Time</th><th>Status & Upload</th></tr></thead>
                    <tbody>
                      {myAssignedObservations.length === 0 ? (
                        <tr><td colSpan="4" style={{textAlign: 'center'}}>No confirmed duties.</td></tr>
                      ) : (
                        myAssignedObservations.map(obs => (
                          <tr key={obs.id}>
                            <td><strong>{obs.observeeName}</strong></td>
                            <td>{obs.courseCode}</td>
                            <td>{obs.timing}</td>
                            <td>
                              {obs.status === 'Scheduled' ? (
                                <button className="btn-primary sm" onClick={() => {
                                  setGlobalObservations(globalObservations.map(o => o.id === obs.id ? {...o, status: 'Completed'} : o));
                                  alert("Observation marked Completed! Taking you to the final survey.");
                                  setActiveTab('survey');
                                }}>Upload Form & Complete</button>
                              ) : <span className="badge badge-success">Completed</span>}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'survey' && (
            <FeedbackSurvey hasSubmitted={hasSubmittedSurvey} onSubmit={onSurveySubmit} />
          )}
        </div>
      </div>
    </div>
  );
}