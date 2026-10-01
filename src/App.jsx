import React, { useState } from 'react';
import FeedbackSurvey from './FeedbackSurvey';
import './App.css';

export default function App() {
  const [currentUserRole, setCurrentUserRole] = useState(null);

  if (!currentUserRole) return <Login onLogin={setCurrentUserRole} />;
  if (currentUserRole === 'professor') return <ProfessorDashboard onLogout={() => setCurrentUserRole(null)} />;
  if (currentUserRole === 'admin') return <AdminDashboard onLogout={() => setCurrentUserRole(null)} />;
}

/* =========================================
   LOGIN PAGE
========================================= */
function Login({ onLogin }) {
  const [username, setUsername] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (username.toLowerCase() === 'admin') onLogin('admin');
    else if (username.toLowerCase() === 'professor') onLogin('professor');
    else alert('Invalid username. Use "admin" or "professor".');
  };

  return (
    <div className="login-container">
      <div className="login-orb orb-1"></div>
      <div className="login-orb orb-2"></div>
      <div className="login-card premium-glass">
        <div className="logo-placeholder">UTD</div>
        <h2>Assessment Helper</h2>
        <p>Faculty Observation Portal</p>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <input type="text" placeholder="NetID / Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="input-group">
            <input type="password" placeholder="Password" required />
          </div>
          <button type="submit" className="btn-primary btn-3d" style={{marginTop: '10px'}}>Secure Sign In</button>
        </form>
      </div>
    </div>
  );
}

/* =========================================
   ICONS (SVG)
========================================= */
const Icons = {
  Home: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>,
  Users: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>,
  Check: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 11.08 22 12 22 12a10 10 0 1 1-5.93-9.14"></polyline><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>,
  FileText: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>,
  LogOut: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
};

