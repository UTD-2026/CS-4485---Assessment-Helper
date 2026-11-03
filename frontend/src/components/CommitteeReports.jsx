import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { formatTiming } from '../api/adapters.js';
import { downloadCsv } from '../utils/facultyCsv.js';

// Committee Reports (from the sriproflookup branch). The tables now come from the backend:
//   GET /api/reports/kpis                      -> faculty due by hire level, observer workload
//   GET /api/reports/unmatched-faculty         -> unmatched faculty (include=all_due for every due/overdue professor)
//   GET /api/reports/outstanding-observations  -> outstanding observations + breakdown by hire level

// nowrap: header names whose column should stay on a single line
function ReportTable({ title, description, headers, rows, empty, filename, term, nowrap = [] }) {
  const cls = (j) => (nowrap.includes(headers[j]) ? 'nowrap' : undefined);
  return (
    <section className="bento-card full-span">
      <div className="report-heading">
        <h3>{title}</h3>
        <button type="button" className="btn-secondary btn-3d" disabled={!rows.length}
          onClick={() => downloadCsv([headers, ...rows], `${filename}-${term.toLowerCase().replaceAll(' ', '-')}.csv`)}>
          Export CSV<span className="report-sr-only">: {title}</span>
        </button>
      </div>
      <p className="subtitle">{description}</p>
      <div className="faculty-table-wrapper">
        <table className="data-table">
          <caption className="report-sr-only">{title}</caption>
          <thead><tr>{headers.map((h, j) => <th key={h} scope="col" className={cls(j)}>{h}</th>)}</tr></thead>
          <tbody>{rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className={cls(j)}>{cell}</td>)}</tr>)
            : <tr><td colSpan={headers.length} className="faculty-empty">{empty}</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

const STATUS = {
  signed_up: 'Signed up', unmatched: 'No eligible observer', matched: 'Pending scheduling', scheduled: 'Scheduled',
  awaiting_confirmation: 'Awaiting confirmation', missed: 'Missed',
};
const DUE = { due: 'Due', overdue: 'Overdue', not_due: 'Not due' };

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

  if (error) return <div className="bento-card full-span"><p style={{ color: '#b91c1c' }}>Could not load reports: {error}</p></div>;
  if (!report) return <div className="bento-card full-span"><p className="subtitle">Loading committee reports…</p></div>;

  const workload = report.kpis.observer_workload;
  const active = workload.filter(p => p.assigned > 0);
  const average = active.length ? active.reduce((s, p) => s + p.assigned, 0) / active.length : 0;

  return (
    <div className="bento-grid">
      <div className="bento-card full-span">
        <h3>Committee Reports — {term}</h3>
        <p className="subtitle">Current-cycle reports from the database. They update as faculty sign up, select observers, and confirm observations.</p>
        <p><strong>{active.length}</strong> assigned observers · <strong>{average.toFixed(1)}</strong> average observations per assigned observer · <strong>{report.outstanding.length}</strong> outstanding observations ({report.byLevel.map(l => `${l.hire_level_label} ${l.count}`).join(', ') || 'none'})</p>
        <p className="report-note">Workload includes all assignments this cycle, including completed and missed observations.</p>
      </div>
      <ReportTable term={term} title="Faculty Due by Hiring Level" description="Due and overdue counts follow the committee's evaluation rules (Assistant: every calendar year; Associate/Full: every two years)."
        headers={['Hiring level', 'Due', 'Overdue', 'Total needing evaluation']}
        rows={report.kpis.faculty_due_by_hire_level.map(p => [p.hire_level_label, p.due, p.overdue, p.due + p.overdue])}
        empty="No faculty records available." filename="evaluation-by-level" />
      <ReportTable term={term} title="Unmatched Faculty" description="Professors with no eligible observer candidates first, then other due or overdue faculty without an observer assignment."
        headers={['Professor', 'Department', 'Level', 'Evaluation status', 'Course', 'Next action']}
        rows={report.unmatched.map(p => [p.name, p.department, p.hire_level_label, DUE[p.evaluation_status] || p.evaluation_status, p.course_code || '—', p.reason])}
        empty="All due and overdue faculty have an observer assignment." filename="unmatched-faculty"
        nowrap={['Professor', 'Course']} />
      <ReportTable term={term} title="Outstanding Observations" description="Signed-up observations that are not complete, including missed sessions that need follow-up."
        headers={['Observee', 'Hiring level', 'Observer', 'Course', 'Schedule', 'Status', 'Next action']}
        rows={report.outstanding.map(o => [o.observee_name, o.hire_level_label, o.observer_name || '—', o.course_code, [o.observation_date, formatTiming(o.timing)].filter(Boolean).join(' — '), STATUS[o.status] || o.status, o.next_action])}
        empty="No outstanding observations." filename="outstanding-observations"
        nowrap={['Observee', 'Observer', 'Course', 'Schedule']} />
      <ReportTable term={term} title="Observer Workload" description="All faculty are included so the committee can identify unused capacity."
        headers={['Professor', 'Department', 'Assigned', 'Completed', 'Pending', 'Missed']}
        rows={workload.map(p => [p.name, p.department, p.assigned, p.completed, p.pending, p.missed])}
        empty="No faculty records available." filename="observer-workload" />
    </div>
  );
}
