import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Badge } from './ui.jsx';
import { VIOLATION_TYPES } from '../utils/kpis.js';
import { DUE, STATUS, nextActor, nextDetail, nextShort, scheduleOf } from '../utils/nextSteps.js';

/*
 * Pop-up lists opened from the committee's Live metrics page (same look as the login page's Test accounts dialog):
 *  - PairingsDialog: every audited pairing that breaks an eligibility rule (KPI 1a)
 *  - MissingDialog:  every approved appointment that did not go through (KPI 4a)
 * Each has a search box plus dropdown filters, and a live "Showing X of Y" count.
 */

// Rule codes are written "c:" rather than "(c)", which some fonts turn into the © symbol.
// Shared shell: overlay, header with close button, filter bar, scrolling body, footer. Esc or a click outside closes it.
// paused: a smaller dialog is open on top, so Esc should close that one only.
export function ListDialog({ titleId, title, sub, filters, footer, onClose, paused, children }) {
  useEffect(() => {
    if (paused) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, paused]);

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

/* ---------- Committee reports: full observer workload ---------- */

const LOAD_FILTERS = {
  assigned: { label: 'Has assignments', test: (p) => p.assigned > 0 },
  none: { label: 'No assignments (unused capacity)', test: (p) => p.assigned === 0 },
  pending: { label: 'Has pending', test: (p) => p.pending > 0 },
  missed: { label: 'Has missed', test: (p) => p.missed > 0 },
};
const LOAD_SORTS = {
  assigned: { label: 'Most assigned first', fn: (a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name) },
  name: { label: 'Name A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
  pending: { label: 'Most pending first', fn: (a, b) => b.pending - a.pending || a.name.localeCompare(b.name) },
  missed: { label: 'Most missed first', fn: (a, b) => b.missed - a.missed || a.name.localeCompare(b.name) },
};

export function WorkloadDialog({ workload, onClose }) {
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  const [load, setLoad] = useState('all');
  const [sort, setSort] = useState('assigned');
  const searchRef = useAutoFocus();

  const departments = useMemo(() => [...new Set(workload.map((p) => p.department).filter(Boolean))].sort(), [workload]);
  const loadCounts = useMemo(() => Object.fromEntries(Object.entries(LOAD_FILTERS).map(([k, f]) => [k, workload.filter(f.test).length])), [workload]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workload
      .filter((p) => (dept === 'all' || p.department === dept) && (load === 'all' || LOAD_FILTERS[load].test(p)) && matches(q, p.name, p.department))
      .sort(LOAD_SORTS[sort].fn);
  }, [workload, query, dept, load, sort]);
  const filtered = query || dept !== 'all' || load !== 'all';

  return (
    <ListDialog
      titleId="workload-title" title="Observer workload" onClose={onClose}
      sub={`${workload.length} faculty · ${loadCounts.assigned} observing this cycle · ${loadCounts.none} with no assignments`}
      filters={<>
        <input ref={searchRef} className="input" type="search" placeholder="Search by professor or department" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search observers" />
        <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
          <option value="all">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="select" value={load} onChange={(e) => setLoad(e.target.value)} aria-label="Filter by workload">
          <option value="all">Any workload</option>
          {Object.entries(LOAD_FILTERS).map(([key, f]) => <option key={key} value={key}>{f.label} · {loadCounts[key]}</option>)}
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
          {Object.entries(LOAD_SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
        </select>
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setDept('all'); setLoad('all'); }}>Clear</button>}
      </>}
      footer={`Showing ${shown.length} of ${workload.length}. Assigned counts every assignment this cycle: completed, pending and missed.`}
    >
      <table className="data-table">
        <thead><tr><th>Professor</th><th>Department</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>Missed</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan="6" className="empty-cell">No faculty match these filters.</td></tr>}
          {shown.map((p, i) => (
            <tr key={`${p.email || p.name}-${i}`}>
              <td className="strong nowrap">{p.name}</td>
              <td>{p.department}</td>
              <td><strong className="num">{p.assigned}</strong></td>
              <td><span className="num">{p.completed}</span></td>
              <td><span className="num">{p.pending}</span></td>
              <td><span className={`num${p.missed ? ' text-bad' : ''}`}>{p.missed}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListDialog>
  );
}

/* ---------- Committee reports: unmatched faculty ---------- */

const countBy = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
const optionsOf = (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();

export function UnmatchedDialog({ faculty, onClose }) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [due, setDue] = useState('all');
  const [reason, setReason] = useState('all');
  const searchRef = useAutoFocus();

  const levels = useMemo(() => optionsOf(faculty, 'hire_level_label'), [faculty]);
  const reasons = useMemo(() => optionsOf(faculty, 'reason'), [faculty]);
  const reasonCounts = useMemo(() => countBy(faculty, 'reason'), [faculty]);
  const dueCounts = useMemo(() => countBy(faculty, 'evaluation_status'), [faculty]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faculty.filter((p) =>
      (level === 'all' || p.hire_level_label === level) &&
      (due === 'all' || p.evaluation_status === due) &&
      (reason === 'all' || p.reason === reason) &&
      matches(q, p.name, p.department, p.course_code));
  }, [faculty, query, level, due, reason]);
  const filtered = query || level !== 'all' || due !== 'all' || reason !== 'all';

  return (
    <ListDialog
      titleId="unmatched-title" title="Unmatched faculty" onClose={onClose}
      sub={`${faculty.length} due or overdue faculty without an observer · ${dueCounts.overdue || 0} overdue · ${dueCounts.due || 0} due`}
      filters={<>
        <input ref={searchRef} className="input" type="search" placeholder="Search by professor, department or course" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search unmatched faculty" />
        <select className="select" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by hiring level">
          <option value="all">All levels</option>
          {levels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className="select" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Filter by evaluation status">
          <option value="all">Due + overdue</option>
          {['overdue', 'due'].map((k) => <option key={k} value={k}>{DUE[k][0]} only · {dueCounts[k] || 0}</option>)}
        </select>
        <select className="select" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Filter by next action">
          <option value="all">Any next action</option>
          {reasons.map((r) => <option key={r} value={r}>{r} · {reasonCounts[r]}</option>)}
        </select>
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setLevel('all'); setDue('all'); setReason('all'); }}>Clear</button>}
      </>}
      footer={`Showing ${shown.length} of ${faculty.length}.`}
    >
      <table className="data-table data-table-compact">
        <thead><tr><th>Professor</th><th>Department</th><th>Level</th><th>Evaluation status</th><th>Course</th><th>Next action</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan="6" className="empty-cell">No faculty match these filters.</td></tr>}
          {shown.map((p) => {
            const [label, tone] = DUE[p.evaluation_status] || [p.evaluation_status, 'neutral'];
            return (
              <tr key={p.email || p.name}>
                <td className="strong nowrap">{p.name}</td>
                <td>{p.department}</td>
                <td>{p.hire_level_label}</td>
                <td><Badge tone={tone}>{label}</Badge></td>
                <td className="mono nowrap">{p.course_code || '—'}</td>
                <td>{p.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ListDialog>
  );
}

/* ---------- Committee reports: outstanding observations ---------- */

// Compact "Who: what" preview of the next step; clicking it opens the full explanation.
export function NextActionButton({ observation, onOpen }) {
  return (
    <button type="button" className="next-action-btn" onClick={() => onOpen(observation)}
      title="See the full next step" aria-label={`Next action for ${observation.observee_name}: ${nextActor(observation)}, ${nextShort(observation)}. Show details`}>
      <span className="next-action-who">{nextActor(observation)}:</span>
      <span className="next-action-what">{nextShort(observation)}</span>
      <Icon name="info" size={14} />
    </button>
  );
}

// Small pop-up with the full next step for one observation.
export function NextActionDialog({ observation: o, onClose }) {
  const closeRef = useAutoFocus();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [label, tone] = STATUS[o.status] || [o.status, 'neutral'];

  return (
    <div className="dialog-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="dialog next-action-dialog" role="dialog" aria-modal="true" aria-labelledby="next-action-title" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2 id="next-action-title" className="card-title">{o.observee_name}</h2>
            <p className="card-sub">{o.hire_level_label} · <span className="mono">{o.course_code}</span></p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="next-action-body">
          <dl className="next-action-facts">
            <dt>Status</dt><dd><Badge tone={tone}>{label}</Badge></dd>
            <dt>Observer</dt><dd>{o.observer_name || '—'}</dd>
            <dt>Schedule</dt><dd>{scheduleOf(o)}</dd>
            <dt>Waiting on</dt><dd className="strong">{nextActor(o)}</dd>
          </dl>
          <p className="section-label">Next action</p>
          <p className="next-action-detail">{nextDetail(o)}</p>
        </div>
      </div>
    </div>
  );
}

export function OutstandingDialog({ observations, onClose }) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [status, setStatus] = useState('all');
  const [actor, setActor] = useState('all');
  const [detail, setDetail] = useState(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  const searchRef = useAutoFocus();

  const rows = useMemo(() => observations.map((o) => ({ ...o, actor: nextActor(o) })), [observations]);
  const levels = useMemo(() => optionsOf(rows, 'hire_level_label'), [rows]);
  const actors = useMemo(() => optionsOf(rows, 'actor'), [rows]);
  const statusCounts = useMemo(() => countBy(rows, 'status'), [rows]);
  const actorCounts = useMemo(() => countBy(rows, 'actor'), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((o) =>
      (level === 'all' || o.hire_level_label === level) &&
      (status === 'all' || o.status === status) &&
      (actor === 'all' || o.actor === actor) &&
      matches(q, o.observee_name, o.observer_name, o.course_code));
  }, [rows, query, level, status, actor]);
  const filtered = query || level !== 'all' || status !== 'all' || actor !== 'all';

  return (
    <ListDialog
      titleId="outstanding-title" title="Outstanding observations" onClose={onClose} paused={Boolean(detail)}
      sub={`${observations.length} observations not complete yet · ${statusCounts.missed || 0} missed`}
      filters={<>
        <input ref={searchRef} className="input" type="search" placeholder="Search by observee, observer or course" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search outstanding observations" />
        <select className="select" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by hiring level">
          <option value="all">All levels</option>
          {levels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">Any status</option>
          {Object.entries(STATUS).filter(([k]) => statusCounts[k]).map(([k, [l]]) => <option key={k} value={k}>{l} · {statusCounts[k]}</option>)}
        </select>
        <select className="select" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by who acts next">
          <option value="all">Waiting on anyone</option>
          {actors.map((a) => <option key={a} value={a}>{a} · {actorCounts[a]}</option>)}
        </select>
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setLevel('all'); setStatus('all'); setActor('all'); }}>Clear</button>}
      </>}
      footer={`Showing ${shown.length} of ${observations.length}. Click a next action to see the full explanation.`}
    >
      <table className="data-table data-table-compact">
        <thead><tr><th>Observee</th><th>Level</th><th>Observer</th><th>Course</th><th>Schedule</th><th>Status</th><th>Next action</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan="7" className="empty-cell">No observations match these filters.</td></tr>}
          {shown.map((o) => {
            const [label, tone] = STATUS[o.status] || [o.status, 'neutral'];
            return (
              <tr key={o.id}>
                <td className="strong nowrap">{o.observee_name}</td>
                <td>{o.hire_level_label}</td>
                <td className="nowrap">{o.observer_name || '—'}</td>
                <td className="mono nowrap">{o.course_code}</td>
                <td className="nowrap">{scheduleOf(o)}</td>
                <td><Badge tone={tone}>{label}</Badge></td>
                <td><NextActionButton observation={o} onOpen={setDetail} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {detail && <NextActionDialog observation={detail} onClose={closeDetail} />}
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