/* =========================================
   PROFESSOR DASHBOARD 
========================================= */
function ProfessorDashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState('home');

  const NavItem = ({ id, icon: Icon, label }) => (
    <li className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
      <Icon /> <span>{label}</span>
    </li>
  );

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
          <NavItem id="home" icon={Icons.Home} label="My Cycle" />
          <NavItem id="my-observation" icon={Icons.Users} label="Observer Status" />
          <NavItem id="observer-duties" icon={Icons.Check} label="My Duties" />
          <NavItem id="survey" icon={Icons.FileText} label="End Survey" />
          <li onClick={onLogout} className="logout-btn"><Icons.LogOut /> <span>Logout</span></li>
        </ul>
      </div>

      <div className="main-content">
        <header className="top-header premium-glass">
          <div className="header-title">
            <h2>Welcome back, Dr. Smith</h2>
            <p>Spring 2027 Evaluation Cycle</p>
          </div>
          <div className="user-profile">
            <div className="avatar">JS</div>
          </div>
        </header>

        <div className="content-scroll">
          {activeTab === 'survey' && (
            <FeedbackSurvey />
          )}
          {activeTab === 'home' && (
            <div className="bento-grid">
              <div className="bento-card highlight-card">
                <div className="card-icon">!</div>
                <div>
                  <h3>Action Required</h3>
                  <p>You are <strong style={{color: '#e87500'}}>DUE</strong> for an evaluation this semester.</p>
                </div>
              </div>
              
              {/* NEW: Official Course Sign-Up Form based on PDF requirements */}
              <div className="bento-card" style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.8)', color: '#1e293b' }}>
                <h3 style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '10px' }}>Step 1: Course Sign-Up</h3>
                <form style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold' }}>Course & Section #</label>
                    <input type="text" placeholder="e.g., CS 3345.001" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold' }}>Meeting Days & Time</label>
                    <input type="text" placeholder="e.g., MW 8:30 AM - 9:45 AM" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                  </div>
                  <button type="button" style={{ gridColumn: '1 / -1', padding: '10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Submit for Observer Selection
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'my-observation' && (
            <div className="bento-grid">
              <div className="bento-card full-span">
                <h3>Step 2: Request Observers</h3>
                <p className="subtitle">Send requests to eligible colleagues for CS 3345.</p>
                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Colleague</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>
                          <div className="user-cell"><div className="avatar-sm">AJ</div> <strong>Dr. A. Johnson</strong></div>
                        </td>
                        <td><span className="badge badge-neutral">Not Contacted</span></td>
                        <td><button className="btn-secondary btn-3d sm" onClick={()=>alert("Request Sent!")}>Send Request</button></td>
                      </tr>
                      <tr>
                        <td>
                          <div className="user-cell"><div className="avatar-sm">ML</div> <strong>Dr. M. Lee</strong></div>
                        </td>
                        <td><span className="badge badge-warning">Request Sent</span></td>
                        <td><button className="btn-secondary sm disabled" disabled>Pending</button></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bento-card full-span">
                <h3>Step 3: Confirm Match</h3>
                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Accepted By</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>
                      <tr>
                        <td><div className="user-cell"><div className="avatar-sm">ML</div> <strong>Dr. M. Lee</strong></div></td>
                        <td><span className="badge badge-success">Accepted</span></td>
                        <td>
                          <div style={{display: 'flex', gap: '10px'}}>
                            <button className="btn-primary btn-3d sm">Confirm</button>
                            <button className="btn-danger btn-3d sm">Decline</button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'observer-duties' && (
            <div className="bento-grid">
              <div className="bento-card" style={{ background: 'rgba(255,255,255,0.8)', color: '#1e293b' }}>
                <h3>Pending Observer Duties</h3>
                <p>You have agreed to observe <strong>Dr. Banner (CS 4485)</strong>.</p>
                
                {/* NEW: Required Upload Field for the Observer */}
                <div style={{ marginTop: '1rem', padding: '1rem', border: '1px dashed #94a3b8', borderRadius: '8px', background: '#f8fafc' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0' }}>Upload Signed Observation Template</h4>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '10px' }}>Both Observee and Observer signatures are required.</p>
                  <input type="file" accept=".pdf" />
                  <button type="button" style={{ display: 'block', marginTop: '10px', padding: '8px 16px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                    Submit Record
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'survey' && (
            <div className="bento-card full-span">
              <h3>End of Cycle Survey</h3>
              <p className="subtitle">Provide feedback on the logistics of the evaluation.</p>
              <form className="modern-form" onSubmit={(e) => { e.preventDefault(); alert("Survey Submitted!"); }}>
                <div className="form-group">
                  <label>Was this process OK overall?</label>
                  <div className="radio-group">
                    <label className="radio-btn"><input type="radio" name="ok" value="yes" /><span>Yes</span></label>
                    <label className="radio-btn"><input type="radio" name="ok" value="no" /><span>No</span></label>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Positive Feedback</label>
                    <textarea rows="4" placeholder="What went well?"></textarea>
                  </div>
                  <div className="form-group">
                    <label>Difficulties</label>
                    <textarea rows="4" placeholder="Any scheduling issues?"></textarea>
                  </div>
                </div>
                <div className="form-group file-upload">
                  <label>Additional Context (Optional)</label>
                  <input type="file" />
                </div>
                <button type="submit" className="btn-primary btn-3d">Submit Feedback</button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================
   ADMIN DASHBOARD 
========================================= */
function AdminDashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState('selection');

  const NavItem = ({ id, icon: Icon, label }) => (
    <li className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
      <Icon /> <span>{label}</span>
    </li>
  );

  return (
    <div className="dashboard-layout">
      <div className="sidebar admin-sidebar premium-glass-dark">
        <div className="sidebar-header">
          <div className="logo-small admin-logo">AC</div>
          <div>
            <h3>Committee</h3>
            <small>Admin Portal</small>
          </div>
        </div>
        <ul className="nav-menu">
          <NavItem id="selection" icon={Icons.Users} label="Matchmaking" />
          <NavItem id="kpi" icon={Icons.Home} label="Metrics (KPIs)" />
          <NavItem id="cycle" icon={Icons.FileText} label="Deadlines" />
          <li onClick={onLogout} className="logout-btn"><Icons.LogOut /> <span>Logout</span></li>
        </ul>
      </div>

      <div className="main-content">
        <header className="top-header premium-glass">
          <div className="header-title">
            <h2>Committee Executive View</h2>
            <p>System Overview & Control</p>
          </div>
          <div className="user-profile">
            <div className="avatar admin-avatar">AD</div>
          </div>
        </header>

        <div className="content-scroll">
          {activeTab === 'selection' && (
            <div className="bento-grid">
              <div className="bento-card alert-card full-span">
                <div className="card-icon error-icon">!</div>
                <div style={{flexGrow: 1}}>
                  <h3 style={{color: '#c62828'}}>System Alert</h3>
                  <p>Dr. Banner (CS 4485) has <strong>NO eligible observers</strong> based on schedule constraints.</p>
                </div>
                <button className="btn-danger btn-3d sm">Resolve Manually</button>
              </div>

              <div className="bento-card full-span">
                <div className="card-header-flex">
                  <div>
                    <h3>Post-Signup Matchmaking</h3>
                    <p className="subtitle">Generate observer lists for all signups.</p>
                  </div>
                  <div className="action-buttons">
                    <button className="btn-secondary btn-3d">1. Generate</button>
                    <button className="btn-primary btn-3d">2. Notify Faculty</button>
                  </div>
                </div>
                
                <div className="modern-table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Faculty</th><th>Course</th><th>Schedule</th><th>Status</th></tr></thead>
                    <tbody>
                      <tr>
                        <td><strong>Dr. Smith</strong></td><td>CS 3345</td><td>MW 8:30 AM</td>
                        <td><span className="badge badge-success">Matches Found</span></td>
                      </tr>
                      <tr>
                        <td><strong>Dr. Banner</strong></td><td>CS 4485</td><td>TTh 1:00 PM</td>
                        <td><span className="badge badge-error">Insufficient List</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'kpi' && (
            <>
              <h3 className="section-title">Executive Metrics</h3>
              <div className="bento-grid kpi-grid">
                <div className="bento-card kpi-card">
                  <p>Participation Rate</p>
                  <h2>85%</h2>
                  <div className="kpi-trend positive">+5% from last cycle</div>
                </div>
                <div className="bento-card kpi-card">
                  <p>List Sufficiency</p>
                  <h2>92%</h2>
                  <div className="kpi-trend positive">Matches generated</div>
                </div>
                <div className="bento-card kpi-card alert-border">
                  <p>Overdue Evaluations</p>
                  <h2 style={{color: '#c62828'}}>3</h2>
                  <div className="kpi-trend negative">Requires attention</div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'cycle' && (
            <div className="bento-card full-span">
              <h3>Faculty Due Report</h3>
              <div className="modern-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>Faculty</th><th>Status</th><th>Last Eval</th><th>Action</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><strong>Dr. Smith</strong></td>
                      <td><span className="badge badge-warning">Due</span></td>
                      <td>Spring 2025</td>
                      <td><button className="btn-secondary btn-3d sm">Remind</button></td>
                    </tr>
                    <tr>
                      <td><strong>Dr. Banner</strong></td>
                      <td><span className="badge badge-error">Overdue</span></td>
                      <td>Fall 2024</td>
                      <td><button className="btn-danger btn-3d sm">Remind</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}