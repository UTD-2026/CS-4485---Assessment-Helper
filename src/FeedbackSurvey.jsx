import React, { useState } from 'react';
import './App.css'; // Re-using your global styles

export default function FeedbackSurvey() {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="survey-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', color: '#fff' }}>
      <div className="bento-box" style={{ 
        background: 'rgba(255, 255, 255, 0.1)', 
        backdropFilter: 'blur(10px)', 
        borderRadius: '16px', 
        padding: '2rem',
        border: '1px solid rgba(255,255,255,0.2)'
      }}>
        <h2 style={{ marginTop: 0, borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '10px' }}>
          End-of-Semester Faculty Feedback
        </h2>
        
        {submitted ? (
          <div className="success-message" style={{ textAlign: 'center', padding: '2rem' }}>
            <h3 style={{ color: '#4ade80' }}>✓ Survey Submitted Successfully</h3>
            <p>Thank you. Your feedback has been recorded in the system.</p>
            <button 
              onClick={() => setSubmitted(false)}
              style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', marginTop: '1rem' }}
            >
              Submit Another
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
            
            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Faculty Member Observed</label>
              <select style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none' }} required>
                <option value="">Select Faculty...</option>
                <option value="smith">Dr. Smith (CS 3345)</option>
                <option value="banner">Dr. Banner (CS 4485)</option>
              </select>
            </div>

            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Overall Observation Rating (1-5)</label>
              <input type="range" min="1" max="5" defaultValue="5" style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span>1 - Needs Improvement</span>
                <span>5 - Excellent</span>
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Constructive Feedback (Replaces PDF Upload)</label>
              <textarea 
                rows="4" 
                placeholder="Enter detailed observation notes here..."
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', resize: 'vertical' }}
                required
              ></textarea>
            </div>

            <button 
              type="submit" 
              style={{ 
                padding: '12px', 
                borderRadius: '8px', 
                border: 'none', 
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', 
                color: '#fff', 
                fontWeight: 'bold', 
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(234, 88, 12, 0.3)'
              }}
            >
              Submit Evaluation
            </button>
          </form>
        )}
      </div>
    </div>
  );
}