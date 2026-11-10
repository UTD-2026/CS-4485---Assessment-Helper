import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { downloadCsv } from '../utils/facultyCsv.js';
import Icon from './Icon.jsx';
import { NextActionButton, NextActionDialog, OutstandingDialog, UnmatchedDialog, WorkloadDialog } from './KpiListDialogs.jsx';
import { DUE, STATUS, nextDetail, scheduleOf } from '../utils/nextSteps.js';
import { Badge, Card, Notice } from './ui.jsx';

// Committee Reports (from the sriproflookup branch). The tables come from the backend:
//   GET /api/reports/kpis                      -> faculty due by hire level, observer workload
//   GET /api/reports/unmatched-faculty         -> unmatched faculty (include=all_due for every due/overdue professor)
//   GET /api/reports/outstanding-observations  -> outstanding observations + breakdown by hire level

// How many rows the long report cards show before "Show all" opens the full, filterable list.
const PREVIEW_ROWS = 8;

// One headline figure per row: the number, a short label and a plain-language explanation.
function StatRow({ value, label, tone = '', children }) {
  return (
    <div className="card stat-row">
      <div className={`big-number${tone ? ` text-${tone}` : ''}`}>{value}</div>
      <div>
        <div className="stat-row-label">{label}</div>
        <p className="stat-row-text">{children}</p>
      </div>
    </div>
  );
}

// One report: a card with a table and a CSV export of every row (even when only a preview is shown).
// columns: [{ label, render?(row) }]; csv: rows of plain values for export.
// limit + onShowAll: show only the first `limit` rows and a "Show all" button that opens the full list.
function ReportTable({ title, description, columns, rows, csv, empty, filename, term, limit, onShowAll, compact }) {
  const visible = limit ? rows.slice(0, limit) : rows;
  return (
    <Card
      flush
      title={<>{title} <span className="muted">· {rows.length}</span></>}
      sub={description}
      actions={(
        <button type="button" className="btn btn-ghost btn-sm" disabled={!rows.length}
          onClick={() => downloadCsv([columns.map((c) => c.label), ...csv], `${filename}-${term.toLowerCase().replaceAll(' ', '-')}.csv`)}>
          <Icon name="download" size={15} /> CSV<span className="sr-only">: {title}</span>
        </button>
      )}
    >
      <div className="table-wrap">
        <table className={`data-table${compact ? ' data-table-compact' : ''}`}>
          <caption className="sr-only">{title}</caption>
          <thead><tr>{columns.map((c) => <th key={c.label} scope="col">{c.label}</th>)}</tr></thead>
          <tbody>
            {visible.length ? visible.map((row, i) => (
              <tr key={i}>{columns.map((c, j) => <td key={c.label} className={j === 0 ? 'strong nowrap' : c.className}>{c.render(row)}</td>)}</tr>
            )) : <tr><td colSpan={columns.length} className="empty-cell">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
      {limit && rows.length > limit && (
        <div className="card-foot row-between">
          <span>Showing {limit} of {rows.length}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onShowAll}>Show all {rows.length}</button>
        </div>
      )}
    </Card>
  );
}

