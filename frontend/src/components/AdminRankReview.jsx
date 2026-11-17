import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Card, Notice, EmptyState } from './ui.jsx';
import { ListPanel, FilterDialog, FilterCheck, FilterToolbar, toggleIn, toggleSortIn, sortBy } from './KpiListDialogs.jsx';
import { RANK_OPTIONS, RANK_STATUS, fmtDate } from '../utils/ranks.js';
import { api } from '../api/client.js';
import { toast } from '../utils/toast.js';
import { matches } from '../utils/lists.js';
import { plural } from '../utils/format.js';

/*
 * Committee portal → "Ranks" tab.
 *  1. Requests to review: every pending rank change, with Approve / Disapprove (approving updates the professor's rank).
 *  2. Faculty ranks: every professor in the database and their current rank, with search + Advanced filtering
 *     (Professor A–Z / Z–A, Level: tick all that apply).
 *  3. Decided requests: history of approved / not approved changes.
 */

const LEVELS = RANK_OPTIONS.map((r) => r.label); // Assistant, Associate, Full
const RANK_SORTS = {
  nameAsc: (a, b) => a.name.localeCompare(b.name),
  nameDesc: (a, b) => b.name.localeCompare(a.name),
};
const RANK_PAIRS = { nameAsc: 'nameDesc', nameDesc: 'nameAsc' };
const EMPTY_RANK_FILTERS = { sorts: [], levels: [] };
const countRankFilters = (f) => f.sorts.length + f.levels.length;

function RankFilterDialog({ applied, levelCounts, onApply, onClose }) {
  const [draft, setDraft] = useState(applied);
  const toggleSort = (key) => toggleSortIn(setDraft, RANK_PAIRS, key);
  const reset = () => { setDraft(EMPTY_RANK_FILTERS); onApply(EMPTY_RANK_FILTERS); };
  const allLevels = draft.levels.length === LEVELS.length;

  return (
    <FilterDialog titleId="rank-filter-title" sub="Sort and narrow the faculty rank list. Tick any options, then select Apply filters."
      draft={draft} applied={applied} onReset={reset} onApply={onApply} onClose={onClose}>
      <fieldset className="filter-group">
        <legend>Professor</legend>
        <FilterCheck label="Ascending (A–Z)" checked={draft.sorts.includes('nameAsc')} onToggle={() => toggleSort('nameAsc')} />
        <FilterCheck label="Descending (Z–A)" checked={draft.sorts.includes('nameDesc')} onToggle={() => toggleSort('nameDesc')} />
      </fieldset>
      <fieldset className="filter-group">
        <legend>Level</legend>
        <FilterCheck label="Select all" checked={allLevels}
          onToggle={() => setDraft((d) => ({ ...d, levels: allLevels ? [] : [...LEVELS] }))} />
        {LEVELS.map((l) => (
          <FilterCheck key={l} label={l} count={levelCounts[l] || 0} checked={draft.levels.includes(l)} onToggle={() => toggleIn(setDraft, 'levels', l)} />
        ))}
      </fieldset>
    </FilterDialog>
  );
}

