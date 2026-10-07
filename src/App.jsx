import React, { useState } from 'react';
import { mockProfessors } from './mockDatabase.js';
import { generateObserverMatches } from './matchmaker.js';
import './App.css';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  
  // GLOBAL STATE: This holds the requests so they don't disappear when you log out
  const [globalRequests, setGlobalRequests] = useState([]);

  if (!currentUser) return <Login onLogin={setCurrentUser} />;
  
  return (
    <ProfessorDashboard 
      user={currentUser} 
      onLogout={() => setCurrentUser(null)} 
      globalRequests={globalRequests}
      setGlobalRequests={setGlobalRequests}
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
    const user = mockProfessors.find(p => p.username === username);
    
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
          asmith / bjones / cwhite / dbrown &nbsp;·&nbsp; password: 123
        </div>
      </div>
    </div>
  );
}

/* =========================================
   PROFESSOR DASHBOARD 
========================================= */
function ProfessorDashboard({ user, onLogout, globalRequests, setGlobalRequests }) {
  const [activeTab, setActiveTab] = useState('home');
  const [matchedObservers, setMatchedObservers] = useState([]); 
  
  // Input states for dynamic generation
  const [courseInput, setCourseInput] = useState('');
  const [timeInput, setTimeInput] = useState('');

  const NavItem = ({ id, icon: Icon, label }) => (
    <li className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
      <Icon /> <span>{label}</span>
    </li>
  );

  const handleGenerate = () => {
    if (!courseInput || !timeInput) {
      alert("Please enter both course and time.");
      return;
    }
    const matches = generateObserverMatches(user.professor_id, courseInput, timeInput);
    setMatchedObservers(matches);
    setActiveTab('observee-status'); // Renamed per instructions
  };

  const handleSendRequest = (observer) => {
    const newRequest = {
      id: Date.now(),
      observeeId: user.professor_id,
      observeeName: user.name,
      observerId: observer.professor_id,
      observerName: observer.name,
      courseCode: courseInput,
      timing: timeInput,
      status: 'Pending'
    };
    setGlobalRequests([...globalRequests, newRequest]);
    alert(`Request Sent to ${observer.name}!`);
  };

  const updateRequestStatus = (reqId, newStatus) => {
    setGlobalRequests(globalRequests.map(req => 
      req.id === reqId ? { ...req, status: newStatus } : req
    ));
  };

  // Filter requests for the current user's views
  const mySentRequests = globalRequests.filter(req => req.observeeId === user.professor_id);
  const myIncomingDuties = globalRequests.filter(req => req.observerId === user.professor_id);

  return (
    <div className="dashboard-layout">
      <div className="sidebar premium-glass-dark">
        <div className="sidebar-header">
          <div className="logo-small">UTD</div>
          <div>
            <h3>Professor Portal</h3>
            <small>Assessment System</small>
          </div>
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
          <div className="user-profile">
            <div className="avatar">{user.name.charAt(4)}</div>
          </div>
        </header>

        <div className="content-scroll">
          {activeTab === 'home' && (
            <div className="bento-grid">
              <div className="bento-card highlight-card">
                <div className="card-icon">!</div>
                <div>
                  <h3>Action Required</h3>
                  <p>You are <strong style={{color: '#e87500'}}>DUE</strong> for an evaluation this semester.</p>
                </div>
              </div>
              
              <div className="bento-card" style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.8)' }}>
                <h3 style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '10px' }}>Step 1: Course Sign-Up</h3>
                <form style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold' }}>Course & Section #</label>
                    <input type="text" placeholder="e.g., CS 1000" value={courseInput} onChange={(e) => setCourseInput(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold' }}>Meeting Days & Time</label>
                    <input type="text" placeholder="e.g., MW 8:30 AM" value={timeInput} onChange={(e) => setTimeInput(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                  </div>
                  
                  <button type="button" onClick={handleGenerate} style={{ gridColumn: '1 / -1', padding: '10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Submit & Generate Observers
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'observee-status' && (
            <div className="bento-grid">
              <div className="bento-card full-span">
                <h3>Step 2: Request Observers</h3>
                <p className="subtitle">Eligible colleagues generated for {courseInput || "your course"}.</p>
                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Colleague</th><th>Action</th></tr></thead>
                    <tbody>
                      {matchedObservers.length === 0 ? (
                        <tr><td colSpan="2" style={{textAlign: 'center', padding: '20px'}}>No observers generated yet. Submit a course from the 'My Cycle' tab.</td></tr>
                      ) : (
                        matchedObservers.map(observer => {
                          const hasRequested = mySentRequests.some(req => req.observerId === observer.professor_id);
                          return (
                            <tr key={observer.professor_id}>
                              <td><strong>{observer.name}</strong></td>
                              <td>
                                {hasRequested ? (
                                  <span className="badge badge-warning">Request Sent</span>
                                ) : (
                                  <button className="btn-secondary btn-3d sm" onClick={() => handleSendRequest(observer)}>
                                    Send Request
                                  </button>
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

              <div className="bento-card full-span">
                <h3>Step 3: Track My Requests</h3>
                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Requested Observer</th><th>Course</th><th>Status</th></tr></thead>
                    <tbody>
                      {mySentRequests.length === 0 ? (
                        <tr><td colSpan="3" style={{textAlign: 'center'}}>No requests sent yet.</td></tr>
                      ) : (
                        mySentRequests.map(req => (
                          <tr key={req.id}>
                            <td><strong>{req.observerName}</strong></td>
                            <td>{req.courseCode} ({req.timing})</td>
                            <td>
                              {req.status === 'Pending' && <span className="badge badge-warning">Pending</span>}
                              {req.status === 'Accepted' && <span className="badge badge-success">Accepted</span>}
                              {req.status === 'Rejected' && <span className="badge badge-danger" style={{background: '#ef4444', color: 'white'}}>Rejected</span>}
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

          {activeTab === 'observer-duties' && (
            <div className="bento-grid">
              <div className="bento-card full-span">
                <h3>Incoming Observation Requests</h3>
                <p className="subtitle">Colleagues requesting you as an observer.</p>
                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Requesting Professor</th><th>Course to Observe</th><th>Status/Action</th></tr></thead>
                    <tbody>
                      {myIncomingDuties.length === 0 ? (
                        <tr><td colSpan="3" style={{textAlign: 'center'}}>No pending duties.</td></tr>
                      ) : (
                        myIncomingDuties.map(req => (
                          <tr key={req.id}>
                            <td><strong>{req.observeeName}</strong></td>
                            <td>{req.courseCode} ({req.timing})</td>
                            <td>
                              {req.status === 'Pending' ? (
                                <div style={{display: 'flex', gap: '10px'}}>
                                  <button className="btn-primary sm" onClick={() => updateRequestStatus(req.id, 'Accepted')} style={{background: '#16a34a', border: 'none', color: 'white', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer'}}>Accept</button>
                                  <button className="btn-danger sm" onClick={() => updateRequestStatus(req.id, 'Rejected')} style={{background: '#ef4444', border: 'none', color: 'white', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer'}}>Reject</button>
                                </div>
                              ) : (
                                <span className={req.status === 'Accepted' ? "badge badge-success" : "badge badge-danger"}>{req.status}</span>
                              )}
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
            <div className="bento-card full-span">
              <h3>End of Cycle Survey</h3>
              <p>Survey form temporarily hidden for workflow testing.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}