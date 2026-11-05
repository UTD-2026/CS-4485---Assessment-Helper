import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Badge } from './ui.jsx';
import { VIOLATION_TYPES } from '../utils/kpis.js';

/*
 * Pop-up lists opened from the committee's Live metrics page (same look as the login page's Test accounts dialog):
 *  - PairingsDialog: every audited pairing that breaks an eligibility rule (KPI 1a)
 *  - MissingDialog:  every approved appointment that did not go through (KPI 4a)
 * Each has a search box plus dropdown filters, and a live "Showing X of Y" count.
 */

// Rule codes are written "c:" rather than "(c)", which some fonts turn into the © symbol.
// Shared shell: overlay, header with close button, filter bar, scrolling body, footer. Esc or a click outside closes it.
function ListDialog({ titleId, title, sub, filters, footer, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2 id={titleId} className="card-title">{title}</h2>
            <p className="card-sub">{sub}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="dialog-filters">{filters}</div>
        <div className="dialog-body">{children}</div>
        <p className="dialog-foot">{footer}</p>
      </div>
    </div>
  );
}

const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
const useAutoFocus = () => {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
};

/* ---------- 1a: pairings that break a rule ---------- */

export function PairingsDialog({ pairings, onClose }) {
  const [query, setQuery] = useState('');
  const [rule, setRule] = useState('all');
  const [source, setSource] = useState('all');
  const searchRef = useAutoFocus();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pairings.filter((p) =>
      (rule === 'all' || p.violations.includes(rule)) &&
      (source === 'all' || p.source === source) &&
      matches(q, p.observerName, p.observeeName, p.courseCode, p.timing));
  }, [pairings, query, rule, source]);

  const ruleCounts = useMemo(() => Object.fromEntries(Object.keys(VIOLATION_TYPES).map((k) => [k, pairings.filter((p) => p.violations.includes(k)).length])), [pairings]);
  const confirmed = pairings.filter((p) => p.source === 'Confirmed').length;
  const filtered = query || rule !== 'all' || source !== 'all';

  return (
    <ListDialog
      titleId="pairings-title" title="Pairings that break a rule" onClose={onClose}
      sub={`${pairings.length} pairings · ${pairings.length - confirmed} recommended · ${confirmed} confirmed`}
      filters={<>
        <input ref={searchRef} className="input" type="search" placeholder="Search by observer, observee, course or time" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search pairings" />
        <select className="select" value={rule} onChange={(e) => setRule(e.target.value)} aria-label="Filter by rule broken">
          <option value="all">All rules</option>
          {Object.entries(VIOLATION_TYPES).map(([key, v]) => <option key={key} value={key}>{v.code}: {v.label} · {ruleCounts[key]}</option>)}
        </select>
        <select className="select" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source">
          <option value="all">Recommended + confirmed</option>
          <option value="Recommended">Recommended only</option>
          <option value="Confirmed">Confirmed only</option>
        </select>
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setRule('all'); setSource('all'); }}>Clear</button>}
      </>}
      footer={<>Showing {shown.length} of {pairings.length}. Rules: {Object.values(VIOLATION_TYPES).map((v) => `${v.code}: ${v.label}`).join(' · ')}</>}
    >
      <table className="data-table">
        <thead><tr><th>Observer</th><th>Observee</th><th>Course</th><th>Time</th><th>Source</th><th>Rules broken</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan="6" className="empty-cell">No pairings match these filters.</td></tr>}
          {shown.map((p, i) => (
            <tr key={`${p.source}-${p.observerName}-${p.observeeName}-${p.courseCode}-${i}`}>
              <td className="strong">{p.observerName}</td>
              <td>{p.observeeName}</td>
              <td className="mono nowrap">{p.courseCode}</td>
              <td className="nowrap">{p.timing}</td>
              <td><Badge tone={p.source === 'Confirmed' ? 'warn' : 'neutral'}>{p.source}</Badge></td>
              <td>
                <span className="row nowrap">
                  {p.violations.map((v) => <span key={v} className="code-chip code-chip-bad" title={VIOLATION_TYPES[v].label}>{VIOLATION_TYPES[v].code}</span>)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListDialog>
  );
}

/* ---------- 4a: approved appointments that did not go through ---------- */

const MISSING_KINDS = {
  reported: { label: 'Reported not held', tone: 'bad' },
  both: { label: 'Waiting on both', tone: 'warn' },
  observer: { label: 'Waiting on observer', tone: 'warn' },
  observee: { label: 'Waiting on observee', tone: 'warn' },
};
const kindOf = (o) => (o.status === 'Missed' ? 'reported'
  : !o.observerConfirmed && !o.observeeConfirmed ? 'both'
  : !o.observerConfirmed ? 'observer' : 'observee');

export function MissingDialog({ missing, onClose }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const searchRef = useAutoFocus();

  const rows = useMemo(() => missing.map((o) => ({ ...o, kind: kindOf(o) })), [missing]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(MISSING_KINDS).map((k) => [k, rows.filter((r) => r.kind === k).length])), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((o) => (kind === 'all' || o.kind === kind) && matches(q, o.observeeName, o.observerName, o.courseCode));
  }, [rows, query, kind]);
  const filtered = query || kind !== 'all';

  return (
    <ListDialog
      titleId="missing-title" title="Reported not held" onClose={onClose}
      sub={`${missing.length} approved appointments did not go through · ${counts.reported} reported not held · ${missing.length - counts.reported} not confirmed by the deadline`}
      filters={<>
        <input ref={searchRef} className="input" type="search" placeholder="Search by observee, observer or course" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search appointments" />
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by reason">
          <option value="all">All reasons</option>
          {Object.entries(MISSING_KINDS).map(([key, k]) => <option key={key} value={key}>{k.label} · {counts[key]}</option>)}
        </select>
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setKind('all'); }}>Clear</button>}
      </>}
      footer={`Showing ${shown.length} of ${missing.length}.`}
    >
      <table className="data-table">
        <thead><tr><th>Observee</th><th>Observer</th><th>Course</th><th>Reason</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan="4" className="empty-cell">No appointments match these filters.</td></tr>}
          {shown.map((o) => (
            <tr key={o.id}>
              <td className="strong">{o.observeeName}</td>
              <td>{o.observerName}</td>
              <td className="mono nowrap">{o.courseCode}</td>
              <td>
                <Badge tone={MISSING_KINDS[o.kind].tone}>{MISSING_KINDS[o.kind].label}</Badge>
                <span className="list-sub">{o.reason}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListDialog>
  );
}
