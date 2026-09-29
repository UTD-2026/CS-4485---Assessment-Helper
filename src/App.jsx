import React, { useState } from 'react';
import './App.css';

export default function App() {
  const [currentUserRole, setCurrentUserRole] = useState(null); // 'professor', 'admin'

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
      <div className="login-card">
        <h2>Assessment Helper</h2>
        <p>UTD Computer Science Department</p>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>NetID / Username</label>
            <input type="text" placeholder="Enter 'admin' or 'professor'" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Password</label>
            <input type="password" placeholder="Any password works" required />
          </div>
          <button type="submit" className="btn-primary">Sign In</button>
        </form>
      </div>
    </div>
  );
}

/* =========================================
   PROFESSOR DASHBOARD (Observee & Observer)
========================================= */
function ProfessorDashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState('home');

  return (
    <div className="dashboard-layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <h3>UTD Assessment</h3>
          <small>Professor Portal</small>
        </div>
        <ul className="nav-menu">
          <li className={activeTab === 'home' ? 'active' : ''} onClick={() => setActiveTab('home')}>My Evaluation Cycle</li>
          <li className={activeTab === 'my-observation' ? 'active' : ''} onClick={() => setActiveTab('my-observation')}>My Observee Status</li>
          <li className={activeTab === 'observer-duties' ? 'active' : ''} onClick={() => setActiveTab('observer-duties')}>My Observer Duties</li>
          <li className={activeTab === 'survey' ? 'active' : ''} onClick={() => setActiveTab('survey')}>End of Process Survey</li>
          <li onClick={onLogout} style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.1)' }}>Logout</li>
        </ul>
      </div>

      <div className="main-content">
        <div className="top-bar">
          <div>
            <h2>Welcome, Prof. Smith (Associate Level)</h2>
            <p style={{ margin: 0, color: '#666' }}>Last Evaluated: Spring 2025</p>
          </div>
        </div>

        {activeTab === 'home' && (
          <>
            <div className="info-box">
              <strong>Cycle Status: </strong> You are <span className="status-badge status-due">DUE</span> for an evaluation this semester (Spring 2027).
            </div>
            
            <div className="content-card">
              <h3>Step 1: Sign up for Observation</h3>
              <p>Please select exactly ONE course section from your schedule for an observer to attend.</p>
              <table className="data-table">
                <thead>
                  <tr><th>Course #</th><th>Section</th><th>Days & Times</th><th>Action</th></tr>
                </thead>
                <tbody>
                  <tr><td>CS 3345</td><td>001</td><td>MW 8:30 AM - 9:45 AM</td><td><button className="btn-primary" style={{width: 'auto'}}>Select for Observation</button></td></tr>
                  <tr><td>CS 4485</td><td>004</td><td>TTh 1:00 PM - 2:15 PM</td><td><button className="btn-secondary">Select for Observation</button></td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'my-observation' && (
          <>
            <div className="content-card">
              <h3>Step 2: Select Your Observer</h3>
              <p>The Assessment Committee has generated 5 eligible observers for your selected course (CS 3345, MW 8:30 AM). Select who you would like to request.</p>
              <table className="data-table">
                <thead>
                  <tr><th>Matched Observer</th><th>Department</th><th>Level</th><th>Action</th></tr>
                </thead>
                <tbody>
                  <tr><td>Dr. A. Johnson</td><td>CS</td><td>Assoc. Prof</td><td><button className="btn-secondary" onClick={()=>alert("Request Sent!")}>Send Request</button></td></tr>
                  <tr><td>Dr. R. Davis</td><td>CS</td><td>Full Prof</td><td><button className="btn-secondary">Send Request</button></td></tr>
                  <tr><td>Dr. M. Lee</td><td>CS</td><td>Assoc. Prof</td><td><span className="status-badge status-pending">Request Sent</span></td></tr>
                </tbody>
              </table>
            </div>

            <div className="content-card">
              <h3>Step 3: Confirm Final Observer</h3>
              <p>If multiple observers accept your request, you must accept ONE and gracefully decline the others.</p>
              <table className="data-table">
                <thead>
                  <tr><th>Observer</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  <tr><td>Dr. M. Lee</td><td><span className="status-badge status-good">Accepted your Request</span></td><td><button className="btn-primary" style={{marginRight: '10px'}}>Confirm Observer</button><button className="btn-secondary">Gracefully Decline</button></td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'observer-duties' && (
          <>
            <div className="info-box">
              Because you signed up to be observed, you are automatically in the Observer Pool.
            </div>
            <div className="content-card">
              <h3>Incoming Observation Requests</h3>
              <p>Confirm up to 3 requests to observe your peers.</p>
              <table className="data-table">
                <thead>
                  <tr><th>Observee</th><th>Course</th><th>Date/Time</th><th>Action</th></tr>
                </thead>
                <tbody>
                  <tr><td>Dr. J. Martin</td><td>CS 1200</td><td>TTh 10:00 AM</td><td><button className="btn-secondary">Confirm Request</button></td></tr>
                </tbody>
              </table>
            </div>

            <div className="content-card">
              <h3>Upload Signed Observations</h3>
              <p>Once you have observed a class in-person and both parties have signed the template, upload the physical copy here to prove the observation occurred.</p>
              <div className="input-group">
                <input type="file" />
              </div>
              <button className="btn-primary" style={{width: '200px'}}>Upload Signed PDF</button>
            </div>
          </>
        )}

        {activeTab === 'survey' && (
          <div className="content-card">
            <h3>End of Process Survey</h3>
            <p>Please provide feedback on the evaluation logistics.</p>
            <form onSubmit={(e) => { e.preventDefault(); alert("Survey Submitted!"); }}>
              <div className="input-group">
                <label>Was this process OK overall?</label>
                <select><option>Yes</option><option>No</option></select>
              </div>
              <div className="input-group">
                <label>List any difficulties experienced during scheduling/observation:</label>
                <textarea rows="3"></textarea>
              </div>
              <div className="input-group">
                <label>Opinions on how to improve the process:</label>
                <textarea rows="3"></textarea>
              </div>
              <div className="input-group">
                <label>Upload additional context file (Optional):</label>
                <input type="file" />
              </div>
              <button type="submit" className="btn-primary" style={{width: '150px'}}>Submit Survey</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================
   ADMIN DASHBOARD (Assessment Committee)
========================================= */
function AdminDashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState('kpi');

  return (
    <div className="dashboard-layout">
      <div className="sidebar" style={{ backgroundColor: '#0C2340' }}>
        <div className="sidebar-header">
          <h3>Assessment Comm.</h3>
          <small>Admin Portal</small>
        </div>
        <ul className="nav-menu">
          <li className={activeTab === 'kpi' ? 'active' : ''} onClick={() => setActiveTab('kpi')}>Executive KPIs</li>
          <li className={activeTab === 'cycle' ? 'active' : ''} onClick={() => setActiveTab('cycle')}>Cycle & Deadlines</li>
          <li className={activeTab === 'selection' ? 'active' : ''} onClick={() => setActiveTab('selection')}>Observer Selection</li>
          <li className={activeTab === 'templates' ? 'active' : ''} onClick={() => setActiveTab('templates')}>Manage Templates</li>
          <li onClick={onLogout} style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.1)' }}>Logout</li>
        </ul>
      </div>

      <div className="main-content">
        <div className="top-bar">
          <h2>Assessment Committee Dashboard</h2>
        </div>

        {activeTab === 'kpi' && (
          <>
            <h3 style={{marginTop: 0}}>Faculty Evaluation KPIs</h3>
            <div className="stats-grid">
              <div className="stat-card"><h4>Eval Eligibility Accuracy</h4><h2>98%</h2><p>Matches correct dept/level</p></div>
              <div className="stat-card" style={{borderLeftColor: '#dc3545'}}><h4>Overdue Evals</h4><h2>3</h2><p>Faculty missing 2+ year cycle</p></div>
            </div>

            <h3>Assessment Participation KPIs</h3>
            <div className="stats-grid">
              <div className="stat-card"><h4>Participation Rate</h4><h2>85%</h2><p>Signed up / Total Due</p></div>
              <div className="stat-card"><h4>Observer Utilization</h4><h2>60%</h2><p>Took Observer Role / Signed Up</p></div>
              <div className="stat-card"><h4>List Sufficiency Rate</h4><h2>4.2</h2><p>Avg matches per signup (Target 5)</p></div>
            </div>

            <h3>Survey & Completion KPIs</h3>
            <div className="stats-grid">
              <div className="stat-card"><h4>Survey Completion</h4><h2>40%</h2><p>Finished entirely / Signed up</p></div>
              <div className="stat-card" style={{borderLeftColor: '#e87500'}}><h4>Missing Observations</h4><h2>2</h2><p>Confirmed but no form uploaded</p></div>
            </div>
          </>
        )}

        {activeTab === 'cycle' && (
          <>
            <div className="content-card">
              <h3>Semester Deadlines Configuration</h3>
              <div className="form-grid">
                <div className="input-group"><label>Signup Deadline</label><input type="date" defaultValue="2027-02-15" /></div>
                <div className="input-group"><label>Observation Period Deadline</label><input type="date" defaultValue="2027-04-15" /></div>
                <div className="input-group full-width"><label>Feedback/Survey Deadline</label><input type="date" defaultValue="2027-05-01" /></div>
              </div>
              <button className="btn-primary" style={{width: '200px'}}>Update Deadlines</button>
            </div>

            <div className="content-card">
              <h3>Faculty Due / Overdue Report</h3>
              <table className="data-table">
                <thead>
                  <tr><th>Faculty Member</th><th>Level</th><th>Status</th><th>Last Eval</th><th>Action</th></tr>
                </thead>
                <tbody>
                  <tr><td>Dr. Smith</td><td>Associate</td><td><span className="status-badge status-due">Due</span></td><td>Spring 2025</td><td><button className="btn-secondary">Send Reminder</button></td></tr>
                  <tr><td>Dr. Banner</td><td>Full Prof</td><td><span className="status-badge status-overdue">Overdue</span></td><td>Fall 2024</td><td><button className="btn-secondary">Send Reminder</button></td></tr>
                  <tr><td>Dr. Patel</td><td>Assistant</td><td><span className="status-badge status-good">Good</span></td><td>Spring 2026</td><td>-</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'selection' && (
          <>
            <div className="alert-box">
              <span><strong>ALERT:</strong> Dr. Banner (CS 4485) has 0 eligible observers available based on schedule/level criteria.</span>
              <button className="btn-danger">Resolve Manually</button>
            </div>

            <div className="content-card">
              <h3>Post-Signup Observer Selection</h3>
              <p>Signup deadline has passed. Generate 5 matched observers for each signup based on Department, Class Level, and Availability.</p>
              
              <div style={{marginBottom: '20px'}}>
                <button className="btn-primary" style={{width: '200px', marginRight: '10px'}} onClick={()=>alert("Observer matching algorithm executed.")}>1. Generate Observers</button>
                <button className="btn-secondary" onClick={()=>alert("Notifications sent to Observees.")}>2. Notify Observees (Lists Ready)</button>
              </div>

              <table className="data-table">
                <thead>
                  <tr><th>Observee</th><th>Email</th><th>Course #</th><th>Sec</th><th>Days/Time</th><th>Matched List Size</th></tr>
                </thead>
                <tbody>
                  <tr><td>Dr. Smith</td><td>smith@utd.edu</td><td>CS 3345</td><td>001</td><td>MW 8:30 AM</td><td>5 / 5 <button className="btn-secondary" style={{marginLeft: '10px', fontSize:'0.75rem'}}>Edit</button></td></tr>
                  <tr><td>Dr. Banner</td><td>banner@utd.edu</td><td>CS 4485</td><td>002</td><td>TTh 1:00 PM</td><td style={{color: 'red', fontWeight: 'bold'}}>0 / 5 (Insufficient)</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'templates' && (
          <div className="content-card">
            <h3>Observation Template & Ratings</h3>
            <p>Modify the criteria that observers will evaluate on the physical templates.</p>
            <div className="input-group">
              <label>Current Criteria Elements (Comma Separated)</label>
              <textarea rows="3" defaultValue="Syllabus Clarity, Student Engagement, Pacing, Content Accuracy, Q&A Effectiveness"></textarea>
            </div>
            <div className="input-group">
              <label>Rating Scale</label>
              <select><option>1 to 5 Scale</option><option>Exceeds / Meets / Below Expectations</option></select>
            </div>
            <button className="btn-primary" style={{width: '150px'}}>Save Template</button>
          </div>
        )}
      </div>
    </div>
  );
}