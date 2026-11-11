import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Badge } from './ui.jsx';
import { VIOLATION_TYPES } from '../utils/kpis.js';
import { DUE, STATUS, nextActor, nextDetail, nextShort, scheduleOf } from '../utils/nextSteps.js';
import { matches, countBy, optionsOf, MISSING_KINDS, kindOf } from '../utils/lists.js';
import { formatTiming } from '../api/adapters.js';

/*
 * Filterable lists for the committee pages. Each has a search box plus dropdown filters, and a live "Showing X of Y" count.
 *  - Inline panels on the metric detail pages (ListPanel):
 *      PairingsList: every audited pairing that breaks an eligibility rule (KPI 1a)
 *      MissingList:  every approved appointment that did not go through (KPI 4a)
 *  - Pop-ups on Committee reports (ListDialog, same look as the login page's Test accounts dialog).
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

// Same layout as ListDialog, but sits in the page as a card (used on the metric detail pages).
export function ListPanel({ titleId, title, sub, actions, filters, footer, children }) {
  return (
    <section className="card card-flush list-panel" aria-labelledby={titleId}>
      <div className="card-head">
        <div>
          <h2 id={titleId} className="card-title">{title}</h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {filters && <div className="dialog-filters">{filters}</div>}
      <div className="table-wrap">{children}</div>
      {footer && <p className="dialog-foot">{footer}</p>}
    </section>
  );
}

const useAutoFocus = () => {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
};

/* ---------- 1a: pairings that break a rule ---------- */

export function PairingsList({ pairings }) {
  const [query, setQuery] = useState('');
  const [rule, setRule] = useState('all');
  const [source, setSource] = useState('all');

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
    <ListPanel
      titleId="pairings-title" title="Pairings that break a rule"
      sub={`${pairings.length} pairings · ${pairings.length - confirmed} recommended · ${confirmed} confirmed`}
      filters={<>
        <input className="input" type="search" placeholder="Search by observer, observee, course or time" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search pairings" />
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
    </ListPanel>
  );
}

/* ---------- Shared "Advanced filtering" pop-up ---------- */

// One tickable option in the filter pop-up: a box that turns green with a check mark when on. Click again to untick.
function FilterCheck({ checked, onToggle, label, count, hint }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className={`filter-check${checked ? ' checked' : ''}`} onClick={onToggle} title={hint}>
      <span className="filter-check-box" aria-hidden="true">{checked && <Icon name="check" size={12} />}</span>
      <span className="filter-check-label">{label}</span>
      {count !== undefined && <span className="filter-check-count">{count}</span>}
    </button>
  );
}

// Tick/untick a value in one of the draft's list fields.
const toggleIn = (setDraft, key, value) =>
  setDraft((d) => ({ ...d, [key]: d[key].includes(value) ? d[key].filter((v) => v !== value) : [...d[key], value] }));
// Sorts keep the order they were picked in: the first one picked is the main sort, later ones break ties.
// Each sort group allows one direction; picking the other direction replaces it.
const toggleSortIn = (setDraft, pairs, key) =>
  setDraft((d) => ({ ...d, sorts: d.sorts.includes(key) ? d.sorts.filter((s) => s !== key) : [...d.sorts.filter((s) => s !== pairs[key]), key] }));
const sortBy = (rows, sorts, fns) =>
  (!sorts.length ? rows : [...rows].sort((a, b) => { for (const s of sorts) { const r = fns[s](a, b); if (r) return r; } return 0; }));
const countFilters = (f) => Object.values(f).reduce((n, v) => n + v.length, 0);

// Shell for the pop-up. Changes only take effect on Apply (or Reset); only X / Esc / outside click closes it.
// The plain text search stays outside, in the list's own search box.
function FilterDialog({ titleId, sub, draft, applied, onReset, onApply, onClose, groupsClassName = '', children }) {
  const closeRef = useAutoFocus();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const changed = JSON.stringify(draft) !== JSON.stringify(applied);

  return (
    <div className="dialog-overlay dialog-overlay-top" onClick={onClose}>
      <div className="dialog filter-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2 id={titleId} className="card-title">Advanced filtering</h2>
            <p className="card-sub">{sub}</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close filters"><Icon name="x" /></button>
        </div>
        <div className="filter-dialog-actions">
          <button type="button" className="btn filter-reset" onClick={onReset}>Reset filters</button>
        </div>
        <div className={`filter-groups ${groupsClassName}`.trim()}>{children}</div>
        <div className="filter-dialog-foot">
          <span className="faint">{changed ? 'You have changes that are not applied yet.' : 'Filters are up to date.'}</span>
          <button type="button" className="btn btn-primary" onClick={() => onApply(draft)}>Apply filters</button>
        </div>
      </div>
    </div>
  );
}

