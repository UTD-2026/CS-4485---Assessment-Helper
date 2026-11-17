import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Notice, EmptyState } from './ui.jsx';
import { api } from '../api/client.js';
import { toast } from '../utils/toast.js';
import { RANK_OPTIONS, RANK_STATUS, fmtDate } from '../utils/ranks.js';

const MAX_REASON = 2000;

/**
 * Professor portal → "Rank Change" tab.
 * 1. Current rank (dropdown)  2. Rank changing to (dropdown)  3. Reason (textbox)  4. Submit
 * Below the form: every request this professor has sent and what the committee decided.
 */
export default function RankChangeForm({ user, onSubmitted }) {
  // Pre-select the rank on file so most people only need to pick the new one.
  const onFile = String(user?.hire_level || '').toLowerCase();
  const [current, setCurrent] = useState(RANK_OPTIONS.some((r) => r.value === onFile) ? onFile : '');
  const [requested, setRequested] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState(null);

  // Bump `version` to reload (same pattern as CommitteeReports).
  const [version, setVersion] = useState(0);
  const loadHistory = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let cancelled = false;
    api.rankChanges()
      .then((res) => { if (!cancelled) setHistory(res.data); })
      .catch((e) => { if (!cancelled) { setHistory([]); toast.error(e.message); } });
    return () => { cancelled = true; };
  }, [version]);

  const pending = history?.find((r) => r.status === 'pending');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!current || !requested) return setError('Please choose both your current rank and the rank you are changing to.');
    if (current === requested) return setError('The rank you are changing to must be different from your current rank.');
    if (!reason.trim()) return setError('Please give a reason for the rank change.');
    setError('');
    setSubmitting(true);
    try {
      await api.submitRankChange(current, requested, reason.trim());
      toast.success('Rank change submitted. The Assessment Committee will review it.');
      setRequested('');
      setReason('');
      loadHistory();
      onSubmitted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <section className="card card-lg">
        <div className="row section-gap-lg">
          <Badge tone="info">Rank on file: {RANK_OPTIONS.find((r) => r.value === onFile)?.label || 'Unknown'}</Badge>
        </div>

        {pending ? (
          <Notice tone="info" icon="clock" title="Waiting for the committee">
            Your request to change from {pending.current_level_label} to {pending.requested_level_label} (sent {fmtDate(pending.submitted_date)}) is
            being reviewed. You can send a new one once it has been decided.
          </Notice>
        ) : (
          <form onSubmit={handleSubmit} className="stack rank-form" noValidate>
            {error && <Notice tone="bad">{error}</Notice>}

            <div className="row rank-form-selects">
              <label className="field field-grow" htmlFor="rank-current">
                1. What is your current rank?
                <select id="rank-current" value={current} onChange={(e) => { setCurrent(e.target.value); setError(''); }} required>
                  <option value="" disabled>Select a rank</option>
                  {RANK_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <label className="field field-grow" htmlFor="rank-requested">
                2. What is the rank you are changing to?
                <select id="rank-requested" value={requested} onChange={(e) => { setRequested(e.target.value); setError(''); }} required>
                  <option value="" disabled>Select a rank</option>
                  {RANK_OPTIONS.map((r) => <option key={r.value} value={r.value} disabled={r.value === current}>{r.label}</option>)}
                </select>
              </label>
            </div>

            <label className="field" htmlFor="rank-reason">
              <span className="field-head">
                <span>3. Provide the reason for rank change.</span>
                <span className="field-hint">For example: promoted to Associate Professor effective Fall 2026.</span>
              </span>
              <textarea id="rank-reason" rows="4" maxLength={MAX_REASON} value={reason}
                onChange={(e) => { setReason(e.target.value); setError(''); }} placeholder="Write your reason" required />
              <span className="field-hint">{reason.length}/{MAX_REASON}</span>
            </label>

            <div>
              <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit'}</button>
            </div>
          </form>
        )}
      </section>

      <Card title="My rank change requests" sub="What you sent and what the committee decided" flush>
        {history === null ? <p className="empty-cell">Loading…</p> : history.length === 0 ? (
          <EmptyState icon="inbox" title="No requests yet">Requests you submit will show up here.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Submitted</th><th>Change</th><th>Reason</th><th>Status</th><th>Committee note</th></tr></thead>
              <tbody>
                {history.map((r) => {
                  const [label, tone] = RANK_STATUS[r.status] || [r.status, 'neutral'];
                  return (
                    <tr key={r.id}>
                      <td className="nowrap">{fmtDate(r.submitted_date)}</td>
                      <td className="strong nowrap">{r.current_level_label} → {r.requested_level_label}</td>
                      <td className="rank-reason-cell">{r.reason}</td>
                      <td><Badge tone={tone}>{label}</Badge></td>
                      <td>{r.review_note || <span className="faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
