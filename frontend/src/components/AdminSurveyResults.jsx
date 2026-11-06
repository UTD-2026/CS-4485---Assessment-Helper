import React, { useMemo, useState } from 'react';
import { formatDateTime } from '../api/adapters.js';
import Icon from './Icon.jsx';
import { Badge, Card, EmptyState, Meter } from './ui.jsx';
import { SURVEY_RATINGS } from './FeedbackSurvey.jsx';

const RATING = Object.fromEntries(SURVEY_RATINGS.map((r) => [r.id, r]));

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
  // Responses per rating (older responses are mapped onto these by the backend)
  const ratingCounts = useMemo(() => Object.fromEntries(SURVEY_RATINGS.map((r) => [r.id, ordered.filter((x) => x.rating === r.id).length])), [ordered]);
  const [ratingFilter, setRatingFilter] = useState('all');
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((r) =>
      (ratingFilter === 'all' || r.rating === ratingFilter) &&
      (!q || [r.notes, ...(r.answers || []).map((a) => a.answer)].some((t) => String(t || '').toLowerCase().includes(q))));
  }, [ordered, ratingFilter, query]);
  const rate = totalCount ? Math.round((submittedCount / totalCount) * 100) : 0;
  // Submission rate colour: red under 30%, yellow 30-69%, green 70% and up (bar, percentage and numerator all follow it).
  const rateTone = rate >= 70 ? 'good' : rate >= 30 ? 'warn' : 'bad';

  return (
    <div className="stack">
      <div className="grid grid-230 grid-stretch">
        <div className="card stack-sm">
          <div className="big-number survey-fraction">
            <span className={`text-${rateTone}`}>{submittedCount}</span>
            <span className="survey-fraction-total">/ {totalCount}</span>
          </div>
          <div className="muted">
            of {totalCount} signed-up professors submitted the survey (<strong className={`text-${rateTone}`}>{rate}%</strong>)
          </div>
          <Meter value={rate} tone={rateTone} label={`${rate}% submitted`} />
        </div>
        <div className="card survey-ok-card">
          {/* One grid for counts (row 1) and labels (row 2), so each count sits centered over its own label */}
          <div className="survey-rating-grid">
            {SURVEY_RATINGS.map((r, i) => (
              <React.Fragment key={r.id}>
                {i > 0 && <span className="survey-ok-colon big-number" style={{ gridColumn: i * 2, gridRow: 1 }} aria-hidden="true">:</span>}
                <span className={`survey-rating-num big-number ${r.tone}`} style={{ gridColumn: i * 2 + 1, gridRow: 1 }}>{ratingCounts[r.id]}</span>
                <span className={`survey-ok-pill ${r.tone}`} style={{ gridColumn: i * 2 + 1, gridRow: 2 }}>rated<br />{r.label.toLowerCase()}</span>
              </React.Fragment>
            ))}
          </div>
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
        <>
          <div className="row-between">
            <div className="segmented" role="tablist" aria-label="Filter responses by rating">
              {[{ id: 'all', label: 'All' }, ...SURVEY_RATINGS].map((r) => (
                <button key={r.id} type="button" role="tab" aria-selected={ratingFilter === r.id} className={ratingFilter === r.id ? 'active' : ''} onClick={() => setRatingFilter(r.id)}>
                  {r.label} <span className="mono">{r.id === 'all' ? ordered.length : ratingCounts[r.id]}</span>
                </button>
              ))}
            </div>
            <input className="input survey-search" type="search" placeholder="Search answers" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search survey answers" />
          </div>

          {shown.length === 0 ? (
            <EmptyState icon="message" title="No matching responses">Try another rating or search.</EmptyState>
          ) : (
            <div className="grid grid-380">
              {shown.map((r) => {
                const rating = RATING[r.rating];
                return (
                  <Card as="article" key={r.response_id} className="stack-sm">
                    <div className="row-between">
                      <span className="faint">
                        {formatDateTime(r.submitted_at)}
                        {r.legacy && <span title="Submitted on an earlier version of the survey"> · earlier survey</span>}
                      </span>
                      {rating ? <Badge tone={rating.tone}>{rating.label}</Badge> : <Badge>Not rated</Badge>}
                    </div>
                    {/* Each question the professor answered, in the order they saw it */}
                    {r.answers?.length ? r.answers.map((a) => (
                      <div key={a.key}>
                        <div className="survey-question">{a.question}</div>
                        {a.key === 'had_difficulties'
                          ? <Badge tone={a.answer === 'yes' ? 'good' : 'bad'}>{a.answer === 'yes' ? 'Yes' : 'No'}</Badge>
                          : <div>{a.answer}</div>}
                      </div>
                    )) : <div className="faint">No written feedback.</div>}
                    {r.notes && (
                      <div>
                        <div className="survey-question">Additional notes</div>
                        <div className="muted">{r.notes}</div>
                      </div>
                    )}
                    {r.has_attachment && (
                      <span className="row faint"><Icon name="paperclip" size={15} /> {r.attachment_count > 1 ? `${r.attachment_count} attachments included` : 'Attachment included'}</span>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
          <p className="faint">Showing {shown.length} of {ordered.length} responses.</p>
        </>
      )}
    </div>
  );
}
