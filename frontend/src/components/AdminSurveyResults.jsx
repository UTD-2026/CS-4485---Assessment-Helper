import React, { useMemo } from 'react';
import { formatDateTime } from '../api/adapters.js';

/**
 * Survey results for the Committee (AC) portal.
 *
 * Props:
 *  - surveyResponses: answers plus submitted_at. Each has a random response_id and NO professor identity.
 *  - submittedCount / totalCount: how many finished vs. how many signed up this cycle (counts only)
 *  Data: GET /api/surveys/responses (the server never returns respondent emails).
 *
 * Never pass the "who submitted" list into this component.
 */
export default function AdminSurveyResults({ surveyResponses, submittedCount, totalCount }) {
  // Newest first; responses without a date go last
  const ordered = useMemo(
    () => [...surveyResponses].sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || ''))),
    [surveyResponses]
  );

  const okCount = ordered.filter(r => r.process_ok).length;
  const rate = totalCount ? Math.round((submittedCount / totalCount) * 100) : 0;

  return (
    <div className="bento-grid">
      <div className="bento-card">
        <h3>Survey Completion</h3>
        <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '8px 0' }}>{submittedCount} / {totalCount}</p>
        <p className="subtitle">{rate}% submitted</p>
      </div>
      <div className="bento-card">
        <h3>Process Rating</h3>
        <p style={{ margin: '12px 0' }}>
          <span className="badge badge-success">{okCount} OK</span>{' '}
          <span className="badge badge-danger" style={{ background: '#ef4444', color: 'white' }}>{ordered.length - okCount} Not OK</span>
        </p>
      </div>

      <div className="bento-card full-span">
        <h3 style={{ marginBottom: '16px' }}>Submitted Surveys</h3>
        <div className="modern-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th className="nowrap">Date Submitted</th><th className="nowrap">Process OK?</th><th>Difficulties</th><th>Suggestions</th><th>Attachment</th></tr>
            </thead>
            <tbody>
              {ordered.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px' }}>No surveys submitted yet.</td></tr>
              ) : (
                ordered.map((r) => (
                  <tr key={r.response_id}>
                    <td className="nowrap">{formatDateTime(r.submitted_at)}</td>
                    <td>
                      {r.process_ok
                        ? <span className="badge badge-success">Yes</span>
                        : <span className="badge badge-danger" style={{ background: '#ef4444', color: 'white' }}>No</span>}
                    </td>
                    <td>{r.difficulties || <em style={{ color: '#94a3b8' }}>None provided</em>}</td>
                    <td>
                      {r.improvements || (!r.positive_feedback && <em style={{ color: '#94a3b8' }}>None provided</em>)}
                      {/* Older seeded responses used "what went well" instead of suggestions */}
                      {r.positive_feedback && <div style={{ color: '#64748b', fontSize: '0.85rem' }}>What went well: {r.positive_feedback}</div>}
                    </td>
                    <td>{r.has_attachment ? '📎 Included' : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}