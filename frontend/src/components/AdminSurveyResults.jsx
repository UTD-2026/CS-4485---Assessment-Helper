import React, { useMemo } from 'react';
import { formatDateTime } from '../api/adapters.js';
import Icon from './Icon.jsx';
import { Badge, Card, EmptyState, Meter } from './ui.jsx';

/**
 * Survey results for the Committee (AC) portal.
 *
 * Props:
 *  - surveyResponses: answers plus submitted_at. Each has a random response_id and NO professor identity.
 *  - submittedCount / totalCount: how many finished vs. how many signed up this cycle (counts only)
 *  - onSendReminders / canSendReminders / remindersHint: the end-of-process reminder blast
 *    (POST /api/surveys/reminders), available once the observation period has ended.
 *  Data: GET /api/surveys/responses (the server never returns respondent emails).
 *
 * Never pass the "who submitted" list into this component.
 */
export default function AdminSurveyResults({ surveyResponses, submittedCount, totalCount, onSendReminders, canSendReminders, remindersHint }) {
  // Newest first; responses without a date go last
  const ordered = useMemo(
    () => [...surveyResponses].sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || ''))),
    [surveyResponses]
  );
  const okCount = ordered.filter((r) => r.process_ok).length;
  const rate = totalCount ? Math.round((submittedCount / totalCount) * 100) : 0;

  return (
    <div className="stack">
      <div className="grid grid-230 grid-stretch">
        <div className="card stack-sm">
          <div className="big-number">{submittedCount}<span className="faint">/{totalCount}</span></div>
          <div className="muted">surveys submitted ({rate}%)</div>
          <Meter value={rate} tone="info" label={`${rate}% submitted`} />
        </div>
        <div className="card stack-sm">
          <div className="big-number"><span className="text-good">{okCount}</span> <span className="text-bad">/ {ordered.length - okCount}</span></div>
          <div className="muted">rated the process OK / not OK</div>
        </div>
        <div className="card stack-sm">
          <button type="button" className="btn btn-primary" onClick={onSendReminders} disabled={!canSendReminders}>
            <Icon name="send" size={16} /> Send survey reminders
          </button>
          <span className="faint">{remindersHint}</span>
        </div>
      </div>

      <p className="muted">Responses are anonymous. The committee sees who submitted, never which answers are whose.</p>

      {ordered.length === 0 ? (
        <EmptyState icon="message" title="No surveys submitted yet">Responses appear here as observees finish the process.</EmptyState>
      ) : (
        <div className="grid grid-380">
          {ordered.map((r) => (
            <Card as="article" key={r.response_id} className="stack-sm">
              <div className="row-between">
                <span className="faint">{formatDateTime(r.submitted_at)}</span>
                <Badge tone={r.process_ok ? 'good' : 'bad'}>Process OK: {r.process_ok ? 'Yes' : 'No'}</Badge>
              </div>
              <div>
                <div className="section-label text-warn">Difficulties</div>
                <div className={r.difficulties ? '' : 'faint'}>{r.difficulties || 'None provided'}</div>
              </div>
              <div>
                <div className="section-label text-good">Suggestions</div>
                <div className={r.improvements ? '' : 'faint'}>{r.improvements || 'None provided'}</div>
              </div>
              {/* Older seeded responses used "what went well" instead of suggestions */}
              {r.positive_feedback && (
                <div>
                  <div className="section-label">What went well</div>
                  <div className="muted">{r.positive_feedback}</div>
                </div>
              )}
              {r.has_attachment && <span className="row faint"><Icon name="paperclip" size={15} /> Attachment included</span>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
