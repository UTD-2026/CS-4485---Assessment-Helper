import React, { useState } from 'react';

export default function FeedbackSurvey() {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="survey-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', color: '#1e293b' }}>
      <div className="bento-box" style={{ 
        background: 'rgba(255, 255, 255, 0.8)', 
        backdropFilter: 'blur(10px)', 
        borderRadius: '16px', 
        padding: '2rem',
        border: '1px solid rgba(0,0,0,0.1)',
        boxShadow: '0 4px 15px rgba(0,0,0,0.05)'
      }}>
        <h2 style={{ marginTop: 0, borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '10px' }}>
          End-of-Process Survey & Feedback
        </h2>
        
        {submitted ? (
          <div className="success-message" style={{ textAlign: 'center', padding: '2rem' }}>
            <h3 style={{ color: '#16a34a' }}>✓ Survey Submitted Successfully</h3>
            <p>Thank you. Your feedback has been recorded in the system.</p>
            <button 
              onClick={() => setSubmitted(false)}
              style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', marginTop: '1rem', fontWeight: 'bold' }}
            >
              Submit Another
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
            
            {/* Requirement: Was this process ok or not */}
            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Was this observation process OK?</label>
              <select style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b' }} required>
                <option value="">Select...</option>
                <option value="ok">Yes, the process was OK</option>
                <option value="not_ok">No, the process was not OK</option>
              </select>
            </div>

            {/* Requirement: A place to list difficulties */}
            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>List your difficulties</label>
              <textarea 
                rows="3" 
                placeholder="Describe any issues you faced during the observation process..."
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', resize: 'vertical' }}
              ></textarea>
            </div>

            {/* Requirement: Opinion on how to improve */}
            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Opinion on how to improve the process</label>
              <textarea 
                rows="3" 
                placeholder="Share your suggestions for improving this system..."
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', resize: 'vertical' }}
              ></textarea>
            </div>

            {/* Requirement: Upload file for trouble */}
            <div className="form-group" style={{ padding: '1rem', background: '#f1f5f9', borderRadius: '8px', border: '1px dashed #94a3b8' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Troubleshooting Upload (Optional)</label>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 0, marginBottom: '10px' }}>Upload a file to shed light on any trouble during the observation.</p>
              <input type="file" style={{ width: '100%' }} />
            </div>

            <button 
              type="submit" 
              style={{ 
                padding: '12px', 
                borderRadius: '8px', 
                border: 'none', 
                background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)', 
                color: '#fff', 
                fontWeight: 'bold', 
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(234, 88, 12, 0.3)',
                marginTop: '10px'
              }}
            >
              Submit Survey
            </button>
          </form>
        )}
      </div>
    </div>
  );
}