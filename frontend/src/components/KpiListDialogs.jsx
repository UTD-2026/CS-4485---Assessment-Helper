import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Badge } from './ui.jsx';
import { VIOLATION_TYPES } from '../utils/kpis.js';
import { DUE, STATUS, nextActor, nextDetail, nextShort, scheduleOf } from '../utils/nextSteps.js';
import { matches, countBy, optionsOf, MISSING_KINDS, kindOf } from '../utils/lists.js';
import { formatTiming } from '../api/adapters.js';
import { createFacultyCsv, downloadCsv } from '../utils/facultyCsv.js';
import { plural } from '../utils/format.js';

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

// The inline card shows the first PAIRINGS_PREVIEW rows; "Show all" opens the full list with search + Advanced filtering.
const PAIRINGS_PREVIEW = 8;
const pairingsSub = (pairings) => {
  const confirmed = pairings.filter((p) => p.source === 'Confirmed').length;
  return `${pairings.length} pairings · ${pairings.length - confirmed} recommended · ${confirmed} confirmed`;
};

export function PairingsList({ pairings }) {
  const [open, setOpen] = useState(false);
  const showAllRef = useRef(null);
  const close = useCallback(() => { setOpen(false); showAllRef.current?.focus(); }, []);
  const preview = pairings.slice(0, PAIRINGS_PREVIEW);

  return (
    <section className="card card-flush list-panel" aria-labelledby="pairings-title">
      <div className="card-head">
        <div>
          <h2 id="pairings-title" className="card-title">Pairings that break a rule</h2>
          <p className="card-sub">{pairingsSub(pairings)}</p>
        </div>
      </div>
      <div className="table-wrap"><PairingsTable rows={preview} /></div>
      <div className="card-foot row-between">
        <span>Showing {preview.length} of {pairings.length}</span>
        {pairings.length > PAIRINGS_PREVIEW && (
          <button ref={showAllRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">Show all {pairings.length}</button>
        )}
      </div>
      {open && <PairingsDialog pairings={pairings} onClose={close} />}
    </section>
  );
}

// Very short rule names for the filter pop-up; the full wording is in the tooltip and the list footer.
const RULE_SHORT = { SAME_PROF: 'Same professor', OTHER_DEPT: 'Other department', DIFFERENT_LEVEL: 'Different level', SCHEDULE_CONFLICT: 'Schedule conflict' };
const PAIRING_SOURCES = ['Recommended', 'Confirmed'];
const byPairingCourse = (dir) => (a, b) => {
  const x = courseNum(a.courseCode), y = courseNum(b.courseCode);
  return x === y ? 0 : x === null ? 1 : y === null ? -1 : dir * (x - y);
};
const PAIRING_SORTS = {
  observerAsc: (a, b) => a.observerName.localeCompare(b.observerName),
  observerDesc: (a, b) => b.observerName.localeCompare(a.observerName),
  observeeAsc: (a, b) => a.observeeName.localeCompare(b.observeeName),
  observeeDesc: (a, b) => b.observeeName.localeCompare(a.observeeName),
  courseAsc: byPairingCourse(1),
  courseDesc: byPairingCourse(-1),
};
const PAIRING_PAIRS = {
  observerAsc: 'observerDesc', observerDesc: 'observerAsc', observeeAsc: 'observeeDesc', observeeDesc: 'observeeAsc',
  courseAsc: 'courseDesc', courseDesc: 'courseAsc',
};
const EMPTY_PAIRING_FILTERS = { sorts: [], days: [], sources: [], rules: [] };

function PairingsFilterDialog({ applied, dayCounts, sourceCounts, ruleCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggle = (key, value) => toggleIn(setDraft, key, value);
  const toggleSort = (key) => toggleSortIn(setDraft, PAIRING_PAIRS, key);
  const reset = () => { setDraft(EMPTY_PAIRING_FILTERS); onApply(EMPTY_PAIRING_FILTERS); };
  const sortCheck = (key, label) => <FilterCheck label={label} checked={draft.sorts.includes(key)} onToggle={() => toggleSort(key)} />;

  return (
    <FilterDialog titleId="pairings-filter-title" sub="Sort and narrow the pairings that break a rule. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-pairings">
      <fieldset className="filter-group">
        <legend>Observer</legend>
        {sortCheck('observerAsc', 'Ascending (A–Z)')}
        {sortCheck('observerDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Observee</legend>
        {sortCheck('observeeAsc', 'Ascending (A–Z)')}
        {sortCheck('observeeDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group filter-group-nowrap">
        <legend>Course</legend>
        {sortCheck('courseAsc', 'Ascending (1000 → 5000)')}
        {sortCheck('courseDesc', 'Descending (5000 → 1000)')}
      </fieldset>
      <fieldset className="filter-group filter-group-nowrap">
        <legend>Days</legend>
        {OUTSTANDING_DAYS.map(([k, label]) => <FilterCheck key={k} label={label} count={dayCounts[k] || 0} checked={draft.days.includes(k)} onToggle={() => toggle('days', k)} />)}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Source</legend>
        {PAIRING_SOURCES.map((s) => <FilterCheck key={s} label={s} count={sourceCounts[s] || 0} checked={draft.sources.includes(s)} onToggle={() => toggle('sources', s)} />)}
      </fieldset>
      <fieldset className="filter-group filter-group-wide">
        <legend>Rules broken</legend>
        <div className="filter-grid-2x2">
          {Object.entries(VIOLATION_TYPES).map(([k, v]) => (
            <FilterCheck key={k} label={`${v.code}: ${RULE_SHORT[k] || v.label}`} hint={v.label} count={ruleCounts[k] || 0}
              checked={draft.rules.includes(k)} onToggle={() => toggle('rules', k)} />
          ))}
        </div>
      </fieldset>
    </FilterDialog>
  );
}

function PairingsDialog({ pairings, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_PAIRING_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const rows = useMemo(() => pairings.map((p) => ({ ...p, days: classDays(p.timing) })), [pairings]);
  const dayCounts = useMemo(() => countBy(rows, 'days'), [rows]);
  const sourceCounts = useMemo(() => countBy(rows, 'source'), [rows]);
  const ruleCounts = useMemo(() => Object.fromEntries(Object.keys(VIOLATION_TYPES).map((k) => [k, rows.filter((p) => p.violations.includes(k)).length])), [rows]);
  const shown = useMemo(() => {
    const { sorts, days, sources, rules } = filters;
    const q = query.trim().toLowerCase();
    // Ticked rules widen the list: a pairing shows if it breaks any of them.
    const kept = rows.filter((p) =>
      (!days.length || days.includes(p.days)) &&
      (!sources.length || sources.includes(p.source)) &&
      (!rules.length || rules.some((r) => p.violations.includes(r))) &&
      matches(q, p.observerName, p.observeeName, p.courseCode, p.timing));
    return sortBy(kept, sorts, PAIRING_SORTS);
  }, [rows, query, filters]);
  const active = countFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="pairings-dialog-title" title="Pairings that break a rule" onClose={onClose} paused={filterOpen}
      sub={pairingsSub(pairings)}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by observer, observee, course or time" searchLabel="Search pairings"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_PAIRING_FILTERS); }} />
        {filterOpen && (
          <PairingsFilterDialog applied={filters} dayCounts={dayCounts} sourceCounts={sourceCounts} ruleCounts={ruleCounts}
            onApply={setFilters} onClose={closeFilters} />
        )}
      </>}
      footer={<>Showing {shown.length} of {pairings.length}. Rules: {Object.values(VIOLATION_TYPES).map((v) => `${v.code}: ${v.label}`).join(' · ')}</>}
    >
      <PairingsTable rows={shown} compact />
    </ListDialog>
  );
}

function PairingsTable({ rows, compact }) {
  return (
      <table className={`data-table${compact ? ' data-table-compact' : ''}`}>
        <thead><tr><th>Observer</th><th>Observee</th><th>Course</th><th>Time</th><th>Source</th><th>Rules broken</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan="6" className="empty-cell">No pairings match these filters.</td></tr>}
          {rows.map((p, i) => (
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
  );
}

/* ---------- 1b: overdue faculty ---------- */

export const FACULTY_PREVIEW = 8;
// Evaluation status key for a professor: Overdue, Due or Not Due.
export const facultyStatus = (f) => (f.status === 'Overdue' || f.status === 'Due' ? f.status : 'Not Due');
const FACULTY_LEVELS = ['Assistant', 'Associate', 'Full'];
const FACULTY_CYCLE = [['signed', 'Signed up'], ['notSigned', 'Not signed up']];
const FACULTY_SORTS = {
  nameAsc: (a, b) => a.name.localeCompare(b.name),
  nameDesc: (a, b) => b.name.localeCompare(a.name),
  overdueLeast: (a, b) => (a.overdue_by || 0) - (b.overdue_by || 0),
  overdueMost: (a, b) => (b.overdue_by || 0) - (a.overdue_by || 0),
  notDueEarliest: (a, b) => byNextEval(a, b, 1),
  notDueLatest: (a, b) => byNextEval(a, b, -1),
};
const FACULTY_PAIRS = {
  nameAsc: 'nameDesc', nameDesc: 'nameAsc', overdueLeast: 'overdueMost', overdueMost: 'overdueLeast',
  notDueEarliest: 'notDueLatest', notDueLatest: 'notDueEarliest',
};
// Not-due faculty by their next evaluation term; anyone without one (or not "not due") sorts last either way.
function byNextEval(a, b, dir) {
  const x = facultyStatus(a) === 'Not Due' ? semesterKey(a.next_eval) : null;
  const y = facultyStatus(b) === 'Not Due' ? semesterKey(b.next_eval) : null;
  return x === y ? 0 : x === null ? 1 : y === null ? -1 : dir * (x - y);
}
// from / to: semesters like "Fall 2023" ('' = no limit). never: also / only show faculty never evaluated.
// statuses: Due (only on lists that hold every professor). Ticking a not-due sort adds the not-due professors,
// and ticking an overdue sort adds the overdue ones.
export const EMPTY_FACULTY_FILTERS = { sorts: [], levels: [], statuses: [], cycle: [], from: '', to: '', never: false };
const countFacultyFilters = (f) =>
  f.sorts.length + f.levels.length + f.statuses.length + f.cycle.length + (f.from || f.to ? 1 : 0) + (f.never ? 1 : 0);

// "Fall 2023" -> a number that orders semesters (Spring < Summer < Fall within a year). null if it can't be read.
const SEASONS = { Spring: 0, Summer: 1, Fall: 2 };
const semesterKey = (s) => {
  const m = /^(Spring|Summer|Fall)\s+(\d{4})$/.exec(String(s || '').trim());
  return m ? Number(m[2]) * 3 + SEASONS[m[1]] : null;
};
// Every Spring and Fall from the earliest evaluation on record up to the current term, newest first.
const semesterOptions = (faculty, term) => {
  const end = semesterKey(term);
  if (end === null) return [];
  const keys = faculty.map((f) => semesterKey(f.last_evaluation)).filter((k) => k !== null);
  const start = Math.min(end, ...keys);
  const out = [];
  for (let k = end; k >= start; k -= 1) {
    const season = Object.keys(SEASONS).find((s) => SEASONS[s] === k % 3);
    if (season !== 'Summer' || keys.includes(k)) out.push(`${season} ${Math.floor(k / 3)}`);
  }
  return out;
};

export function FacultyStatusBadge({ f }) {
  if (f.status === 'Overdue') return <Badge tone="bad">Overdue · {f.overdue_by} sem</Badge>;
  if (f.status === 'Due') return <Badge tone="warn">Due</Badge>;
  return <Badge tone="neutral">Not due{f.next_eval ? ` · next ${f.next_eval}` : ''}</Badge>;
}

export function FacultyTable({ rows, empty = 'No faculty match these filters.' }) {
  return (
    <table className="data-table data-table-compact">
      <thead><tr><th>Professor</th><th>Level</th><th>Department</th><th>Last evaluated</th><th>Status</th><th>This cycle</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan="6" className="empty-cell">{empty}</td></tr>}
        {rows.map((f) => (
          <tr key={f.professor_id}>
            <td className="strong nowrap">{f.name}</td>
            <td>{f.hire_level}</td>
            <td>{f.department}</td>
            <td className="mono">{f.last_evaluation || 'Never'}</td>
            <td className="nowrap"><FacultyStatusBadge f={f} /></td>
            <td><Badge tone={f.signedUp ? 'good' : 'warn'}>{f.signedUp ? 'Signed up' : 'Not signed up'}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function exportFacultyCsv(rows, term) {
  if (rows.length === 0) return;
  const url = URL.createObjectURL(new Blob([createFacultyCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `faculty-${String(term || 'cycle').toLowerCase().replaceAll(' ', '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// One end of the Last evaluated range: a semester dropdown (the current semester is the newest option).
function SemesterPicker({ id, label, value, options, disabled, onChange }) {
  return (
    <div className="semester-picker">
      <label htmlFor={id} className="semester-picker-label">{label}</label>
      <select id={id} className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

function FacultyFilterDialog({ applied, term, semesters, withStatuses, levelCounts, statusCounts, cycleCounts, neverCount, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggle = (key, value) => toggleIn(setDraft, key, value);
  const toggleSort = (key) => toggleSortIn(setDraft, FACULTY_PAIRS, key);
  const reset = () => { setDraft(EMPTY_FACULTY_FILTERS); onApply(EMPTY_FACULTY_FILTERS); };
  // Starting at the present semester leaves nothing later, so the end is locked to the present too.
  const startIsPresent = Boolean(draft.from) && draft.from === term;
  const setFrom = (from) => setDraft((d) => {
    const fk = semesterKey(from), tk = semesterKey(d.to);
    const to = from && from === term ? term : (fk !== null && tk !== null && tk < fk ? from : d.to);
    return { ...d, from, to };
  });
  const setTo = (to) => setDraft((d) => ({ ...d, to }));
  const fromKey = semesterKey(draft.from), toKey = semesterKey(draft.to);
  const fromOptions = semesters.filter((s) => toKey === null || semesterKey(s) <= toKey);
  const toOptions = semesters.filter((s) => fromKey === null || semesterKey(s) >= fromKey);
  // On the all-faculty list, either overdue option also shows every overdue professor, in that order.
  const overdueHint = withStatuses ? ' (shows every overdue professor)' : '';
  const overdueSorts = <>
    <FilterCheck label="Least overdue" hint={`Fewest semesters overdue first${overdueHint}`} checked={draft.sorts.includes('overdueLeast')} onToggle={() => toggleSort('overdueLeast')} />
    <FilterCheck label="Most overdue" hint={`Most semesters overdue first${overdueHint}`} checked={draft.sorts.includes('overdueMost')} onToggle={() => toggleSort('overdueMost')} />
  </>;

  return (
    <FilterDialog titleId="faculty-filter-title" sub="Sort and narrow the faculty list. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName={`filter-groups-faculty${withStatuses ? ' filter-groups-faculty-status' : ''}`}>
      <fieldset className="filter-group">
        <legend>Professor</legend>
        <FilterCheck label="Ascending (A–Z)" checked={draft.sorts.includes('nameAsc')} onToggle={() => toggleSort('nameAsc')} />
        <FilterCheck label="Descending (Z–A)" checked={draft.sorts.includes('nameDesc')} onToggle={() => toggleSort('nameDesc')} />
      </fieldset>
      <fieldset className="filter-group">
        <legend>Level</legend>
        {FACULTY_LEVELS.map((l) => <FilterCheck key={l} label={l} count={levelCounts[l] || 0} checked={draft.levels.includes(l)} onToggle={() => toggle('levels', l)} />)}
      </fieldset>
      <fieldset className={`filter-group${withStatuses ? ' filter-group-status' : ''}`}>
        <legend>Status</legend>
        {withStatuses ? (
          <div className="filter-grid-3x2">
            <FilterCheck label="Due" count={statusCounts.Due || 0} checked={draft.statuses.includes('Due')} onToggle={() => toggle('statuses', 'Due')} />
            <span aria-hidden="true" />
            <FilterCheck label="Earliest not due" hint="Every professor not due this semester, next evaluation soonest first"
              checked={draft.sorts.includes('notDueEarliest')} onToggle={() => toggleSort('notDueEarliest')} />
            <FilterCheck label="Latest not due" hint="Every professor not due this semester, next evaluation furthest away first"
              checked={draft.sorts.includes('notDueLatest')} onToggle={() => toggleSort('notDueLatest')} />
            {overdueSorts}
          </div>
        ) : overdueSorts}
      </fieldset>
      <fieldset className="filter-group">
        <legend>This cycle</legend>
        {FACULTY_CYCLE.map(([k, label]) => <FilterCheck key={k} label={label} count={cycleCounts[k] || 0} checked={draft.cycle.includes(k)} onToggle={() => toggle('cycle', k)} />)}
      </fieldset>
      <fieldset className="filter-group filter-group-full">
        <legend>Last evaluated</legend>
        <div className="semester-range">
          <SemesterPicker id="faculty-from" label="Start date" value={draft.from} options={fromOptions} onChange={setFrom} />
          <span className="semester-range-dash" aria-hidden="true">–</span>
          <SemesterPicker id="faculty-to" label="End date" value={draft.to} options={toOptions} disabled={startIsPresent} onChange={setTo} />
          <div className="semester-never">
            <FilterCheck label="Never" hint="Never evaluated before: this would be their first evaluation" count={neverCount}
              checked={draft.never} onToggle={() => setDraft((d) => ({ ...d, never: !d.never }))} />
          </div>
        </div>
      </fieldset>
    </FilterDialog>
  );
}

// Full faculty list with search and Advanced filtering.
// withStatuses: the list holds every professor, so Status also offers Not due / Due.
export function FacultyDialog({ faculty, term, title, sub, withStatuses = false, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_FACULTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const semesters = useMemo(() => semesterOptions(faculty, term), [faculty, term]);
  const levelCounts = useMemo(() => countBy(faculty, 'hire_level'), [faculty]);
  const cycleCounts = useMemo(() => {
    const signed = faculty.filter((f) => f.signedUp).length;
    return { signed, notSigned: faculty.length - signed };
  }, [faculty]);
  const neverCount = useMemo(() => faculty.filter((f) => !f.last_evaluation).length, [faculty]);
  const statusCounts = useMemo(() => countBy(faculty.map((f) => ({ s: facultyStatus(f) })), 's'), [faculty]);
  const shown = useMemo(() => {
    const { sorts, levels, statuses, cycle, from, to, never } = filters;
    const allowed = !withStatuses ? [] : [
      ...statuses,
      ...(sorts.some((s) => s.startsWith('notDue')) ? ['Not Due'] : []),
      ...(sorts.some((s) => s.startsWith('overdue')) ? ['Overdue'] : []),
    ];
    const fk = semesterKey(from), tk = semesterKey(to);
    const ranged = fk !== null || tk !== null;
    const q = query.trim().toLowerCase();
    const kept = faculty.filter((f) => {
      const k = semesterKey(f.last_evaluation);
      // Range and Never widen each other: with both set, a professor shows if either one fits.
      const inRange = k !== null && (fk === null || k >= fk) && (tk === null || k <= tk);
      const evalOk = !ranged && !never ? true : (ranged && inRange) || (never && !f.last_evaluation);
      return evalOk &&
        (!levels.length || levels.includes(f.hire_level)) &&
        (!allowed.length || allowed.includes(facultyStatus(f))) &&
        (!cycle.length || cycle.includes(f.signedUp ? 'signed' : 'notSigned')) &&
        matches(q, f.name, f.department, f.email);
    });
    return sortBy(kept, sorts, FACULTY_SORTS);
  }, [faculty, query, filters, withStatuses]);
  const active = countFacultyFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="faculty-dialog-title" title={title} onClose={onClose} paused={filterOpen} sub={sub}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by professor or department" searchLabel="Search faculty"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_FACULTY_FILTERS); }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => exportFacultyCsv(shown, term)} disabled={shown.length === 0}>
          <Icon name="download" size={14} /> Export CSV
        </button>
        {filterOpen && (
          <FacultyFilterDialog applied={filters} term={term} semesters={semesters} withStatuses={withStatuses} levelCounts={levelCounts} statusCounts={statusCounts}
            cycleCounts={cycleCounts} neverCount={neverCount} onApply={setFilters} onClose={closeFilters} />
        )}
      </>}
      footer={`Showing ${shown.length} of ${faculty.length}. Export CSV downloads the rows shown.`}
    >
      <FacultyTable rows={shown} />
    </ListDialog>
  );
}

/* ---------- 2b: observers this cycle ---------- */

// Rows: { id, name, department, total, completed, inProgress, observees: [names] }.
export const OBSERVER_PREVIEW = 8;
const OBSERVER_COUNTS = [['total', 'Observing count'], ['completed', 'Completed count'], ['inProgress', 'In progress count']];
const OBSERVER_SORTS = {
  nameAsc: (a, b) => a.name.localeCompare(b.name),
  nameDesc: (a, b) => b.name.localeCompare(a.name),
  ...Object.fromEntries(OBSERVER_COUNTS.flatMap(([k]) => [
    [`${k}Asc`, (a, b) => a[k] - b[k]],
    [`${k}Desc`, (a, b) => b[k] - a[k]],
  ])),
};
const OBSERVER_PAIRS = {
  nameAsc: 'nameDesc', nameDesc: 'nameAsc',
  ...Object.fromEntries(OBSERVER_COUNTS.flatMap(([k]) => [[`${k}Asc`, `${k}Desc`], [`${k}Desc`, `${k}Asc`]])),
};
// Min / max are kept as typed text; blank (or anything that isn't a whole number) means no limit.
const EMPTY_OBSERVER_FILTERS = {
  sorts: [],
  ranges: Object.fromEntries(OBSERVER_COUNTS.map(([k]) => [k, { min: '', max: '' }])),
};
const boundOf = (text) => (/^\s*\d+\s*$/.test(text) ? Number(text) : null);
const countObserverFilters = (f) =>
  f.sorts.length + Object.values(f.ranges).filter((r) => boundOf(r.min) !== null || boundOf(r.max) !== null).length;

export function exportObserversCsv(rows, term) {
  if (!rows.length) return;
  downloadCsv(
    [['Observer', 'Department', 'Observing', 'Completed', 'In progress', 'Observees'],
      ...rows.map((o) => [o.name, o.department, o.total, o.completed, o.inProgress, o.observees.join('; ')])],
    `observers-${String(term || 'cycle').toLowerCase().replaceAll(' ', '-')}.csv`,
  );
}

// onShowObservees: full-list mode, adds a "See Full Observee List" button to each row.
export function ObserversTable({ rows, empty = 'No observers match these filters.', onShowObservees }) {
  return (
    <table className="data-table data-table-compact">
      {/* Full list: the buttons get their own column (under the same Observees heading) so they line up down the table. */}
      <thead><tr><th>Observer</th><th>Department</th><th>Observing</th><th>Completed</th><th>In progress</th><th colSpan={onShowObservees ? 2 : 1}>Observees</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={onShowObservees ? 7 : 6} className="empty-cell">{empty}</td></tr>}
        {rows.map((o) => (
          <tr key={o.id}>
            <td className="strong nowrap">{o.name}</td>
            <td>{o.department}</td>
            <td><strong className="num">{o.total}</strong></td>
            <td><span className="num text-good">{o.completed}</span></td>
            <td><span className="num">{o.inProgress}</span></td>
            {onShowObservees ? (
              // Full list: just the first observee ("First, ..." when there are more) and the button in the next column.
              // Rows with one observee get an invisible copy of the button so every row is the same height.
              <>
                <td className="nowrap observee-first">{o.observees[0]}{o.observees.length > 1 && ', ...'}</td>
                <td className="observee-btn-cell">
                  {o.observees.length > 1
                    ? <button type="button" className="btn btn-ghost btn-sm nowrap" onClick={() => onShowObservees(o)}>See Full Observee List</button>
                    : <span className="btn btn-ghost btn-sm nowrap observee-btn-spacer" aria-hidden="true">See Full Observee List</span>}
                </td>
              </>
            ) : (
              <td><span className="one-line" title={o.observees.join(', ')}>{o.observees.join(', ')}</span></td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Small pop-up: the observer on the left, every observee listed down the right.
function ObserveeListDialog({ observer: o, onClose }) {
  const closeRef = useAutoFocus();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-overlay dialog-overlay-top" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="dialog observee-dialog" role="dialog" aria-modal="true" aria-labelledby="observee-list-title" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2 id="observee-list-title" className="card-title">Full observee list</h2>
            <p className="card-sub">{o.department} · {plural(o.observees.length, 'observee')}</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="observee-split">
          <div>
            <p className="observee-split-head">Observer</p>
            <p className="strong">{o.name}</p>
          </div>
          <div className="observee-split-list">
            <p className="observee-split-head">Observees</p>
            <ol>{o.observees.map((name, i) => <li key={`${name}-${i}`}>{name}</li>)}</ol>
          </div>
        </div>
      </div>
    </div>
  );
}

function ObserverFilterDialog({ applied, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggleSort = (key) => toggleSortIn(setDraft, OBSERVER_PAIRS, key);
  const reset = () => { setDraft(EMPTY_OBSERVER_FILTERS); onApply(EMPTY_OBSERVER_FILTERS); };
  const setBound = (k, side, value) => setDraft((d) => ({ ...d, ranges: { ...d.ranges, [k]: { ...d.ranges[k], [side]: value } } }));
  const sortCheck = (key, label) => <FilterCheck label={label} checked={draft.sorts.includes(key)} onToggle={() => toggleSort(key)} />;

  return (
    <FilterDialog titleId="observer-filter-title" sub="Sort and narrow the observers list. Tick any options or enter a range, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-observers">
      <fieldset className="filter-group">
        <legend>Observer</legend>
        {sortCheck('nameAsc', 'Ascending (A–Z)')}
        {sortCheck('nameDesc', 'Descending (Z–A)')}
      </fieldset>
      {OBSERVER_COUNTS.map(([k, label]) => {
        const { min, max } = draft.ranges[k];
        const bad = (min.trim() && boundOf(min) === null) || (max.trim() && boundOf(max) === null);
        const flipped = boundOf(min) !== null && boundOf(max) !== null && boundOf(min) > boundOf(max);
        return (
          <fieldset key={k} className="filter-group filter-group-nowrap">
            <legend>{label}</legend>
            <div className="count-range">
              <input className="input" type="number" min="0" step="1" inputMode="numeric" placeholder="Min" value={min}
                onChange={(e) => setBound(k, 'min', e.target.value)} aria-label={`${label}: minimum`} />
              <span aria-hidden="true">–</span>
              <input className="input" type="number" min="0" step="1" inputMode="numeric" placeholder="Max" value={max}
                onChange={(e) => setBound(k, 'max', e.target.value)} aria-label={`${label}: maximum`} />
            </div>
            {(bad || flipped) && <p className="count-range-error">{bad ? 'Enter whole numbers only.' : 'Minimum is above maximum.'}</p>}
            {sortCheck(`${k}Asc`, 'Ascending (lowest–highest)')}
            {sortCheck(`${k}Desc`, 'Descending (highest–lowest)')}
          </fieldset>
        );
      })}
    </FilterDialog>
  );
}

export function ObserversDialog({ observers, term, sub, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_OBSERVER_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kept = observers.filter((o) =>
      OBSERVER_COUNTS.every(([k]) => {
        const lo = boundOf(filters.ranges[k].min), hi = boundOf(filters.ranges[k].max);
        return (lo === null || o[k] >= lo) && (hi === null || o[k] <= hi);
      }) &&
      matches(q, o.name, o.department, ...o.observees));
    return sortBy(kept, filters.sorts, OBSERVER_SORTS);
  }, [observers, query, filters]);
  const active = countObserverFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="observers-dialog-title" title="Observers this cycle" sub={sub} onClose={onClose} paused={filterOpen || Boolean(detail)}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by observer, department or observee" searchLabel="Search observers"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_OBSERVER_FILTERS); }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => exportObserversCsv(shown, term)} disabled={shown.length === 0}>
          <Icon name="download" size={14} /> Export CSV
        </button>
        {filterOpen && <ObserverFilterDialog applied={filters} onApply={setFilters} onClose={closeFilters} />}
      </>}
      footer={`Showing ${shown.length} of ${observers.length}. Export CSV downloads the rows shown.`}
    >
      <ObserversTable rows={shown} onShowObservees={setDetail} />
      {detail && <ObserveeListDialog observer={detail} onClose={closeDetail} />}
    </ListDialog>
  );
}

/* ---------- 3a: observer lists ---------- */

// Rows are sign-ups plus { department, size } (size = eligible observers found).
export const LIST_PREVIEW = 8;
export const LIST_FLAGS = {
  'NO ELIGIBLE OBSERVER': { label: 'Ineligible', tone: 'bad' },
  'INSUFFICIENT OBSERVERS': { label: 'Insufficient', tone: 'warn' },
  OK: { label: 'Satisfactory', tone: 'good' },
};
const flagOf = (r) => LIST_FLAGS[r.matchFlag] || { label: r.matchFlag, tone: 'neutral' };
const INSUFFICIENT_SIZES = [1, 2, 3, 4];
const LIST_SORTS = {
  observeeAsc: (a, b) => a.observeeName.localeCompare(b.observeeName),
  observeeDesc: (a, b) => b.observeeName.localeCompare(a.observeeName),
  courseAsc: (a, b) => SORTS.courseAsc({ course_code: a.courseCode }, { course_code: b.courseCode }),
  courseDesc: (a, b) => SORTS.courseDesc({ course_code: a.courseCode }, { course_code: b.courseCode }),
  sizeAsc: (a, b) => a.size - b.size,
  sizeDesc: (a, b) => b.size - a.size,
};
const LIST_PAIRS = {
  observeeAsc: 'observeeDesc', observeeDesc: 'observeeAsc', courseAsc: 'courseDesc', courseDesc: 'courseAsc', sizeAsc: 'sizeDesc', sizeDesc: 'sizeAsc',
};
// sizeMin / sizeMax: '' or '1'-'4', only used while Insufficient is ticked.
const EMPTY_LIST_FILTERS = { sorts: [], days: [], flags: [], released: [], sizeMin: '', sizeMax: '' };
const countListFilters = (f) => f.sorts.length + f.days.length + f.flags.length + f.released.length;

export function exportListsCsv(rows, term, target) {
  if (!rows.length) return;
  downloadCsv(
    [['Observee', 'Department', 'Course', 'Day & Time', 'List size', 'Status', 'Released'],
      ...rows.map((r) => [r.observeeName, r.department, r.courseCode, r.timing, `${r.size}/${target}`, flagOf(r).label, r.listReleased ? 'Yes' : 'No'])],
    `observer-lists-${String(term || 'cycle').toLowerCase().replaceAll(' ', '-')}.csv`,
  );
}

export function ListsTable({ rows, target, empty = 'No sign-ups match these filters.' }) {
  return (
    <table className="data-table data-table-compact">
      <thead><tr><th>Observee</th><th>Department</th><th>Course</th><th>Day &amp; Time</th><th>List size</th><th>Status</th><th>Released</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan="7" className="empty-cell">{empty}</td></tr>}
        {rows.map((r) => {
          const f = flagOf(r);
          return (
            <tr key={r.id}>
              <td className="strong nowrap">{r.observeeName}</td>
              <td>{r.department}</td>
              <td className="mono nowrap">{r.courseCode}</td>
              <td className="nowrap">{r.timing}</td>
              <td><span className={`num text-${f.tone}`}>{r.size}</span><span className="faint"> / {target}</span></td>
              <td><Badge tone={f.tone}>{f.label}</Badge></td>
              <td>{r.listReleased ? <Badge tone="good">Yes</Badge> : <Badge tone="bad">No</Badge>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ListsFilterDialog({ applied, dayCounts, flagCounts, releasedCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  // Unticking Insufficient also clears its list-size range and order.
  const toggle = (key, value) => {
    if (key === 'flags' && value === 'INSUFFICIENT OBSERVERS' && draft.flags.includes(value)) {
      setDraft((d) => ({ ...d, flags: d.flags.filter((f) => f !== value), sizeMin: '', sizeMax: '', sorts: d.sorts.filter((s) => !s.startsWith('size')) }));
    } else toggleIn(setDraft, key, value);
  };
  const toggleSort = (key) => toggleSortIn(setDraft, LIST_PAIRS, key);
  const reset = () => { setDraft(EMPTY_LIST_FILTERS); onApply(EMPTY_LIST_FILTERS); };
  const sortCheck = (key, label, disabled) => <FilterCheck label={label} disabled={disabled} checked={draft.sorts.includes(key)} onToggle={() => toggleSort(key)} />;
  const flagCheck = (k) => <FilterCheck label={LIST_FLAGS[k].label} count={flagCounts[k] || 0} checked={draft.flags.includes(k)} onToggle={() => toggle('flags', k)} />;
  const insufficientOn = draft.flags.includes('INSUFFICIENT OBSERVERS');
  // Keep min <= max: moving one past the other drags the other along.
  const setSize = (side, value) => setDraft((d) => {
    const next = { ...d, [side]: value };
    if (next.sizeMin && next.sizeMax && Number(next.sizeMin) > Number(next.sizeMax)) next[side === 'sizeMin' ? 'sizeMax' : 'sizeMin'] = value;
    return next;
  });
  const sizeSelect = (side, label) => (
    <select className="select" value={draft[side]} disabled={!insufficientOn} onChange={(e) => setSize(side, e.target.value)} aria-label={`List size ${label}`}>
      <option value="">{label}</option>
      {INSUFFICIENT_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );

  return (
    <FilterDialog titleId="lists-filter-title" sub="Sort and narrow the observer lists. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-lists">
      <fieldset className="filter-group">
        <legend>Observee</legend>
        {sortCheck('observeeAsc', 'Ascending (A–Z)')}
        {sortCheck('observeeDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group filter-group-nowrap">
        <legend>Course</legend>
        {sortCheck('courseAsc', 'Ascending (1000 → 5000)')}
        {sortCheck('courseDesc', 'Descending (5000 → 1000)')}
      </fieldset>
      <fieldset className="filter-group filter-group-nowrap">
        <legend>Days</legend>
        {OUTSTANDING_DAYS.map(([k, label]) => <FilterCheck key={k} label={label} count={dayCounts[k] || 0} checked={draft.days.includes(k)} onToggle={() => toggle('days', k)} />)}
      </fieldset>
      <fieldset className="filter-group filter-group-wide">
        <legend>Status</legend>
        {flagCheck('NO ELIGIBLE OBSERVER')}
        {flagCheck('INSUFFICIENT OBSERVERS')}
        <div className={`list-size-range${insufficientOn ? '' : ' is-off'}`}>
          <span className="semester-picker-label">List size {!insufficientOn && <span className="faint">(tick Insufficient first)</span>}</span>
          <div className="count-range">
            {sizeSelect('sizeMin', 'Min')}
            <span aria-hidden="true">–</span>
            {sizeSelect('sizeMax', 'Max')}
          </div>
          <div className="list-size-sorts">
            {sortCheck('sizeAsc', 'Ascending (min → max)', !insufficientOn)}
            {sortCheck('sizeDesc', 'Descending (max → min)', !insufficientOn)}
          </div>
        </div>
        {flagCheck('OK')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Released</legend>
        <FilterCheck label="No" count={releasedCounts.no} checked={draft.released.includes('no')} onToggle={() => toggle('released', 'no')} />
        <FilterCheck label="Yes" count={releasedCounts.yes} checked={draft.released.includes('yes')} onToggle={() => toggle('released', 'yes')} />
      </fieldset>
    </FilterDialog>
  );
}

export function ListsDialog({ rows, term, target, sub, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_LIST_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const withDays = useMemo(() => rows.map((r) => ({ ...r, days: classDays(r.timing) })), [rows]);
  const dayCounts = useMemo(() => countBy(withDays, 'days'), [withDays]);
  const flagCounts = useMemo(() => countBy(withDays, 'matchFlag'), [withDays]);
  const releasedCounts = useMemo(() => {
    const yes = rows.filter((r) => r.listReleased).length;
    return { yes, no: rows.length - yes };
  }, [rows]);
  const shown = useMemo(() => {
    const { sorts, days, flags, released, sizeMin, sizeMax } = filters;
    const lo = sizeMin ? Number(sizeMin) : null, hi = sizeMax ? Number(sizeMax) : null;
    const q = query.trim().toLowerCase();
    const kept = withDays.filter((r) =>
      (!days.length || days.includes(r.days)) &&
      (!flags.length || (flags.includes(r.matchFlag) &&
        // The list-size range narrows only the Insufficient lists.
        (r.matchFlag !== 'INSUFFICIENT OBSERVERS' || ((lo === null || r.size >= lo) && (hi === null || r.size <= hi))))) &&
      (!released.length || released.includes(r.listReleased ? 'yes' : 'no')) &&
      matches(q, r.observeeName, r.courseCode, r.department));
    return sortBy(kept, sorts, LIST_SORTS);
  }, [withDays, query, filters]);
  const active = countListFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="lists-dialog-title" title="Observer lists" sub={sub} onClose={onClose} paused={filterOpen}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by observee, course or department" searchLabel="Search observer lists"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_LIST_FILTERS); }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => exportListsCsv(shown, term, target)} disabled={shown.length === 0}>
          <Icon name="download" size={14} /> Export CSV
        </button>
        {filterOpen && (
          <ListsFilterDialog applied={filters} dayCounts={dayCounts} flagCounts={flagCounts} releasedCounts={releasedCounts}
            onApply={setFilters} onClose={closeFilters} />
        )}
      </>}
      footer={`Showing ${shown.length} of ${rows.length}. Export CSV downloads the rows shown.`}
    >
      <ListsTable rows={shown} target={target} />
    </ListDialog>
  );
}

/* ---------- 4b: progress by sign-up ---------- */

// Rows: survey stages plus { rowKey, reached } (index of the last step finished, in order).
// The step a sign-up is ON is the one after the last step finished; once every step is finished it stays on the last one.
const currentOf = (r, steps) => Math.min(r.reached + 1, steps.length - 1);
const finishedAll = (r, steps) => r.reached >= steps.length - 1;
const PROGRESS_PREVIEW = 8;
const PROGRESS_SORTS = {
  nameAsc: (a, b) => String(a.name).localeCompare(String(b.name)),
  nameDesc: (a, b) => String(b.name).localeCompare(String(a.name)),
};
const PROGRESS_PAIRS = { nameAsc: 'nameDesc', nameDesc: 'nameAsc' };
// steps: current-step indexes ('done' = finished every step).
const EMPTY_PROGRESS_FILTERS = { sorts: [], steps: [] };

// Numbered steps 1..N: finished steps and the current one take their colour (yellow at 1 shading to green at the last),
// the current one is circled, and future steps stay grey.
export function StepNumbers({ steps, current, finished }) {
  return (
    <span className="step-nums" role="img"
      aria-label={finished ? `Finished all ${steps.length} steps` : `On step ${current + 1} of ${steps.length}: ${steps[current].label}`}>
      {steps.map((s, i) => (
        <span key={s.key} title={`${i + 1}. ${s.label}`}
          className={`step-num${i <= current ? ` step-num-${i + 1}` : ''}${i === current ? ' is-current' : ''}`}>{i + 1}</span>
      ))}
    </span>
  );
}

const doneLabel = (ready) => (ready ? 'Done' : 'Observed');

function exportProgressCsv(rows, steps, ready, term) {
  if (!rows.length) return;
  downloadCsv(
    [['Professor', 'Step', 'Current step', 'Next step'],
      ...rows.map((r) => {
        const c = currentOf(r, steps), done = finishedAll(r, steps);
        return [r.name, done ? `${steps.length}/${steps.length}` : `${c + 1}/${steps.length}`,
          done ? doneLabel(ready) : steps[c].label, done || !steps[c + 1] ? '' : steps[c + 1].label];
      })],
    `sign-up-progress-${String(term || 'cycle').toLowerCase().replaceAll(' ', '-')}.csv`,
  );
}

function ProgressTable({ rows, steps, ready, empty = 'No sign-ups match these filters.' }) {
  return (
    <table className="data-table data-table-compact">
      <thead><tr><th>Professor</th><th>Progress</th><th>Current step</th><th>Next step</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan="4" className="empty-cell">{empty}</td></tr>}
        {rows.map((r) => {
          const c = currentOf(r, steps), done = finishedAll(r, steps);
          const next = done ? null : steps[c + 1];
          return (
            <tr key={r.rowKey}>
              <td className="strong nowrap">{r.name}</td>
              <td><StepNumbers steps={steps} current={c} finished={done} /></td>
              <td>{done ? <Badge tone="good">{doneLabel(ready)}</Badge> : <Badge tone="warn">{steps[c].label}</Badge>}</td>
              <td className="muted">{next ? next.label : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ProgressFilterDialog({ applied, steps, ready, stepCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggleSort = (key) => toggleSortIn(setDraft, PROGRESS_PAIRS, key);
  const reset = () => { setDraft(EMPTY_PROGRESS_FILTERS); onApply(EMPTY_PROGRESS_FILTERS); };
  const stepCheck = (value, label, chip) => (
    <FilterCheck key={value} label={<span className="step-filter-label">{chip}{label}</span>} count={stepCounts[value] || 0}
      checked={draft.steps.includes(value)} onToggle={() => toggleIn(setDraft, 'steps', value)} />
  );

  return (
    <FilterDialog titleId="progress-filter-title" sub="Sort and narrow the sign-ups. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-progress">
      <fieldset className="filter-group">
        <legend>Professor</legend>
        <FilterCheck label="Ascending (A–Z)" checked={draft.sorts.includes('nameAsc')} onToggle={() => toggleSort('nameAsc')} />
        <FilterCheck label="Descending (Z–A)" checked={draft.sorts.includes('nameDesc')} onToggle={() => toggleSort('nameDesc')} />
      </fieldset>
      <fieldset className="filter-group">
        <legend>Step progress</legend>
        <div className="filter-grid-steps">
          {steps.map((s, i) => stepCheck(i, `On: ${s.label}`, <span className={`step-num step-num-${i + 1} is-current`}>{i + 1}</span>))}
          {stepCheck('done', `Finished every step (${doneLabel(ready).toLowerCase()})`, <span className={`step-num step-num-${steps.length} is-current`}>✓</span>)}
        </div>
      </fieldset>
    </FilterDialog>
  );
}

function ProgressDialog({ rows, steps, ready, term, sub, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_PROGRESS_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const stepKey = useCallback((r) => (finishedAll(r, steps) ? 'done' : currentOf(r, steps)), [steps]);
  const stepCounts = useMemo(() => rows.reduce((m, r) => { const k = stepKey(r); m[k] = (m[k] || 0) + 1; return m; }, {}), [rows, stepKey]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kept = rows.filter((r) => (!filters.steps.length || filters.steps.includes(stepKey(r))) && matches(q, r.name));
    return sortBy(kept, filters.sorts, PROGRESS_SORTS);
  }, [rows, query, filters, stepKey]);
  const active = countFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="progress-dialog-title" title="Progress by sign-up" sub={sub} onClose={onClose} paused={filterOpen}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by professor" searchLabel="Search sign-ups"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_PROGRESS_FILTERS); }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => exportProgressCsv(shown, steps, ready, term)} disabled={shown.length === 0}>
          <Icon name="download" size={14} /> Export CSV
        </button>
        {filterOpen && <ProgressFilterDialog applied={filters} steps={steps} ready={ready} stepCounts={stepCounts} onApply={setFilters} onClose={closeFilters} />}
      </>}
      footer={`Showing ${shown.length} of ${rows.length}. The circled number is the step each sign-up is on. Export CSV downloads the rows shown.`}
    >
      <ProgressTable rows={shown} steps={steps} ready={ready} />
    </ListDialog>
  );
}

// rows should already be in display order (least progress first).
export function ProgressList({ rows, steps, ready, term, sub }) {
  const [open, setOpen] = useState(false);
  const showAllRef = useRef(null);
  const close = useCallback(() => { setOpen(false); showAllRef.current?.focus(); }, []);
  const preview = rows.slice(0, PROGRESS_PREVIEW);

  return (
    <section className="card card-flush list-panel" aria-labelledby="process-title">
      <div className="card-head">
        <div>
          <h2 id="process-title" className="card-title">Progress by sign-up</h2>
          <p className="card-sub">{sub}</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => exportProgressCsv(rows, steps, ready, term)} disabled={rows.length === 0}>
            <Icon name="download" size={14} /> Export CSV
          </button>
        </div>
      </div>
      <div className="table-wrap"><ProgressTable rows={preview} steps={steps} ready={ready} empty="No sign-ups yet." /></div>
      <div className="card-foot row-between">
        <span>Showing {preview.length} of {rows.length}</span>
        {rows.length > 0 && (
          <button ref={showAllRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">Show all {rows.length}</button>
        )}
      </div>
      {open && <ProgressDialog rows={rows} steps={steps} ready={ready} term={term} sub={sub} onClose={close} />}
    </section>
  );
}

/* ---------- Shared "Advanced filtering" pop-up ---------- */

// One tickable option in the filter pop-up: a box that turns green with a check mark when on. Click again to untick.
function FilterCheck({ checked, onToggle, label, count, hint, disabled }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className={`filter-check${checked ? ' checked' : ''}`} onClick={onToggle} title={hint} disabled={disabled}>
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


// Reasons in the order the filter lists them.
const MISSING_REASON_ORDER = ['observee', 'observer', 'both', 'reported'];
const MISSING_SORTS = {
  observeeAsc: (a, b) => a.observeeName.localeCompare(b.observeeName),
  observeeDesc: (a, b) => b.observeeName.localeCompare(a.observeeName),
  observerAsc: (a, b) => (a.observerName || '').localeCompare(b.observerName || ''),
  observerDesc: (a, b) => (b.observerName || '').localeCompare(a.observerName || ''),
  courseAsc: (a, b) => SORTS.courseAsc({ course_code: a.courseCode }, { course_code: b.courseCode }),
  courseDesc: (a, b) => SORTS.courseDesc({ course_code: a.courseCode }, { course_code: b.courseCode }),
};
const MISSING_PAIRS = {
  observeeAsc: 'observeeDesc', observeeDesc: 'observeeAsc', observerAsc: 'observerDesc', observerDesc: 'observerAsc',
  courseAsc: 'courseDesc', courseDesc: 'courseAsc',
};
// courseMin / courseMax: typed text; only a 4-digit whole number counts, anything else means no limit.
const EMPTY_MISSING_FILTERS = { sorts: [], kinds: [], courseMin: '', courseMax: '' };
const courseBound = (text) => (/^\d{4}$/.test(String(text).trim()) ? Number(text) : null);
const countMissingFilters = (f) =>
  f.sorts.length + f.kinds.length + (courseBound(f.courseMin) !== null || courseBound(f.courseMax) !== null ? 1 : 0);
const MISSING_PREVIEW = 8;

function exportMissingCsv(rows, term) {
  if (!rows.length) return;
  downloadCsv(
    [['Observee', 'Observer', 'Course', 'Reason', 'Details'],
      ...rows.map((o) => [o.observeeName, o.observerName, o.courseCode, MISSING_KINDS[o.kind].label, o.reason])],
    `appointments-not-held-${String(term || 'cycle').toLowerCase().replaceAll(' ', '-')}.csv`,
  );
}

function MissingTable({ rows, empty = 'No appointments match these filters.' }) {
  return (
    <table className="data-table data-table-compact">
      <thead><tr><th>Observee</th><th>Observer</th><th>Course</th><th>Reason</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan="4" className="empty-cell">{empty}</td></tr>}
        {rows.map((o) => (
          <tr key={o.id}>
            <td className="strong nowrap">{o.observeeName}</td>
            <td className="nowrap">{o.observerName}</td>
            <td className="mono nowrap">{o.courseCode}</td>
            <td>
              <Badge tone={MISSING_KINDS[o.kind].tone}>{MISSING_KINDS[o.kind].label}</Badge>
              <span className="list-sub">{o.reason}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MissingFilterDialog({ applied, kindCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggleSort = (key) => toggleSortIn(setDraft, MISSING_PAIRS, key);
  const reset = () => { setDraft(EMPTY_MISSING_FILTERS); onApply(EMPTY_MISSING_FILTERS); };
  const sortCheck = (key, label) => <FilterCheck label={label} checked={draft.sorts.includes(key)} onToggle={() => toggleSort(key)} />;
  // Digits only, at most 4.
  const setBound = (side, value) => setDraft((d) => ({ ...d, [side]: value.replace(/\D/g, '').slice(0, 4) }));
  const lo = courseBound(draft.courseMin), hi = courseBound(draft.courseMax);
  const partial = [draft.courseMin, draft.courseMax].some((v) => v && courseBound(v) === null);
  const flipped = lo !== null && hi !== null && lo > hi;

  return (
    <FilterDialog titleId="missing-filter-title" sub="Sort and narrow the appointments that did not go through. Tick any options or enter a range, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose} groupsClassName="filter-groups-missing">
      <fieldset className="filter-group">
        <legend>Observee</legend>
        {sortCheck('observeeAsc', 'Ascending (A–Z)')}
        {sortCheck('observeeDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Observer</legend>
        {sortCheck('observerAsc', 'Ascending (A–Z)')}
        {sortCheck('observerDesc', 'Descending (Z–A)')}
      </fieldset>
      <fieldset className="filter-group filter-group-nowrap">
        <legend>Course</legend>
        <div className="count-range">
          <input className="input" type="text" inputMode="numeric" maxLength={4} placeholder="Min" value={draft.courseMin}
            onChange={(e) => setBound('courseMin', e.target.value)} aria-label="Course number: minimum (4 digits)" />
          <span aria-hidden="true">–</span>
          <input className="input" type="text" inputMode="numeric" maxLength={4} placeholder="Max" value={draft.courseMax}
            onChange={(e) => setBound('courseMax', e.target.value)} aria-label="Course number: maximum (4 digits)" />
        </div>
        {(partial || flipped) && <p className="count-range-error">{partial ? 'Enter a 4-digit course number.' : 'Minimum is above maximum.'}</p>}
        {sortCheck('courseAsc', 'Ascending (min → max)')}
        {sortCheck('courseDesc', 'Descending (max → min)')}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Reason</legend>
        {MISSING_REASON_ORDER.map((k) => (
          <FilterCheck key={k} label={MISSING_KINDS[k].label} count={kindCounts[k] || 0} checked={draft.kinds.includes(k)} onToggle={() => toggleIn(setDraft, 'kinds', k)} />
        ))}
      </fieldset>
    </FilterDialog>
  );
}

function MissingDialog({ rows, term, sub, onClose }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_MISSING_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useAutoFocus();
  const openRef = useRef(null);

  const kindCounts = useMemo(() => countBy(rows, 'kind'), [rows]);
  const shown = useMemo(() => {
    const { sorts, kinds, courseMin, courseMax } = filters;
    const lo = courseBound(courseMin), hi = courseBound(courseMax);
    const q = query.trim().toLowerCase();
    const kept = rows.filter((o) => {
      const n = courseNum(o.courseCode);
      return (!kinds.length || kinds.includes(o.kind)) &&
        (lo === null || (n !== null && n >= lo)) &&
        (hi === null || (n !== null && n <= hi)) &&
        matches(q, o.observeeName, o.observerName, o.courseCode);
    });
    return sortBy(kept, sorts, MISSING_SORTS);
  }, [rows, query, filters]);
  const active = countMissingFilters(filters);
  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, [openRef]);

  return (
    <ListDialog
      titleId="missing-dialog-title" title="Appointments that did not go through" sub={sub} onClose={onClose} paused={filterOpen}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={active} query={query} setQuery={setQuery}
          placeholder="Search by observee, observer or course" searchLabel="Search appointments"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_MISSING_FILTERS); }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => exportMissingCsv(shown, term)} disabled={shown.length === 0}>
          <Icon name="download" size={14} /> Export CSV
        </button>
        {filterOpen && <MissingFilterDialog applied={filters} kindCounts={kindCounts} onApply={setFilters} onClose={closeFilters} />}
      </>}
      footer={`Showing ${shown.length} of ${rows.length}. Export CSV downloads the rows shown.`}
    >
      <MissingTable rows={shown} />
    </ListDialog>
  );
}

export function MissingList({ missing, term }) {
  const [open, setOpen] = useState(false);
  const showAllRef = useRef(null);
  const close = useCallback(() => { setOpen(false); showAllRef.current?.focus(); }, []);
  const rows = useMemo(() => missing.map((o) => ({ ...o, kind: kindOf(o) })), [missing]);
  const reported = rows.filter((r) => r.kind === 'reported').length;
  const sub = `${missing.length} approved appointments did not go through · ${reported} reported not held · ${missing.length - reported} not confirmed by the deadline`;
  const preview = rows.slice(0, MISSING_PREVIEW);

  return (
    <section className="card card-flush list-panel" aria-labelledby="missing-title">
      <div className="card-head">
        <div>
          <h2 id="missing-title" className="card-title">Appointments that did not go through</h2>
          <p className="card-sub">{sub}</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => exportMissingCsv(rows, term)} disabled={rows.length === 0}>
            <Icon name="download" size={14} /> Export CSV
          </button>
        </div>
      </div>
      <div className="table-wrap"><MissingTable rows={preview} empty="Every approved appointment went through." /></div>
      <div className="card-foot row-between">
        <span>Showing {preview.length} of {rows.length}</span>
        {rows.length > 0 && (
          <button ref={showAllRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">Show all {rows.length}</button>
        )}
      </div>
      {open && <MissingDialog rows={rows} term={term} sub={sub} onClose={close} />}
    </section>
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
