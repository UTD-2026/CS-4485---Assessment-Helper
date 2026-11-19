import React, { useCallback, useMemo, useRef, useState } from 'react';
import { formatDate, formatDateTime } from '../api/adapters.js';
import Icon from './Icon.jsx';
import { Badge, Card, EmptyState, Meter } from './ui.jsx';
import { SURVEY_RATINGS } from './FeedbackSurvey.jsx';
import { FilterCheck, FilterDialog, FilterToolbar, sortBy, toggleIn, toggleSortIn } from './KpiListDialogs.jsx';

const RATING = Object.fromEntries(SURVEY_RATINGS.map((r) => [r.id, r]));

/* ---------- When each response was submitted ---------- */

const pad = (n) => String(n).padStart(2, '0');
// ISO timestamp -> { dateKey: 'YYYY-MM-DD' (viewer's local date), minutes: minutes after midnight, or null }.
// Date-only values (seed data stores dates as midnight UTC) have no real time, so minutes is null and the time shows "—".
const whenOf = (value) => {
  const s = String(value || '');
  if (!s) return { dateKey: '', minutes: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /T00:00:00(\.000)?Z$/.test(s)) return { dateKey: s.slice(0, 10), minutes: null };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { dateKey: '', minutes: null };
  return { dateKey: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes() };
};
// 1430 -> "2:30 PM"
const clockText = (minutes) => {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${pad(minutes % 60)} ${h < 12 ? 'AM' : 'PM'}`;
};
// "HH:MM" from a time picker -> minutes after midnight ('' -> null)
const pickerMinutes = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);

/* ---------- "More filters" pop-up ---------- */

const EMPTY_SURVEY_FILTERS = { ratings: [], sorts: [], dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' };
// Rows with no date / time always sort last.
const byMaybe = (get, dir) => (a, b) => {
  const x = get(a), y = get(b);
  return x === y ? 0 : x == null || x === '' ? 1 : y == null || y === '' ? -1 : x < y ? -dir : dir;
};
const SURVEY_SORTS = {
  dateEarliest: byMaybe((r) => r.submitted_at, 1), // first submitted -> last submitted
  dateLatest: byMaybe((r) => r.submitted_at, -1), // last submitted -> first submitted
  timeEarliest: byMaybe((r) => r.when.minutes, 1), // 12:00 AM -> 11:59 PM
  timeLatest: byMaybe((r) => r.when.minutes, -1), // 11:59 PM -> 12:00 AM
};
const SURVEY_PAIRS = { dateEarliest: 'dateLatest', dateLatest: 'dateEarliest', timeEarliest: 'timeLatest', timeLatest: 'timeEarliest' };
// Each ticked option counts once; a date range or time range counts once each.
const countSurveyFilters = (f) =>
  f.ratings.length + f.sorts.length + (f.dateFrom || f.dateTo ? 1 : 0) + (f.timeFrom || f.timeTo ? 1 : 0);

function applySurveyFilters(rows, query, f) {
  // Spaces ignored, so "11:52pm" finds "11:52 PM"
  const q = query.toLowerCase().replace(/\s+/g, '');
  const tFrom = pickerMinutes(f.timeFrom), tTo = pickerMinutes(f.timeTo);
  const kept = rows.filter((r) => {
    const { dateKey, minutes } = r.when;
    if (f.ratings.length && !f.ratings.includes(r.rating)) return false;
    // A response with no date (or no time) is left out once that range is set.
    if ((f.dateFrom || f.dateTo) && (!dateKey || (f.dateFrom && dateKey < f.dateFrom) || (f.dateTo && dateKey > f.dateTo))) return false;
    if ((tFrom != null || tTo != null) && (minutes == null || (tFrom != null && minutes < tFrom) || (tTo != null && minutes > tTo))) return false;
    // Search by date or time: "11/12/2026", "11/12", "2026-11-12", "11:52 PM", "11:52pm", "23:52", "pm", ...
    const times = minutes == null ? [] : [clockText(minutes), `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`];
    return !q || [formatDate(dateKey), dateKey, ...times].some((t) => t && t.toLowerCase().replace(/\s+/g, '').includes(q));
  });
  return sortBy(kept, f.sorts, SURVEY_SORTS);
}

// Start / End pickers (native calendar or clock), with a warning when Start is after End.
function RangePickers({ type, label, from, to, onChange }) {
  const flipped = from && to && from > to;
  return (
    <>
      <div className="survey-range">
        <label><span>Start</span>
          <input className="input" type={type} value={from} onChange={(e) => onChange('From', e.target.value)} aria-label={`${label}: start`} />
        </label>
        <label><span>End</span>
          <input className="input" type={type} value={to} onChange={(e) => onChange('To', e.target.value)} aria-label={`${label}: end`} />
        </label>
      </div>
      {flipped && <p className="count-range-error">Start is after End.</p>}
    </>
  );
}

function SurveyFilterDialog({ applied, ratingCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const reset = () => { setDraft(EMPTY_SURVEY_FILTERS); onApply(EMPTY_SURVEY_FILTERS); };
  const sortCheck = (key, label) => <FilterCheck label={label} checked={draft.sorts.includes(key)} onToggle={() => toggleSortIn(setDraft, SURVEY_PAIRS, key)} />;
  const setRange = (field) => (side, value) => setDraft((d) => ({ ...d, [`${field}${side}`]: value }));

  return (
    <FilterDialog titleId="survey-filter-title" sub="Sort and narrow the submitted surveys. Tick any options or pick a range, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-surveys">
      <fieldset className="filter-group">
        <legend>Rating</legend>
        {SURVEY_RATINGS.map((r) => (
          <FilterCheck key={r.id} label={r.label} count={ratingCounts[r.id]} checked={draft.ratings.includes(r.id)} onToggle={() => toggleIn(setDraft, 'ratings', r.id)} />
        ))}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Date</legend>
        <RangePickers type="date" label="Date submitted" from={draft.dateFrom} to={draft.dateTo} onChange={setRange('date')} />
        {sortCheck('dateEarliest', 'Earliest (first submitted → last)')}
        {sortCheck('dateLatest', 'Latest (last submitted → first)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Time</legend>
        <RangePickers type="time" label="Time submitted" from={draft.timeFrom} to={draft.timeTo} onChange={setRange('time')} />
        {sortCheck('timeEarliest', 'Earliest (12:00 AM → 11:59 PM)')}
        {sortCheck('timeLatest', 'Latest (12:00 AM ← 11:59 PM)')}
      </fieldset>
    </FilterDialog>
  );
}

/* ---------- One full response ("Open survey") ---------- */

function SurveyDetail({ response: r, onBack }) {
  const rating = RATING[r.rating];
  return (
    <Card className="stack-sm">
      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="chevronLeft" size={16} /> All surveys</button>
      </div>
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
}

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
    () => [...surveyResponses]
      .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))
      .map((r) => ({ ...r, when: whenOf(r.submitted_at) })),
    [surveyResponses]
  );
  // Responses per rating (older responses are mapped onto these by the backend)
  const ratingCounts = useMemo(() => Object.fromEntries(SURVEY_RATINGS.map((r) => [r.id, ordered.filter((x) => x.rating === r.id).length])), [ordered]);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_SURVEY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const openRef = useRef(null);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, []);
  const shown = useMemo(() => applySurveyFilters(ordered, query, filters), [ordered, query, filters]);
  const openResponse = openId ? ordered.find((r) => r.response_id === openId) : null;
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
      ) : openResponse ? (
        <SurveyDetail response={openResponse} onBack={() => setOpenId(null)} />
      ) : (
        <div className="stack-sm">
          <div className="page-filters">
            <FilterToolbar openRef={openRef} active={countSurveyFilters(filters)} query={query} setQuery={setQuery}
              placeholder="Search by date or time" searchLabel="Search surveys by date or time"
              onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_SURVEY_FILTERS); }} />
          </div>
          {filterOpen && <SurveyFilterDialog applied={filters} ratingCounts={ratingCounts} onApply={setFilters} onClose={closeFilters} />}

          {shown.length === 0 ? (
            <EmptyState icon="message" title="No matching responses">No surveys match these filters.</EmptyState>
          ) : (
            <>
              <div className="signup-row survey-row signup-head" aria-hidden="true">
                <span>Rating</span>
                <span>Date</span>
                <span>Time</span>
                <span className="signup-head-more">Review</span>
              </div>
              {shown.map((r) => {
                const rating = RATING[r.rating];
                return (
                  <div key={r.response_id} className="signup-card">
                    <div className="signup-row survey-row">
                      <span>{rating ? <Badge tone={rating.tone}>{rating.label}</Badge> : <Badge>Not rated</Badge>}</span>
                      <span>{r.when.dateKey ? formatDate(r.when.dateKey) : '—'}</span>
                      <span className="muted">{clockText(r.when.minutes)}</span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenId(r.response_id)}>Open survey</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <p className="faint">Showing {shown.length} of {ordered.length} responses.</p>
        </div>
      )}
    </div>
  );
}