// Toolbar used by both pop-up lists: "More filters" button, search box, Clear.
function FilterToolbar({ openRef, searchRef, active, query, setQuery, placeholder, searchLabel, onOpen, onClear }) {
  return (
    <>
      <button ref={openRef} type="button" className="btn btn-ghost more-filters" onClick={onOpen} aria-haspopup="dialog">
        <Icon name="filters" size={18} />
        More filters
        {active > 0 && <span className="search-launch-count">{active}</span>}
      </button>
      <label className="search-field">
        <Icon name="search" size={16} />
        <input ref={searchRef} type="search" placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={searchLabel} />
      </label>
      {(active > 0 || query) && <button type="button" className="btn btn-ghost" onClick={onClear}>Clear</button>}
    </>
  );
}

/* ---------- Committee reports: full observer workload ---------- */

const WORKLOAD = [
  ['assigned', 'Assigned', 'At least 1 observation assigned this cycle'],
  ['completed', 'Completed', 'At least 1 observation held and signed off'],
  ['pending', 'Pending', 'At least 1 observation still waiting to happen'],
  ['missed', 'Missed', 'At least 1 observation that did not take place'],
  ['deferred', 'Deferred', 'At least 1 observation postponed'],
];
const countOf = (p, k) => p[k] ?? 0;
const WORKLOAD_SORTS = {
  nameAsc: (a, b) => a.name.localeCompare(b.name),
  nameDesc: (a, b) => b.name.localeCompare(a.name),
  ...Object.fromEntries(WORKLOAD.flatMap(([k]) => [
    [`${k}Least`, (a, b) => countOf(a, k) - countOf(b, k)],
    [`${k}Most`, (a, b) => countOf(b, k) - countOf(a, k)],
  ])),
};
const WORKLOAD_PAIRS = {
  nameAsc: 'nameDesc', nameDesc: 'nameAsc',
  ...Object.fromEntries(WORKLOAD.flatMap(([k]) => [[`${k}Least`, `${k}Most`], [`${k}Most`, `${k}Least`]])),
};
const EMPTY_WORKLOAD_FILTERS = { sorts: [], has: [] };

