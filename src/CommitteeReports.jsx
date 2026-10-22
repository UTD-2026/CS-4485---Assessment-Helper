import React from 'react';
import { buildCommitteeReports } from './committeeReports.js';
import { downloadCsv } from './facultyCsv.js';
import { currentSemester } from './mockDatabase.js';

function ReportTable({ title, description, headers, rows, empty, filename }) {
  return (
    <section className="bento-card full-span">
      <div className="report-heading">
        <h3>{title}</h3>
        <button type="button" className="btn-secondary btn-3d" disabled={!rows.length}
          onClick={() => downloadCsv([headers, ...rows], `${filename}-${currentSemester.toLowerCase().replaceAll(' ', '-')}.csv`)}>
          Export CSV<span className="report-sr-only">: {title}</span>
        </button>
      </div>
      <p className="subtitle">{description}</p>
      <div className="faculty-table-wrapper">
        <table className="data-table">
          <caption className="report-sr-only">{title}</caption>
          <thead><tr>{headers.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)
            : <tr><td colSpan={headers.length} className="faculty-empty">{empty}</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

export default function CommitteeReports({ signups, observations }) {
  const report = buildCommitteeReports(signups, observations);
  return (
    <div className="bento-grid">
      <div className="bento-card full-span">
        <h3>Committee Reports — {currentSemester}</h3>
        <p className="subtitle">Current-cycle reports update as faculty sign up, select observers, and confirm observations.</p>
        <p><strong>{report.activeObservers}</strong> assigned observers · <strong>{report.average.toFixed(1)}</strong> average observations per assigned observer</p>
        <p className="report-note">Workload includes all assignments this cycle, including completed and missed observations. This prototype keeps workflow data only until the page refreshes.</p>
      </div>
      <ReportTable title="Faculty Due by Hiring Level" description="Due and overdue counts follow the app’s existing semester-based evaluation rules."
        headers={['Hiring level', 'Due', 'Overdue', 'Total needing evaluation']}
        rows={report.byLevel.map(p => [p.level, p.due, p.overdue, p.due + p.overdue])}
        empty="No faculty records available." filename="evaluation-by-level" />
      <ReportTable title="Unmatched Faculty" description="Due or overdue faculty without a current observer assignment. Missed observations require reassignment."
        headers={['Professor', 'Department', 'Level', 'Evaluation status', 'Next action']}
        rows={report.unmatched.map(p => [p.name, p.department, p.hire_level, p.status, p.reason])}
        empty="All due and overdue faculty have an observer assignment." filename="unmatched-faculty" />
      <ReportTable title="Outstanding Observations" description="Assigned observations that are not complete, including missed sessions that need follow-up."
        headers={['Observee', 'Hiring level', 'Observer', 'Course', 'Schedule', 'Status', 'Next action']}
        rows={report.outstanding.map(o => [o.observeeName, o.hireLevel, o.observerName, o.courseCode, [o.observationDate, o.timing].filter(Boolean).join(' — '), o.status, o.nextAction])}
        empty="No outstanding observations." filename="outstanding-observations" />
      <ReportTable title="Observer Workload" description="All faculty are included so the committee can identify unused capacity."
        headers={['Professor', 'Department', 'Assigned', 'Completed', 'Pending', 'Missed']}
        rows={report.workload.map(p => [p.name, p.department, p.total, p.completed, p.pending, p.missed])}
        empty="No faculty records available." filename="observer-workload" />
    </div>
  );
}