function FacultyRanks({ professors, pendingByEmail }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_RANK_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const openRef = useRef(null);
  const searchRef = useRef(null);

  const levelCounts = useMemo(() => {
    const counts = {};
    for (const p of professors) counts[p.hire_level] = (counts[p.hire_level] || 0) + 1;
    return counts;
  }, [professors]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = professors.filter((p) =>
      (!filters.levels.length || filters.levels.includes(p.hire_level)) &&
      matches(q, p.name, p.department, p.hire_level));
    // Default order is A–Z; ticked sorts override it.
    return sortBy([...rows].sort(RANK_SORTS.nameAsc), filters.sorts, RANK_SORTS);
  }, [professors, query, filters]);

  const closeFilters = useCallback(() => { setFilterOpen(false); openRef.current?.focus(); }, []);

  return (
    <ListPanel
      titleId="faculty-ranks-title" title="Faculty ranks"
      sub={`${plural(professors.length, 'professor')} · ${LEVELS.map((l) => `${levelCounts[l] || 0} ${l.toLowerCase()}`).join(' · ')}`}
      filters={<>
        <FilterToolbar openRef={openRef} searchRef={searchRef} active={countRankFilters(filters)} query={query} setQuery={setQuery}
          placeholder="Search by professor, department or rank" searchLabel="Search faculty ranks"
          onOpen={() => setFilterOpen(true)} onClear={() => { setQuery(''); setFilters(EMPTY_RANK_FILTERS); }} />
        {filterOpen && <RankFilterDialog applied={filters} levelCounts={levelCounts} onApply={setFilters} onClose={closeFilters} />}
      </>}
      footer={`Showing ${shown.length} of ${professors.length}.`}
    >
      <table className="data-table">
        <thead><tr><th>Professor</th><th>Department</th><th>Current rank</th><th>Rank change</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan="4" className="empty-cell">No faculty match these filters.</td></tr>}
          {shown.map((p) => {
            const pending = pendingByEmail.get(p.email);
            return (
              <tr key={p.email}>
                <td className="strong nowrap">{p.name}</td>
                <td>{p.department}</td>
                <td><Badge tone="info">{p.hire_level}</Badge></td>
                <td>{pending ? <Badge tone="warn">Pending: → {pending.requested_level_label}</Badge> : <span className="faint">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ListPanel>
  );
}

function PendingRequest({ request: r, busy, onDecide }) {
  const [note, setNote] = useState('');
  const mismatch = r.recorded_level && r.recorded_level !== r.current_level;
  return (
    <article className="rank-request">
      <div className="row-between">
        <div>
          <div className="strong">{r.professor_name || r.professor_email}</div>
          <div className="faint">{r.department || '—'} · submitted {fmtDate(r.submitted_date)}</div>
        </div>
        <span className="rank-change-pill">
          <Badge>{r.current_level_label}</Badge>
          <span aria-hidden="true">→</span>
          <Badge tone="good">{r.requested_level_label}</Badge>
        </span>
      </div>
      {mismatch && (
        <Notice tone="warn">
          The database had this professor as {r.recorded_level_label} when they submitted, not {r.current_level_label}.
        </Notice>
      )}
      <p className="rank-reason"><span className="faint">Reason: </span>{r.reason}</p>
      <div className="row">
        <input className="input rank-note" type="text" maxLength={2000} placeholder="Note to the professor (optional)" value={note}
          onChange={(e) => setNote(e.target.value)} aria-label={`Note to ${r.professor_name || 'the professor'}`} />
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDecide(r, 'approve', note)}>Approve</button>
        <button type="button" className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={() => onDecide(r, 'reject', note)}>Disapprove</button>
      </div>
    </article>
  );
}

export default function AdminRankReview({ professors, onChanged }) {
  const [requests, setRequests] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Bump `version` to reload (same pattern as CommitteeReports).
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let cancelled = false;
    api.rankChanges()
      .then((res) => { if (!cancelled) setRequests(res.data); })
      .catch((e) => { if (!cancelled) { setRequests([]); toast.error(e.message); } });
    return () => { cancelled = true; };
  }, [version]);

  const pending = (requests || []).filter((r) => r.status === 'pending');
  const decided = (requests || []).filter((r) => r.status !== 'pending');
  const pendingByEmail = useMemo(() => new Map(pending.map((r) => [r.professor_email, r])), [pending]);

  const decide = async (r, decision, note) => {
    setBusyId(r.id);
    try {
      await api.decideRankChange(r.id, decision, note);
      const who = r.professor_name || 'The professor';
      toast.success(decision === 'approve'
        ? `${who} is now ${r.requested_level_label}.`
        : `${who}'s rank change was not approved.`);
      load();
      await onChanged?.(); // reload professors so the new rank shows in the table and everywhere else
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="stack">
      <Card title="Requests to review" sub={requests === null ? 'Loading…' : `${plural(pending.length, 'rank change')} waiting for a decision`}>
        {requests === null ? null : pending.length === 0 ? (
          <EmptyState icon="checkCircle" title="Nothing to review">New rank change forms from professors will show up here.</EmptyState>
        ) : (
          <div className="stack">
            {pending.map((r) => <PendingRequest key={r.id} request={r} busy={busyId === r.id} onDecide={decide} />)}
          </div>
        )}
      </Card>

      <FacultyRanks professors={professors} pendingByEmail={pendingByEmail} />

      {decided.length > 0 && (
        <Card title="Decided requests" sub="Rank changes the committee has already approved or not approved" flush>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Professor</th><th>Change</th><th>Reason</th><th>Decision</th><th>Reviewed</th><th>Note</th></tr></thead>
              <tbody>
                {decided.map((r) => {
                  const [label, tone] = RANK_STATUS[r.status] || [r.status, 'neutral'];
                  return (
                    <tr key={r.id}>
                      <td className="strong nowrap">{r.professor_name || r.professor_email}</td>
                      <td className="nowrap">{r.current_level_label} → {r.requested_level_label}</td>
                      <td className="rank-reason-cell">{r.reason}</td>
                      <td><Badge tone={tone}>{label}</Badge></td>
                      <td className="nowrap">{fmtDate(r.reviewed_date)}{r.reviewed_by_name ? ` · ${r.reviewed_by_name}` : ''}</td>
                      <td>{r.review_note || <span className="faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