function WorkloadFilterDialog({ applied, hasCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggleSort = (key) => toggleSortIn(setDraft, WORKLOAD_PAIRS, key);
  const reset = () => { setDraft(EMPTY_WORKLOAD_FILTERS); onApply(EMPTY_WORKLOAD_FILTERS); };

  return (
    <FilterDialog titleId="workload-filter-title" sub="Sort and narrow the observer workload list. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-workload">
      <fieldset className="filter-group">
        <legend>Professor</legend>
        <FilterCheck label="Ascending (A–Z)" checked={draft.sorts.includes('nameAsc')} onToggle={() => toggleSort('nameAsc')} />
        <FilterCheck label="Descending (Z–A)" checked={draft.sorts.includes('nameDesc')} onToggle={() => toggleSort('nameDesc')} />
      </fieldset>
      <fieldset className="filter-group">
        <legend>Workload</legend>
        {WORKLOAD.map(([k, label, hint]) => (
          <FilterCheck key={k} label={label} hint={hint} count={hasCounts[k]} checked={draft.has.includes(k)} onToggle={() => toggleIn(setDraft, 'has', k)} />
        ))}
      </fieldset>
      <fieldset className="filter-group filter-group-wide">
        <legend>Sort by least / most</legend>
        <div className="filter-pairs">
          {WORKLOAD.map(([k, label]) => (
            <div key={k} className="filter-pair">
              <FilterCheck label={`Least ${label.toLowerCase()}`} checked={draft.sorts.includes(`${k}Least`)} onToggle={() => toggleSort(`${k}Least`)} />
              <FilterCheck label={`Most ${label.toLowerCase()}`} checked={draft.sorts.includes(`${k}Most`)} onToggle={() => toggleSort(`${k}Most`)} />
            </div>
          ))}
        </div>
      </fieldset>
    </FilterDialog>
  );
}

export function WorkloadDialog({ workload, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_WORKLOAD_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const hasCounts = useMemo(() => Object.fromEntries(WORKLOAD.map(([k]) => [k, workload.filter((p) => countOf(p, k) > 0).length])), [workload]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Ticked workload options widen the list: a professor shows if they have any of them.
    const rows = workload.filter((p) =>
      (!filters.has.length || filters.has.some((k) => countOf(p, k) > 0)) &&
      matches(q, p.name, p.department));
    return sortBy(rows, filters.sorts, WORKLOAD_SORTS);
  }, [workload, query, filters]);
  const active = countFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="workload-title" title="Observer workload" onClose={onClose} paused={filterOpen}
      sub={`${workload.length} faculty · ${hasCounts.assigned} observing this cycle · ${workload.length - hasCounts.assigned} with no assignments`}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by professor or department" searchLabel="Search observers"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_WORKLOAD_FILTERS); }} />
        {filterOpen && <WorkloadFilterDialog applied={filters} hasCounts={hasCounts} onApply={setFilters} onClose={closeFilters} />}
      </>}
      footer={`Showing ${shown.length} of ${workload.length}. Assigned counts every assignment this cycle: completed, pending, missed and deferred.`}
    >
      <table className="data-table data-table-compact">
        <thead><tr><th>Professor</th><th>Department</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>Missed</th><th>Deferred</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan="7" className="empty-cell">No faculty match these filters.</td></tr>}
          {shown.map((p, i) => (
            <tr key={`${p.email || p.name}-${i}`}>
              <td className="strong nowrap">{p.name}</td>
              <td>{p.department}</td>
              <td><strong className="num">{p.assigned}</strong></td>
              <td><span className="num">{p.completed}</span></td>
              <td><span className="num">{p.pending}</span></td>
              <td><span className={`num${p.missed ? ' text-bad' : ''}`}>{p.missed}</span></td>
              <td><span className="num">{countOf(p, 'deferred')}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListDialog>
  );
}

/* ---------- Committee reports: unmatched faculty ---------- */

// Course number from a code like "CS 3039" (no course sorts last either way).
const courseNum = (code) => { const m = /(\d+)/.exec(code || ''); return m ? Number(m[1]) : null; };
const SORTS = {
  nameAsc: (a, b) => a.name.localeCompare(b.name),
  nameDesc: (a, b) => b.name.localeCompare(a.name),
  courseAsc: (a, b) => { const x = courseNum(a.course_code), y = courseNum(b.course_code); return x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y; },
  courseDesc: (a, b) => { const x = courseNum(a.course_code), y = courseNum(b.course_code); return x === y ? 0 : x === null ? 1 : y === null ? -1 : y - x; },
};
const SORT_PAIRS = { nameAsc: 'nameDesc', nameDesc: 'nameAsc', courseAsc: 'courseDesc', courseDesc: 'courseAsc' };
const EMPTY_FILTERS = { sorts: [], levels: [], due: [], reasons: [] };

function UnmatchedFilterDialog({ applied, levels, reasons, levelCounts, dueCounts, reasonCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggle = (key, value) => toggleIn(setDraft, key, value);
  const toggleSort = (key) => toggleSortIn(setDraft, SORT_PAIRS, key);
  const reset = () => { setDraft(EMPTY_FILTERS); onApply(EMPTY_FILTERS); };

  return (
    <FilterDialog titleId="unmatched-filter-title" sub="Sort and narrow the unmatched faculty list. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose}>
      <fieldset className="filter-group">
        <legend>Professor</legend>
        <FilterCheck label="Ascending (A–Z)" checked={draft.sorts.includes('nameAsc')} onToggle={() => toggleSort('nameAsc')} />
        <FilterCheck label="Descending (Z–A)" checked={draft.sorts.includes('nameDesc')} onToggle={() => toggleSort('nameDesc')} />
      </fieldset>
      <fieldset className="filter-group">
        <legend>Level</legend>
        {levels.map((l) => <FilterCheck key={l} label={l} count={levelCounts[l]} checked={draft.levels.includes(l)} onToggle={() => toggle('levels', l)} />)}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Evaluation status</legend>
        {['due', 'overdue'].map((k) => <FilterCheck key={k} label={DUE[k][0]} count={dueCounts[k] || 0} checked={draft.due.includes(k)} onToggle={() => toggle('due', k)} />)}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Course</legend>
        <FilterCheck label="Ascending (1000 → 5000)" checked={draft.sorts.includes('courseAsc')} onToggle={() => toggleSort('courseAsc')} />
        <FilterCheck label="Descending (5000 → 1000)" checked={draft.sorts.includes('courseDesc')} onToggle={() => toggleSort('courseDesc')} />
      </fieldset>
      <fieldset className="filter-group filter-group-wide">
        <legend>Next action</legend>
        {reasons.map((r) => <FilterCheck key={r} label={r} count={reasonCounts[r]} checked={draft.reasons.includes(r)} onToggle={() => toggle('reasons', r)} />)}
      </fieldset>
    </FilterDialog>
  );
}

export function UnmatchedDialog({ faculty, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const levels = useMemo(() => optionsOf(faculty, 'hire_level_label'), [faculty]);
  const reasons = useMemo(() => optionsOf(faculty, 'reason'), [faculty]);
  const levelCounts = useMemo(() => countBy(faculty, 'hire_level_label'), [faculty]);
  const reasonCounts = useMemo(() => countBy(faculty, 'reason'), [faculty]);
  const dueCounts = useMemo(() => countBy(faculty, 'evaluation_status'), [faculty]);
  const shown = useMemo(() => {
    const { sorts, levels: lv, due, reasons: rs } = filters;
    const q = query.trim().toLowerCase();
    const rows = faculty.filter((p) =>
      (!lv.length || lv.includes(p.hire_level_label)) &&
      (!due.length || due.includes(p.evaluation_status)) &&
      (!rs.length || rs.includes(p.reason)) &&
      matches(q, p.name, p.department, p.course_code));
    return sortBy(rows, sorts, SORTS);
  }, [faculty, query, filters]);
  const active = countFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="unmatched-title" title="Unmatched faculty" onClose={onClose} paused={filterOpen}
      sub={`${faculty.length} due or overdue faculty without an observer · ${dueCounts.overdue || 0} overdue · ${dueCounts.due || 0} due`}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by professor, department or course" searchLabel="Search unmatched faculty"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_FILTERS); }} />
        {filterOpen && (
          <UnmatchedFilterDialog applied={filters} levels={levels} reasons={reasons} levelCounts={levelCounts} dueCounts={dueCounts} reasonCounts={reasonCounts}
            onApply={setFilters} onClose={closeFilters} />
        )}
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

// Class days ("MW" / "TR") from a timing like "MW 10:00 - 11:15" or "TR 10:00 AM - 11:15 AM".
const classDays = (timing) => { const d = formatTiming(timing).split(' ')[0].toUpperCase(); return d === 'TT' ? 'TR' : d || null; };
const daysOf = (o) => classDays(o.timing);
const OUTSTANDING_LEVELS = ['Assistant', 'Associate', 'Full'];
const OUTSTANDING_DAYS = [['MW', 'MW (Monday–Wednesday)'], ['TR', 'TR (Tuesday–Thursday)']];
// Filter labels, in the order shown. "Pending confirmation" is the awaiting_confirmation status.
const OUTSTANDING_STATUSES = [
  ['scheduled', 'Scheduled'], ['awaiting_confirmation', 'Pending confirmation'], ['matched', 'Pending scheduling'],
  ['unmatched', 'No eligible observer'], ['missed', 'Missed'], ['signed_up', 'Signed up'],
];
// Rows with no observer yet sort last in either direction.
const byObserver = (dir) => (a, b) => {
  const x = a.observer_name, y = b.observer_name;
  return x === y ? 0 : !x ? 1 : !y ? -1 : dir * x.localeCompare(y);
};
const OUTSTANDING_SORTS = {
  observeeAsc: (a, b) => a.observee_name.localeCompare(b.observee_name),
  observeeDesc: (a, b) => b.observee_name.localeCompare(a.observee_name),
  observerAsc: byObserver(1),
  observerDesc: byObserver(-1),
  courseAsc: SORTS.courseAsc,
  courseDesc: SORTS.courseDesc,
};
const OUTSTANDING_PAIRS = {
  observeeAsc: 'observeeDesc', observeeDesc: 'observeeAsc', observerAsc: 'observerDesc', observerDesc: 'observerAsc',
  courseAsc: 'courseDesc', courseDesc: 'courseAsc',
};
const EMPTY_OUTSTANDING_FILTERS = { sorts: [], levels: [], days: [], statuses: [] };

function OutstandingFilterDialog({ applied, levelCounts, dayCounts, statusCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggle = (key, value) => toggleIn(setDraft, key, value);
  const toggleSort = (key) => toggleSortIn(setDraft, OUTSTANDING_PAIRS, key);
  const reset = () => { setDraft(EMPTY_OUTSTANDING_FILTERS); onApply(EMPTY_OUTSTANDING_FILTERS); };
  const sortCheck = (key, label) => <FilterCheck label={label} checked={draft.sorts.includes(key)} onToggle={() => toggleSort(key)} />;

  return (
    <FilterDialog titleId="outstanding-filter-title" sub="Sort and narrow the outstanding observations list. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-outstanding">
      <fieldset className="filter-group">
        <legend>Observee</legend>
        {sortCheck('observeeAsc', 'Ascending (A–Z)')}
        {sortCheck('observeeDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Level</legend>
        {OUTSTANDING_LEVELS.map((l) => <FilterCheck key={l} label={l} count={levelCounts[l] || 0} checked={draft.levels.includes(l)} onToggle={() => toggle('levels', l)} />)}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Observer</legend>
        {sortCheck('observerAsc', 'Ascending (A–Z)')}
        {sortCheck('observerDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Course</legend>
        {sortCheck('courseAsc', 'Ascending (1000 → 5000)')}
        {sortCheck('courseDesc', 'Descending (5000 → 1000)')}
      </fieldset>
      <fieldset className="filter-group filter-group-nowrap">
        <legend>Schedule</legend>
        {OUTSTANDING_DAYS.map(([k, label]) => <FilterCheck key={k} label={label} count={dayCounts[k] || 0} checked={draft.days.includes(k)} onToggle={() => toggle('days', k)} />)}
      </fieldset>
      <fieldset className="filter-group filter-group-wide">
        <legend>Status</legend>
        <div className="filter-grid-2x3">
          {OUTSTANDING_STATUSES.map(([k, label]) => <FilterCheck key={k} label={label} count={statusCounts[k] || 0} checked={draft.statuses.includes(k)} onToggle={() => toggle('statuses', k)} />)}
        </div>
      </fieldset>
    </FilterDialog>
  );
}

export function OutstandingDialog({ observations, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_OUTSTANDING_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const rows = useMemo(() => observations.map((o) => ({ ...o, days: daysOf(o) })), [observations]);
  const levelCounts = useMemo(() => countBy(rows, 'hire_level_label'), [rows]);
  const dayCounts = useMemo(() => countBy(rows, 'days'), [rows]);
  const statusCounts = useMemo(() => countBy(rows, 'status'), [rows]);
  const shown = useMemo(() => {
    const { sorts, levels, days, statuses } = filters;
    const q = query.trim().toLowerCase();
    const kept = rows.filter((o) =>
      (!levels.length || levels.includes(o.hire_level_label)) &&
      (!days.length || days.includes(o.days)) &&
      (!statuses.length || statuses.includes(o.status)) &&
      matches(q, o.observee_name, o.observer_name, o.course_code));
    return sortBy(kept, sorts, OUTSTANDING_SORTS);
  }, [rows, query, filters]);
  const active = countFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="outstanding-title" title="Outstanding observations" onClose={onClose} paused={Boolean(detail) || filterOpen}
      sub={`${observations.length} observations not complete yet · ${statusCounts.missed || 0} missed`}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by observee, observer or course" searchLabel="Search outstanding observations"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_OUTSTANDING_FILTERS); }} />
        {filterOpen && (
          <OutstandingFilterDialog applied={filters} levelCounts={levelCounts} dayCounts={dayCounts} statusCounts={statusCounts}
            onApply={setFilters} onClose={closeFilters} />
        )}
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


export function MissingList({ missing }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');

  const rows = useMemo(() => missing.map((o) => ({ ...o, kind: kindOf(o) })), [missing]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(MISSING_KINDS).map((k) => [k, rows.filter((r) => r.kind === k).length])), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((o) => (kind === 'all' || o.kind === kind) && matches(q, o.observeeName, o.observerName, o.courseCode));
  }, [rows, query, kind]);
  const filtered = query || kind !== 'all';

  return (
    <ListPanel
      titleId="missing-title" title="Appointments that did not go through"
      sub={`${missing.length} approved appointments did not go through · ${counts.reported} reported not held · ${missing.length - counts.reported} not confirmed by the deadline`}
      filters={<>
        <input className="input" type="search" placeholder="Search by observee, observer or course" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search appointments" />
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
    </ListPanel>
  );
}

/* ---------- Signup monitor: toolbar + "Advanced filtering" pop-up ---------- */

// Rows are the Signup monitor's { signup, obs } pairs. Status is the observer list's match flag.
const SIGNUP_STATUSES = [
  ['OK', 'Satisfactory (5 eligible observers)'],
  ['INSUFFICIENT OBSERVERS', 'Insufficient (1–4 eligible observers)'],
  ['NO ELIGIBLE OBSERVER', 'No eligible observer (0 eligible observers)'],
];
const signupObserver = (r) => r.obs?.observerName || '';
const bySignupText = (get, dir) => (a, b) => {
  const x = get(a), y = get(b);
  return x === y ? 0 : !x ? 1 : !y ? -1 : dir * x.localeCompare(y);
};
const bySignupCourse = (dir) => (a, b) => {
  const x = courseNum(a.signup.courseCode), y = courseNum(b.signup.courseCode);
  return x === y ? 0 : x === null ? 1 : y === null ? -1 : dir * (x - y);
};
const SIGNUP_SORTS = {
  observeeAsc: bySignupText((r) => r.signup.observeeName, 1),
  observeeDesc: bySignupText((r) => r.signup.observeeName, -1),
  courseAsc: bySignupCourse(1),
  courseDesc: bySignupCourse(-1),
  observerAsc: bySignupText(signupObserver, 1), // sign-ups with no confirmed observer sort last either way
  observerDesc: bySignupText(signupObserver, -1),
};
const SIGNUP_PAIRS = {
  observeeAsc: 'observeeDesc', observeeDesc: 'observeeAsc', courseAsc: 'courseDesc', courseDesc: 'courseAsc',
  observerAsc: 'observerDesc', observerDesc: 'observerAsc',
};
export const EMPTY_SIGNUP_FILTERS = { sorts: [], days: [], statuses: [] };

// Search + ticked filters + sorts, applied to the Signup monitor rows.
export function applySignupFilters(rows, query, filters) {
  const q = query.trim().toLowerCase();
  const kept = rows.filter((r) =>
    (!filters.days.length || filters.days.includes(classDays(r.signup.timing))) &&
    (!filters.statuses.length || filters.statuses.includes(r.signup.matchFlag)) &&
    matches(q, r.signup.observeeName, r.signup.courseCode, signupObserver(r)));
  return sortBy(kept, filters.sorts, SIGNUP_SORTS);
}

function SignupFilterDialog({ applied, dayCounts, statusCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggle = (key, value) => toggleIn(setDraft, key, value);
  const toggleSort = (key) => toggleSortIn(setDraft, SIGNUP_PAIRS, key);
  const reset = () => { setDraft(EMPTY_SIGNUP_FILTERS); onApply(EMPTY_SIGNUP_FILTERS); };
  const sortCheck = (key, label) => <FilterCheck label={label} checked={draft.sorts.includes(key)} onToggle={() => toggleSort(key)} />;

  return (
    <FilterDialog titleId="signup-filter-title" sub="Sort and narrow the sign-up list. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-signups">
      <fieldset className="filter-group">
        <legend>Observee</legend>
        {sortCheck('observeeAsc', 'Ascending (A–Z)')}
        {sortCheck('observeeDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Course</legend>
        {sortCheck('courseAsc', 'Ascending (1000 → 5000)')}
        {sortCheck('courseDesc', 'Descending (5000 → 1000)')}
      </fieldset>
      <fieldset className="filter-group filter-group-nowrap">
        <legend>Days</legend>
        {OUTSTANDING_DAYS.map(([k, label]) => <FilterCheck key={k} label={label} count={dayCounts[k] || 0} checked={draft.days.includes(k)} onToggle={() => toggle('days', k)} />)}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Status</legend>
        {SIGNUP_STATUSES.map(([k, label]) => <FilterCheck key={k} label={label} count={statusCounts[k] || 0} checked={draft.statuses.includes(k)} onToggle={() => toggle('statuses', k)} />)}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Observer</legend>
        {sortCheck('observerAsc', 'Ascending (A–Z)')}
        {sortCheck('observerDesc', 'Descending (Z–A)')}
      </fieldset>
    </FilterDialog>
  );
}

// "More filters" button + search box for the Signup monitor page. The page owns query/filters so it can filter its own rows.
export function SignupFilters({ rows, query, setQuery, filters, setFilters }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const openRef = useRef(null);
  const dayCounts = useMemo(() => countBy(rows.map((r) => ({ d: classDays(r.signup.timing) })), 'd'), [rows]);
  const statusCounts = useMemo(() => countBy(rows.map((r) => r.signup), 'matchFlag'), [rows]);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, []);

  return (
    <div className="page-filters">
      <FilterToolbar openRef={openRef} active={countFilters(filters)} query={query} setQuery={setQuery}
        placeholder="Search by observee, observer or course" searchLabel="Search sign-ups"
        onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_SIGNUP_FILTERS); }} />
      {filterOpen && <SignupFilterDialog applied={filters} dayCounts={dayCounts} statusCounts={statusCounts} onApply={setFilters} onClose={closeFilters} />}
    </div>
  );
}

/* ---------- Digital evaluations: toolbar + "Advanced filtering" pop-up ---------- */

// Rows are submitted evaluation forms: { observeeName, observerName, courseCode, dateSubmitted }.
const byEvalCourse = (dir) => (a, b) => {
  const x = courseNum(a.courseCode), y = courseNum(b.courseCode);
  return x === y ? 0 : x === null ? 1 : y === null ? -1 : dir * (x - y);
};
// ISO dates compare correctly as text; forms with no date sort last either way.
const EVAL_SORTS = {
  observeeAsc: bySignupText((e) => e.observeeName, 1),
  observeeDesc: bySignupText((e) => e.observeeName, -1),
  courseAsc: byEvalCourse(1),
  courseDesc: byEvalCourse(-1),
  observerAsc: bySignupText((e) => e.observerName, 1),
  observerDesc: bySignupText((e) => e.observerName, -1),
  dateOldest: bySignupText((e) => e.dateSubmitted || '', 1),
  dateNewest: bySignupText((e) => e.dateSubmitted || '', -1),
};
const EVAL_PAIRS = {
  observeeAsc: 'observeeDesc', observeeDesc: 'observeeAsc', courseAsc: 'courseDesc', courseDesc: 'courseAsc',
  observerAsc: 'observerDesc', observerDesc: 'observerAsc', dateOldest: 'dateNewest', dateNewest: 'dateOldest',
};
export const EMPTY_EVAL_FILTERS = { sorts: [] };

export function applyEvaluationFilters(rows, query, filters) {
  const q = query.trim().toLowerCase();
  return sortBy(rows.filter((e) => matches(q, e.observeeName, e.observerName, e.courseCode)), filters.sorts, EVAL_SORTS);
}

function EvaluationFilterDialog({ applied, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggleSort = (key) => toggleSortIn(setDraft, EVAL_PAIRS, key);
  const reset = () => { setDraft(EMPTY_EVAL_FILTERS); onApply(EMPTY_EVAL_FILTERS); };
  const sortCheck = (key, label) => <FilterCheck label={label} checked={draft.sorts.includes(key)} onToggle={() => toggleSort(key)} />;

  return (
    <FilterDialog titleId="eval-filter-title" sub="Sort the submitted evaluation forms. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-evals">
      <fieldset className="filter-group">
        <legend>Observee</legend>
        {sortCheck('observeeAsc', 'Ascending (A–Z)')}
        {sortCheck('observeeDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Course</legend>
        {sortCheck('courseAsc', 'Ascending (1000 → 5000)')}
        {sortCheck('courseDesc', 'Descending (5000 → 1000)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Observer</legend>
        {sortCheck('observerAsc', 'Ascending (A–Z)')}
        {sortCheck('observerDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Date</legend>
        {sortCheck('dateOldest', 'Oldest first')}
        {sortCheck('dateNewest', 'Newest first')}
      </fieldset>
    </FilterDialog>
  );
}

// "More filters" button + search box for the Digital evaluations page.
export function EvaluationFilters({ query, setQuery, filters, setFilters }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const openRef = useRef(null);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, []);

  return (
    <div className="page-filters">
      <FilterToolbar openRef={openRef} active={countFilters(filters)} query={query} setQuery={setQuery}
        placeholder="Search by observee, observer or course" searchLabel="Search evaluations"
        onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_EVAL_FILTERS); }} />
      {filterOpen && <EvaluationFilterDialog applied={filters} onApply={setFilters} onClose={closeFilters} />}
    </div>
  );
}
