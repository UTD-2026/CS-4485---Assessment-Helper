import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { formatTiming } from '../api/adapters.js';
import { downloadCsv } from '../utils/facultyCsv.js';
import Icon from './Icon.jsx';
import { Badge, Card, Notice } from './ui.jsx';

// Committee Reports (from the sriproflookup branch). The tables come from the backend:
//   GET /api/reports/kpis                      -> faculty due by hire level, observer workload
//   GET /api/reports/unmatched-faculty         -> unmatched faculty (include=all_due for every due/overdue professor)
//   GET /api/reports/outstanding-observations  -> outstanding observations + breakdown by hire level

const STATUS = {
  signed_up: ['Signed up', 'neutral'], unmatched: ['No eligible observer', 'bad'], matched: ['Pending scheduling', 'warn'],
  scheduled: ['Scheduled', 'info'], awaiting_confirmation: ['Awaiting confirmation', 'warn'], missed: ['Missed', 'bad'],
};
const DUE = { due: ['Due', 'warn'], overdue: ['Overdue', 'bad'], not_due: ['Not due', 'neutral'] };

// One report: a card with a table and a CSV export of exactly what the table shows.
// columns: [{ label, render?(row) }]; csv: rows of plain values for export.
function ReportTable({ title, description, columns, rows, csv, empty, filename, term }) {
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
        <table className="data-table">
          <caption className="sr-only">{title}</caption>
          <thead><tr>{columns.map((c) => <th key={c.label} scope="col">{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map((row, i) => (
              <tr key={i}>{columns.map((c, j) => <td key={c.label} className={j === 0 ? 'strong nowrap' : c.className}>{c.render(row)}</td>)}</tr>
            )) : <tr><td colSpan={columns.length} className="empty-cell">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function CommitteeReports({ term, refreshKey }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

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
  const average = active.length ? active.reduce((s, p) => s + p.assigned, 0) / active.length : 0;
  const byLevel = report.byLevel.map((l) => `${l.hire_level_label} ${l.count}`).join(' · ') || 'none';
  const schedule = (o) => [o.observation_date, formatTiming(o.timing)].filter(Boolean).join(' · ') || '—';

  return (
    <div className="stack">
      <div className="grid grid-200">
        <div className="card"><div className="big-number">{active.length}</div><div className="muted">assigned observers</div></div>
        <div className="card"><div className="big-number">{average.toFixed(1)}</div><div className="muted">avg observations per assigned observer</div></div>
        <div className="card"><div className="big-number text-warn">{report.outstanding.length}</div><div className="muted">outstanding · {byLevel}</div></div>
      </div>
      <p className="faint">Reports update as faculty sign up, select observers and confirm observations. Workload counts every assignment this cycle, including completed and missed ones.</p>

      <div className="grid grid-420">
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
          rows={workload}
          columns={[
            { label: 'Professor', render: (p) => p.name },
            { label: 'Department', render: (p) => p.department },
            { label: 'Assigned', render: (p) => <strong className="num">{p.assigned}</strong> },
            { label: 'Completed', render: (p) => <span className="num">{p.completed}</span> },
            { label: 'Pending', render: (p) => <span className="num">{p.pending}</span> },
            { label: 'Missed', render: (p) => <span className={`num${p.missed ? ' text-bad' : ''}`}>{p.missed}</span> },
          ]}
          csv={workload.map((p) => [p.name, p.department, p.assigned, p.completed, p.pending, p.missed])}
          empty="No faculty records available."
        />
      </div>

      <ReportTable
        term={term} filename="unmatched-faculty" title="Unmatched faculty"
        description="No eligible observer candidates first, then other due or overdue faculty without an observer"
        rows={report.unmatched}
        columns={[
          { label: 'Professor', render: (p) => p.name },
          { label: 'Department', render: (p) => p.department },
          { label: 'Level', render: (p) => p.hire_level_label },
          { label: 'Evaluation status', render: (p) => { const [l, t] = DUE[p.evaluation_status] || [p.evaluation_status, 'neutral']; return <Badge tone={t}>{l}</Badge>; } },
          { label: 'Course', className: 'nowrap', render: (p) => <span className="mono">{p.course_code || '—'}</span> },
          { label: 'Next action', render: (p) => p.reason },
        ]}
        csv={report.unmatched.map((p) => [p.name, p.department, p.hire_level_label, (DUE[p.evaluation_status] || [p.evaluation_status])[0], p.course_code || '—', p.reason])}
        empty="All due and overdue faculty have an observer assignment."
      />
      <ReportTable
        term={term} filename="outstanding-observations" title="Outstanding observations"
        description="Signed-up observations that are not complete, including missed sessions that need follow-up"
        rows={report.outstanding}
        columns={[
          { label: 'Observee', render: (o) => o.observee_name },
          { label: 'Hiring level', render: (o) => o.hire_level_label },
          { label: 'Observer', className: 'nowrap', render: (o) => o.observer_name || '—' },
          { label: 'Course', className: 'nowrap', render: (o) => <span className="mono">{o.course_code}</span> },
          { label: 'Schedule', className: 'nowrap', render: schedule },
          { label: 'Status', render: (o) => { const [l, t] = STATUS[o.status] || [o.status, 'neutral']; return <Badge tone={t}>{l}</Badge>; } },
          { label: 'Next action', render: (o) => o.next_action },
        ]}
        csv={report.outstanding.map((o) => [o.observee_name, o.hire_level_label, o.observer_name || '—', o.course_code, schedule(o), (STATUS[o.status] || [o.status])[0], o.next_action])}
        empty="No outstanding observations."
      />
    </div>
  );
}