export default function CommitteeReports({ term, refreshKey }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  // Which pop-up is open: 'workload' | 'unmatched' | 'outstanding' | { observation } (one next-action explanation).
  const [dialog, setDialog] = useState(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const openNextAction = useCallback((observation) => setDialog({ observation }), []);

  useEffect(() => {
    if (!term) return;
    let cancelled = false;
    Promise.all([api.kpis(term), api.unmatched(term, true), api.outstanding(term)])
      .then(([kpis, unmatched, outstanding]) => {
        if (!cancelled) setReport({ kpis: kpis.data, unmatched: unmatched.data, outstanding: outstanding.data, byLevel: outstanding.meta.by_hire_level });
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [term, refreshKey]);

  if (error) return <Notice tone="bad" title="Could not load reports">{error}</Notice>;
  if (!report) return <p className="muted">Loading committee reports…</p>;

  const workload = report.kpis.observer_workload;
  const active = workload.filter((p) => p.assigned > 0);
  const totalAssigned = active.reduce((s, p) => s + p.assigned, 0);
  const average = active.length ? totalAssigned / active.length : 0;
  const byLevel = report.byLevel.map((l) => `${l.hire_level_label} ${l.count}`).join(' · ') || 'none';

  return (
    <div className="stack">
      <StatRow value={active.length} label="Assigned observers">
        Faculty observing at least one colleague this cycle. Signing up alone doesn't count; a professor has to
        actually be paired with someone. Every assignment counts, whether it's scheduled, completed or missed.
      </StatRow>
      <StatRow value={average.toFixed(1)} label="Avg observations per assigned observer">
        On average, each assigned observer has this many observations ({totalAssigned} in total). Faculty with none are
        left out, so this shows how busy the active observers are, not how evenly the work is spread.
        See Observer workload below for each person's count.
      </StatRow>
      <StatRow value={report.outstanding.length} tone="warn" label={`Outstanding · ${byLevel}`}>
        Observations this term that aren't finished yet: they still need an observer, a date, a confirmation, or a
        follow-up after a missed session. Split by the observee's hiring level. Each one is listed with its next step in
        Outstanding observations below.
      </StatRow>
      <p className="faint">Reports update as faculty sign up, select observers and confirm observations. Workload counts every assignment this cycle, including completed and missed ones.</p>

      <div className="stack">
        <ReportTable
          term={term} filename="evaluation-by-level" title="Due by hiring level"
          description="Assistant every calendar year; Associate and Full every two years"
          rows={report.kpis.faculty_due_by_hire_level}
          columns={[
            { label: 'Hiring level', render: (p) => p.hire_level_label },
            { label: 'Due', render: (p) => <span className="num">{p.due}</span> },
            { label: 'Overdue', render: (p) => <span className="num text-bad">{p.overdue}</span> },
            { label: 'Total needing evaluation', render: (p) => <strong className="num">{p.due + p.overdue}</strong> },
          ]}
          csv={report.kpis.faculty_due_by_hire_level.map((p) => [p.hire_level_label, p.due, p.overdue, p.due + p.overdue])}
          empty="No faculty records available."
        />
        <ReportTable
          term={term} filename="observer-workload" title="Observer workload"
          description="All faculty, so unused capacity is visible"
          rows={workload} limit={PREVIEW_ROWS} onShowAll={() => setDialog('workload')}
          columns={[
            { label: 'Professor', render: (p) => p.name },
            { label: 'Major', render: (p) => p.major },
            { label: 'Assigned', render: (p) => <strong className="num">{p.assigned}</strong> },
            { label: 'Completed', render: (p) => <span className="num">{p.completed}</span> },
            { label: 'Pending', render: (p) => <span className="num">{p.pending}</span> },
            { label: 'Missed', render: (p) => <span className={`num${p.missed ? ' text-bad' : ''}`}>{p.missed}</span> },
          ]}
          csv={workload.map((p) => [p.name, p.major, p.assigned, p.completed, p.pending, p.missed])}
          empty="No faculty records available."
        />
      </div>

      <ReportTable
        term={term} filename="unmatched-faculty" title="Unmatched faculty"
        description="No eligible observer candidates first, then other due or overdue faculty without an observer"
        rows={report.unmatched} limit={PREVIEW_ROWS} onShowAll={() => setDialog('unmatched')}
        columns={[
          { label: 'Professor', render: (p) => p.name },
          { label: 'Major', render: (p) => p.major },
          { label: 'Level', render: (p) => p.hire_level_label },
          { label: 'Evaluation status', render: (p) => { const [l, t] = DUE[p.evaluation_status] || [p.evaluation_status, 'neutral']; return <Badge tone={t}>{l}</Badge>; } },
          { label: 'Course', className: 'nowrap', render: (p) => <span className="mono">{p.course_code || '—'}</span> },
          { label: 'Next action', render: (p) => p.reason },
        ]}
        csv={report.unmatched.map((p) => [p.name, p.major, p.hire_level_label, (DUE[p.evaluation_status] || [p.evaluation_status])[0], p.course_code || '—', p.reason])}
        empty="All due and overdue faculty have an observer assignment."
      />
      <ReportTable
        term={term} filename="outstanding-observations" title="Outstanding observations"
        description="Signed-up observations that are not complete, including missed sessions that need follow-up"
        rows={report.outstanding} limit={PREVIEW_ROWS} onShowAll={() => setDialog('outstanding')} compact
        columns={[
          { label: 'Observee', render: (o) => o.observee_name },
          { label: 'Hiring level', render: (o) => o.hire_level_label },
          { label: 'Observer', className: 'nowrap', render: (o) => o.observer_name || '—' },
          { label: 'Course', className: 'nowrap', render: (o) => <span className="mono">{o.course_code}</span> },
          { label: 'Schedule', className: 'nowrap', render: scheduleOf },
          { label: 'Status', render: (o) => { const [l, t] = STATUS[o.status] || [o.status, 'neutral']; return <Badge tone={t}>{l}</Badge>; } },
          { label: 'Next action', className: 'nowrap', render: (o) => <NextActionButton observation={o} onOpen={openNextAction} /> },
        ]}
        csv={report.outstanding.map((o) => [o.observee_name, o.hire_level_label, o.observer_name || '—', o.course_code, scheduleOf(o), (STATUS[o.status] || [o.status])[0], nextDetail(o)])}
        empty="No outstanding observations."
      />
      {dialog === 'workload' && <WorkloadDialog workload={workload} onClose={closeDialog} />}
      {dialog === 'unmatched' && <UnmatchedDialog faculty={report.unmatched} onClose={closeDialog} />}
      {dialog === 'outstanding' && <OutstandingDialog observations={report.outstanding} onClose={closeDialog} />}
      {dialog?.observation && <NextActionDialog observation={dialog.observation} onClose={closeDialog} />}
    </div>
  );
}
