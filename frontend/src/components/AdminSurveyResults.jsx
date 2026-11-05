import React, { useMemo } from 'react';

/**
 * Anonymous survey results for the Committee (AC) portal.
 *
 * Props:
 *  - surveyResponses: answers only. Each has a random response_id and NO professor identity.
 *  - submittedCount / totalCount: how many finished vs. how many were expected (counts only)
 *
 * IMPORTANT: never pass the "who submitted" list into this component. That is what keeps responses anonymous.
 */
export default function AdminSurveyResults({ surveyResponses, submittedCount, totalCount }) {
  // Sorted by random id, so list order (= submission order) can't hint at who wrote what.
  const ordered = useMemo(
    () => [...surveyResponses].sort((a, b) => a.response_id.localeCompare(b.response_id)),
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
        <h3>Submitted Surveys</h3>
        <p className="subtitle">🔒 Anonymous: respondent identities are not stored with answers.</p>
        <div className="modern-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Respondent</th><th>Process OK?</th><th>Difficulties</th><th>Suggestions</th><th>Attachment</th></tr>
            </thead>
            <tbody>
              {ordered.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px' }}>No surveys submitted yet.</td></tr>
              ) : (
                ordered.map((r, i) => (
                  <tr key={r.response_id}>
                    <td><strong>Anonymous #{i + 1}</strong></td>
                    <td>
                      {r.process_ok
                        ? <span className="badge badge-success">Yes</span>
                        : <span className="badge badge-danger" style={{ background: '#ef4444', color: 'white' }}>No</span>}
                    </td>
                    <td>{r.difficulties || <em style={{ color: '#94a3b8' }}>None provided</em>}</td>
                    <td>{r.improvements || <em style={{ color: '#94a3b8' }}>None provided</em>}</td>
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