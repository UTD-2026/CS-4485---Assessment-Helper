import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Badge, Card, Meter, Notice } from './ui.jsx';
import { VIOLATION_TYPES, TARGET_LIST_SIZE } from '../utils/kpis.js';
import { useKpis, toneFor, pct, rateOf } from '../utils/metricPages.js';
import { isSurveyClosed, formatDeadline, formatSurveyDeadline } from '../utils/deadlines.js';
import { plural } from '../utils/format.js';
import {
  FACULTY_PREVIEW, FacultyDialog, FacultyTable, OBSERVER_PREVIEW, ObserversDialog, ObserversTable, exportObserversCsv,
  LIST_PREVIEW, ListsDialog, ListsTable, exportListsCsv, ProgressList, MissingList, PairingsList, exportFacultyCsv, facultyStatus,
} from './KpiListDialogs.jsx';
import { MISSING_KINDS, kindOf } from '../utils/lists.js';

/*
 * Committee metric detail pages: one page per KPI, opened from the Metrics group in the side rail.
 * The Live metrics page shows the headline numbers; everything behind a number lives on its page here.
 * Every page takes the same global state as the Live metrics page plus onNavigate(tab, filters).
 */

// Count rows per key, returned as [key, count] pairs, biggest first (ties A-Z).
const tally = (rows, keyFn) => {
  const counts = new Map();
  rows.forEach((r) => { const k = keyFn(r) || 'Unknown'; counts.set(k, (counts.get(k) || 0) + 1); });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

/* ---------- Shared building blocks ---------- */

// The KPI itself (big number) plus the counts behind it.
function MetricHero({ code, label, value, tone, meter, sub, stats = [] }) {
  return (
    <section className="metric-hero" aria-label={`${label} summary`}>
      <div className="card kpi-card">
        <div className="row-between">
          <span className="kpi-label">{label}</span>
          <Badge tone={tone}>{code}</Badge>
        </div>
        <div className={`kpi-value text-${tone}`}>{value}</div>
        {meter !== undefined && <Meter value={meter} tone={tone} label={`${label}: ${value}`} />}
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
      {stats.map((s) => (
        <div className="card metric-stat" key={s.label}>
          <span className="metric-stat-label">{s.label}</span>
          <span className={`metric-stat-value${s.tone ? ` text-${s.tone}` : ''}`}>{s.value}</span>
          {s.sub && <span className="metric-stat-sub">{s.sub}</span>}
        </div>
      ))}
    </section>
  );
}

// One breakdown line: label, bar (value / max) and the number shown on the right.
function BreakRow({ label, value, max, tone = 'info', display, title }) {
  const shown = display ?? value;
  return (
    <div className="break-row">
      <span className="break-row-label" title={title || label}>{label}</span>
      <Meter size="md" tone={tone} value={max ? (value / max) * 100 : 0} label={`${label}: ${typeof shown === 'object' ? value : shown}`} />
      <span className="break-row-value">{shown}</span>
    </div>
  );
}

// "62% 18/29": rate plus the fraction behind it
const RateValue = ({ num, den }) => <>{pct(rateOf(num, den))} <span className="faint">{num}/{den}</span></>;

function Empty({ children }) {
  return <p className="muted">{children}</p>;
}

/* ---------- 1a: Eligibility accuracy ---------- */

function EligibilityPage({ k, signups, observations }) {
  const { eligibility } = k;
  const tone = eligibility.rate == null ? 'neutral' : eligibility.incorrect.length ? 'bad' : 'good';
  const recommendedTotal = signups.reduce((n, s) => n + (s.eligibleObservers || []).length, 0);
  const confirmedTotal = observations.length;
  const badConfirmed = eligibility.incorrect.filter((p) => p.source === 'Confirmed').length;
  const badRecommended = eligibility.incorrect.length - badConfirmed;
  const flaggedObservers = tally(eligibility.incorrect, (p) => p.observerName).slice(0, 6);

  return (
    <div className="stack">
      <MetricHero
        code="1a" label="Eligibility accuracy" tone={tone}
        value={eligibility.rate == null ? '—' : pct(eligibility.rate)} meter={eligibility.rate ?? 0}
        sub="Correct pairings ÷ audited pairings (recommended + confirmed)"
        stats={[
          { label: 'Audited pairings', value: eligibility.total, sub: `${recommendedTotal} recommended · ${confirmedTotal} confirmed` },
          { label: 'Pass every rule', value: eligibility.correct, tone: 'good' },
          { label: 'Break a rule', value: eligibility.incorrect.length, tone: eligibility.incorrect.length ? 'bad' : 'good' },
          { label: 'Confirmed with a problem', value: badConfirmed, tone: badConfirmed ? 'bad' : 'good', sub: 'Already-confirmed observers that break a rule' },
        ]}
      />

      <div className="grid grid-380 grid-stretch">
        <Card title="Rules broken" sub="A pairing can break more than one rule">
          {Object.entries(VIOLATION_TYPES).map(([key, v]) => (
            <div className="list-row" key={key}>
              <span className={`code-chip${eligibility.byType[key] ? ' code-chip-bad' : ''}`}>{v.code}</span>
              <span className="grow">{v.label}</span>
              <Badge tone={eligibility.byType[key] ? 'bad' : 'good'}>{eligibility.byType[key]}</Badge>
            </div>
          ))}
        </Card>

        <Card title="Pass rate by source" sub="Recommended = on an observer list · Confirmed = the observer was selected">
          <BreakRow label="Recommended" value={recommendedTotal - badRecommended} max={recommendedTotal}
            tone={toneFor(rateOf(recommendedTotal - badRecommended, recommendedTotal))}
            display={<RateValue num={recommendedTotal - badRecommended} den={recommendedTotal} />} />
          <BreakRow label="Confirmed" value={confirmedTotal - badConfirmed} max={confirmedTotal}
            tone={toneFor(rateOf(confirmedTotal - badConfirmed, confirmedTotal))}
            display={<RateValue num={confirmedTotal - badConfirmed} den={confirmedTotal} />} />
        </Card>

        <Card title="Observers in the most flagged pairings" sub={flaggedObservers.length ? `Top ${flaggedObservers.length}` : undefined}>
          {flaggedObservers.length === 0 ? <Empty>No observer is in a pairing that breaks a rule.</Empty> : flaggedObservers.map(([name, n]) => (
            <BreakRow key={name} label={name} value={n} max={flaggedObservers[0][1]} tone="bad" />
          ))}
        </Card>
      </div>

      {eligibility.incorrect.length > 0
        ? <PairingsList pairings={eligibility.incorrect} />
        : <Notice tone="good" title="Every audited pairing passes">No recommended or confirmed observer breaks an eligibility rule.</Notice>}
    </div>
  );
}

/* ---------- 1b: Overdue evaluations ---------- */

const lateBucket = (n) => (n >= 4 ? '4+ semesters' : plural(n, 'semester'));

const STATUS_ORDER = { Overdue: 0, Due: 1 };

function OverduePage({ k, signups, professors = [], term }) {
  const { overdue } = k;
  const rows = overdue.overdue;
  // Overdue professors only, most semesters overdue first.
  const signedIds = useMemo(() => new Set(signups.map((s) => s.observeeId)), [signups]);
  const overdueFaculty = useMemo(() => professors
    .filter((f) => facultyStatus(f) === 'Overdue')
    .map((f) => ({ ...f, signedUp: signedIds.has(f.professor_id) }))
    .sort((a, b) => (b.overdue_by || 0) - (a.overdue_by || 0) || a.name.localeCompare(b.name)),
  [professors, signedIds]);
  const maxLate = rows.reduce((m, f) => Math.max(m, f.overdue_by || 0), 0);
  const byLate = tally(rows, (f) => lateBucket(f.overdue_by || 0)).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
  const byDept = tally(rows, (f) => f.department);
  const byLevel = tally(rows, (f) => f.hire_level);

  const notSigned = overdueFaculty.filter((f) => !f.signedUp).length;
  const preview = overdueFaculty.slice(0, FACULTY_PREVIEW);
  const [dialogOpen, setDialogOpen] = useState(false);
  const showAllRef = useRef(null);
  const closeDialog = useCallback(() => { setDialogOpen(false); showAllRef.current?.focus(); }, []);

  return (
    <div className="stack">
      <MetricHero
        code="1b" label="Overdue evaluations" tone={overdue.count === 0 ? 'good' : overdue.notSignedUp ? 'bad' : 'warn'}
        value={overdue.count}
        sub="Assistant: due through the next calendar year · Associate/Full: same semester two years later"
        stats={[
          { label: 'Not signed up', value: overdue.notSignedUp, tone: overdue.notSignedUp ? 'bad' : 'good', sub: 'Overdue and still not in this cycle' },
          { label: 'Signed up', value: overdue.count - overdue.notSignedUp, tone: 'good', sub: 'Overdue but catching up this cycle' },
          { label: 'Most semesters late', value: maxLate, tone: maxLate ? 'bad' : 'neutral' },
        ]}
      />

      <div className="grid grid-340 grid-stretch">
        <Card title="How late">
          {byLate.length === 0 ? <Empty>Nobody is overdue.</Empty> : byLate.map(([label, n]) => (
            <BreakRow key={label} label={label} value={n} max={overdue.count} tone="bad" />
          ))}
        </Card>
        <Card title="By department">
          {byDept.length === 0 ? <Empty>Nobody is overdue.</Empty> : byDept.map(([label, n]) => (
            <BreakRow key={label} label={label} value={n} max={byDept[0][1]} tone="warn" />
          ))}
        </Card>
        <Card title="By hiring level">
          {byLevel.length === 0 ? <Empty>Nobody is overdue.</Empty> : byLevel.map(([label, n]) => (
            <BreakRow key={label} label={label} value={n} max={byLevel[0][1]} tone="warn" />
          ))}
        </Card>
      </div>

      <section className="card card-flush list-panel" aria-labelledby="overdue-title">
        <div className="card-head">
          <div>
            <h2 id="overdue-title" className="card-title">Overdue faculty</h2>
            <p className="card-sub">{`${overdueFaculty.length} overdue · ${notSigned} not signed up · most overdue first`}</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => exportFacultyCsv(overdueFaculty, term)} disabled={overdueFaculty.length === 0}>
              <Icon name="download" size={14} /> Export CSV
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <FacultyTable rows={preview} empty="Nobody is overdue." />
        </div>
        <div className="card-foot row-between">
          <span>Showing {preview.length} of {overdueFaculty.length}</span>
          {overdueFaculty.length > 0 && (
            <button ref={showAllRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setDialogOpen(true)} aria-haspopup="dialog">
              Show all {overdueFaculty.length}
            </button>
          )}
        </div>
        {dialogOpen && (
          <FacultyDialog faculty={overdueFaculty} term={term} title="Overdue faculty" onClose={closeDialog}
            sub={`${overdueFaculty.length} overdue · ${notSigned} not signed up · most overdue first`} />
        )}
      </section>
    </div>
  );
}

/* ---------- 2a: Participation rate ---------- */

// Rate per group: [label, signedUp, due], lowest rate first so the gaps stand out.
const ratesBy = (rows, keyFn) => {
  const groups = new Map();
  rows.forEach((r) => {
    const key = keyFn(r) || 'Unknown';
    const g = groups.get(key) || { signed: 0, due: 0 };
    g.due += 1;
    if (r.signedUp) g.signed += 1;
    groups.set(key, g);
  });
  return [...groups.entries()]
    .map(([label, g]) => ({ label, ...g, rate: rateOf(g.signed, g.due) }))
    .sort((a, b) => a.rate - b.rate || b.due - a.due || a.label.localeCompare(b.label));
};

function RateCard({ title, sub, groups, empty }) {
  return (
    <Card title={title} sub={sub}>
      {groups.length === 0 ? <Empty>{empty}</Empty> : groups.map((g) => (
        <BreakRow key={g.label} label={g.label} value={g.signed} max={g.due} tone={toneFor(g.rate)} display={<RateValue num={g.signed} den={g.due} />} />
      ))}
    </Card>
  );
}

function ParticipationPage({ k, signups, professors = [], term }) {
  const { participation, overdue } = k;
  const signedIds = useMemo(() => new Set(signups.map((s) => s.observeeId)), [signups]);
  const rows = useMemo(() => overdue.due.map((f) => ({ ...f, signedUp: signedIds.has(f.professor_id) })), [overdue.due, signedIds]);
  const dueIds = useMemo(() => new Set(overdue.due.map((f) => f.professor_id)), [overdue.due]);
  const notDueSignups = new Set(signups.filter((s) => !dueIds.has(s.observeeId)).map((s) => s.observeeId)).size;
  const missingCount = participation.denominator - participation.numerator;

  // Faculty list: every professor, overdue first (most semesters late first), then due, then not due.
  const allFaculty = useMemo(() => professors
    .map((f) => ({ ...f, signedUp: signedIds.has(f.professor_id) }))
    .sort((a, b) => (STATUS_ORDER[facultyStatus(a)] ?? 2) - (STATUS_ORDER[facultyStatus(b)] ?? 2) || (b.overdue_by || 0) - (a.overdue_by || 0) || a.name.localeCompare(b.name)),
  [professors, signedIds]);
  const preview = allFaculty.slice(0, FACULTY_PREVIEW);
  const listSub = `${allFaculty.length} faculty · ${participation.denominator} due or overdue · ${missingCount} not signed up yet`;
  const [dialogOpen, setDialogOpen] = useState(false);
  const showAllRef = useRef(null);
  const closeDialog = useCallback(() => { setDialogOpen(false); showAllRef.current?.focus(); }, []);

  return (
    <div className="stack">
      <MetricHero
        code="2a" label="Participation rate" tone={toneFor(participation.rate)}
        value={pct(participation.rate)} meter={participation.rate}
        sub="Signed up this cycle ÷ due this cycle"
        stats={[
          { label: 'Due this cycle', value: participation.denominator, sub: `${overdue.count} of them overdue` },
          { label: 'Signed up', value: participation.numerator, tone: 'good' },
          { label: 'Not signed up yet', value: missingCount, tone: missingCount ? 'warn' : 'good' },
          { label: 'Signed up but not due', value: notDueSignups, sub: 'Not counted in the rate' },
        ]}
      />

      <div className="grid grid-340 grid-stretch">
        <RateCard title="By department" sub="Lowest rate first" groups={ratesBy(rows, (f) => f.department)} empty="Nobody is due this cycle." />
        <RateCard title="By hiring level" sub="Lowest rate first" groups={ratesBy(rows, (f) => f.hire_level)} empty="Nobody is due this cycle." />
        <RateCard title="Due vs overdue" sub="Overdue faculty should sign up first" groups={ratesBy(rows, (f) => f.status)} empty="Nobody is due this cycle." />
      </div>

      <section className="card card-flush list-panel" aria-labelledby="participation-title">
        <div className="card-head">
          <div>
            <h2 id="participation-title" className="card-title">Faculty list</h2>
            <p className="card-sub">{listSub}</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => exportFacultyCsv(allFaculty, term)} disabled={allFaculty.length === 0}>
              <Icon name="download" size={14} /> Export CSV
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <FacultyTable rows={preview} empty="No faculty on record." />
        </div>
        <div className="card-foot row-between">
          <span>Showing {preview.length} of {allFaculty.length}</span>
          {allFaculty.length > 0 && (
            <button ref={showAllRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setDialogOpen(true)} aria-haspopup="dialog">
              Show all {allFaculty.length}
            </button>
          )}
        </div>
        {dialogOpen && <FacultyDialog faculty={allFaculty} term={term} title="Faculty list" sub={listSub} withStatuses onClose={closeDialog} />}
      </section>
    </div>
  );
}

/* ---------- 2b: Observer utilization ---------- */

const LOAD_BUCKETS = ['1 observation', '2 observations', '3 observations', '4+ observations'];
const loadBucket = (n) => LOAD_BUCKETS[Math.min(n, 4) - 1];

function UtilizationPage({ k, observations, professors, term }) {
  const { utilization } = k;
  // Same rule as the KPI: an observation reported not held does not count toward the observer role
  const observers = useMemo(() => {
    const byId = new Map(professors.map((p) => [p.professor_id, p]));
    const map = new Map();
    observations.filter((o) => o.status !== 'Missed').forEach((o) => {
      const prof = byId.get(o.observerId);
      const row = map.get(o.observerId) || {
        id: o.observerId, name: o.observerName || prof?.name || o.observerId, department: prof?.department || 'Unknown',
        total: 0, completed: 0, inProgress: 0, observees: [],
      };
      row.total += 1;
      if (o.status === 'Completed') row.completed += 1; else row.inProgress += 1;
      row.observees.push(o.observeeName);
      map.set(o.observerId, row);
    });
    return [...map.values()];
  }, [observations, professors]);

  const activeObs = observers.reduce((n, o) => n + o.total, 0);
  const avg = observers.length ? (activeObs / observers.length).toFixed(1) : '0.0';
  const idle = Math.max(0, professors.length - observers.length);
  const byLoad = LOAD_BUCKETS.map((label) => [label, observers.filter((o) => loadBucket(o.total) === label).length]);
  const byDept = tally(observers, (o) => o.department);
  const busiest = [...observers].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 6);

  // Most observations first; "Show all" opens the full list with search + Advanced filtering.
  const sortedObservers = useMemo(() => [...observers].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)), [observers]);
  const observerPreview = sortedObservers.slice(0, OBSERVER_PREVIEW);
  const observersSub = `${observers.length} observers · ${activeObs} active observations (reported-not-held ones are left out)`;
  const [dialogOpen, setDialogOpen] = useState(false);
  const showAllRef = useRef(null);
  const closeDialog = useCallback(() => { setDialogOpen(false); showAllRef.current?.focus(); }, []);

  return (
    <div className="stack">
      <MetricHero
        code="2b" label="Observer utilization" tone={toneFor(utilization.rate)}
        value={pct(utilization.rate)} meter={utilization.rate}
        sub="Professors who took on the observer role ÷ sign-ups"
        stats={[
          { label: 'Observers', value: utilization.numerator, tone: 'good', sub: 'Observing at least one sign-up' },
          { label: 'Faculty signed up', value: utilization.denominator, sub: 'Each observee counted once' },
          { label: 'Average load', value: avg, sub: 'Observations per observer' },
          { label: 'Faculty not observing', value: idle, sub: 'Unused observer capacity' },
        ]}
      />

      <div className="grid grid-340 grid-stretch">
        <Card title="Load per observer" sub="How many observations each observer has">
          {observers.length === 0 ? <Empty>No observers yet.</Empty> : byLoad.map(([label, n]) => (
            <BreakRow key={label} label={label} value={n} max={observers.length} tone={label.startsWith('1') || label.startsWith('2') ? 'good' : 'warn'} />
          ))}
        </Card>
        <Card title="Observers by department">
          {byDept.length === 0 ? <Empty>No observers yet.</Empty> : byDept.map(([label, n]) => (
            <BreakRow key={label} label={label} value={n} max={byDept[0][1]} tone="info" />
          ))}
        </Card>
        <Card title="Busiest observers" sub={busiest.length ? `Top ${busiest.length}` : undefined}>
          {busiest.length === 0 ? <Empty>No observers yet.</Empty> : busiest.map((o) => (
            <BreakRow key={o.id} label={o.name} value={o.total} max={busiest[0].total} tone="info" />
          ))}
        </Card>
      </div>

      <section className="card card-flush list-panel" aria-labelledby="observers-title">
        <div className="card-head">
          <div>
            <h2 id="observers-title" className="card-title">Observers this cycle</h2>
            <p className="card-sub">{observersSub}</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => exportObserversCsv(sortedObservers, term)} disabled={observers.length === 0}>
              <Icon name="download" size={14} /> Export CSV
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <ObserversTable rows={observerPreview} empty="No observers yet." />
        </div>
        <div className="card-foot row-between">
          <span>Showing {observerPreview.length} of {observers.length}</span>
          {observers.length > 0 && (
            <button ref={showAllRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setDialogOpen(true)} aria-haspopup="dialog">
              Show all {observers.length}
            </button>
          )}
        </div>
        {dialogOpen && <ObserversDialog observers={sortedObservers} term={term} sub={observersSub} onClose={closeDialog} />}
      </section>
    </div>
  );
}

/* ---------- 3a: List sufficiency ---------- */

function SufficiencyPage({ k, signups, professors, term }) {
  const { sufficiency } = k;
  const deptOf = useMemo(() => new Map(professors.map((p) => [p.professor_id, p.department])), [professors]);
  const rows = useMemo(() => signups.map((s) => ({ ...s, department: deptOf.get(s.observeeId) || 'Unknown', size: s.matchesCount || 0 })), [signups, deptOf]);

  // List-size distribution: 0, 1, 2, ... up to the target (target+ in the last column)
  const sizes = Array.from({ length: TARGET_LIST_SIZE + 1 }, (_, n) => ({
    n, label: n === TARGET_LIST_SIZE ? `${n}+` : String(n), count: rows.filter((r) => Math.min(r.size, TARGET_LIST_SIZE) === n).length,
  }));
  const tallest = Math.max(1, ...sizes.map((s) => s.count));
  const deptAvg = useMemo(() => {
    const groups = new Map();
    rows.forEach((r) => { const g = groups.get(r.department) || { sum: 0, n: 0 }; g.sum += Math.min(r.size, TARGET_LIST_SIZE); g.n += 1; groups.set(r.department, g); });
    return [...groups.entries()].map(([label, g]) => ({ label, avg: g.sum / g.n, n: g.n })).sort((a, b) => a.avg - b.avg || a.label.localeCompare(b.label));
  }, [rows]);
  const released = rows.filter((r) => r.listReleased).length;

  // Shortest lists first; "Show all" opens the full list with search + Advanced filtering.
  const sortedLists = useMemo(() => [...rows].sort((a, b) => a.size - b.size || a.observeeName.localeCompare(b.observeeName)), [rows]);
  const listPreview = sortedLists.slice(0, LIST_PREVIEW);
  const listsSub = `${rows.length} sign-ups · ${sufficiency.insufficient + sufficiency.none} short of the ${TARGET_LIST_SIZE}-observer target · shortest lists first`;
  const [dialogOpen, setDialogOpen] = useState(false);
  const showAllRef = useRef(null);
  const closeDialog = useCallback(() => { setDialogOpen(false); showAllRef.current?.focus(); }, []);

  return (
    <div className="stack">
      <MetricHero
        code="3a" label="List sufficiency" tone={sufficiency.signups ? toneFor(sufficiency.rateOfTarget) : 'neutral'}
        value={sufficiency.average.toFixed(1)} meter={sufficiency.rateOfTarget}
        sub={`Avg list size · ${sufficiency.rateOfTarget}% of the ${TARGET_LIST_SIZE}-observer target`}
        stats={[
          { label: 'Full lists', value: sufficiency.fullLists, tone: 'good', sub: `${TARGET_LIST_SIZE} eligible observers found` },
          { label: 'Insufficient', value: sufficiency.insufficient, tone: sufficiency.insufficient ? 'warn' : 'good', sub: `Fewer than ${TARGET_LIST_SIZE}` },
          { label: 'None eligible', value: sufficiency.none, tone: sufficiency.none ? 'bad' : 'good', sub: 'Need a manual assignment' },
          { label: 'Lists released', value: `${released}/${rows.length}`, sub: `${sufficiency.totalMatches} observer matches in all` },
        ]}
      />

      <div className="grid grid-380 grid-stretch">
        <Card title="List size distribution" sub="Sign-ups by how many eligible observers they got">
          {rows.length === 0 ? <Empty>No sign-ups yet.</Empty> : (
            <div className="histo" style={{ '--bars': sizes.length }} role="img"
              aria-label={sizes.map((s) => `${s.label} observers: ${plural(s.count, 'sign-up')}`).join(', ')}>
              {sizes.map((s) => (
                <div className="histo-col" key={s.n}>
                  <span className="histo-count">{s.count}</span>
                  <span className={`histo-bar ${s.n === 0 ? 'bad' : s.n < TARGET_LIST_SIZE ? 'warn' : 'good'}`} style={{ height: `${(s.count / tallest) * 100}%` }} />
                  <span className="histo-label">{s.label}</span>
                </div>
              ))}
            </div>
          )}
          <p className="card-foot">Observers per list (target {TARGET_LIST_SIZE})</p>
        </Card>
        <Card title="Average list size by department" sub="Observee's department · shortest lists first">
          {deptAvg.length === 0 ? <Empty>No sign-ups yet.</Empty> : deptAvg.map((d) => (
            <BreakRow key={d.label} label={d.label} value={d.avg} max={TARGET_LIST_SIZE}
              tone={toneFor(rateOf(d.avg, TARGET_LIST_SIZE))}
              display={<>{d.avg.toFixed(1)} <span className="faint">· {d.n}</span></>} title={`${d.label}: ${plural(d.n, 'sign-up')}`} />
          ))}
        </Card>
      </div>

      <section className="card card-flush list-panel" aria-labelledby="lists-title">
        <div className="card-head">
          <div>
            <h2 id="lists-title" className="card-title">Observer lists</h2>
            <p className="card-sub">{listsSub}</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => exportListsCsv(sortedLists, term, TARGET_LIST_SIZE)} disabled={rows.length === 0}>
              <Icon name="download" size={14} /> Export CSV
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <ListsTable rows={listPreview} target={TARGET_LIST_SIZE} empty="No sign-ups yet." />
        </div>
        <div className="card-foot row-between">
          <span>Showing {listPreview.length} of {rows.length}</span>
          {rows.length > 0 && (
            <button ref={showAllRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setDialogOpen(true)} aria-haspopup="dialog">
              Show all {rows.length}
            </button>
          )}
        </div>
        {dialogOpen && <ListsDialog rows={sortedLists} term={term} target={TARGET_LIST_SIZE} sub={listsSub} onClose={closeDialog} />}
      </section>
    </div>
  );
}

/* ---------- 4a: Missing observations ---------- */

function MissingPage({ k, deadlines, term }) {
  const { missing } = k;
  const kinds = useMemo(() => tally(missing.missing, kindOf), [missing.missing]);
  const kindCount = (key) => kinds.find(([kk]) => kk === key)?.[1] || 0;
  const deadline = deadlines?.observation ? formatDeadline(deadlines.observation, deadlines.observationTime) : '';
  const deadlinePassed = missing.deadlinePassed;
  const awaitingNotMissing = Math.max(0, missing.approved - missing.pairConfirmed - missing.count);

  return (
    <div className="stack">
      <MetricHero
        code="4a" label="Missing observations" tone={missing.count ? 'bad' : 'good'}
        value={missing.count}
        sub="Reported not held, or not confirmed by both people after the observation deadline"
        stats={[
          { label: 'Approved appointments', value: missing.approved },
          { label: 'Pair-confirmed', value: missing.pairConfirmed, tone: 'good', sub: 'Both people confirmed it took place' },
          { label: 'Awaiting confirmation', value: missing.awaiting, tone: missing.awaiting ? 'warn' : 'neutral', sub: deadlinePassed && missing.awaiting ? 'Counted as missing: the deadline passed' : 'Not confirmed by both people yet' },
          { label: 'Observation deadline', value: deadlinePassed ? 'Passed' : deadline ? 'Open' : 'Not set', tone: deadlinePassed ? 'bad' : 'neutral', sub: deadline || undefined },
        ]}
      />

      {!deadlinePassed && (
        <Notice tone="info" icon="clock" title="Only reported-not-held appointments count right now">
          After the observation deadline{deadline ? ` (${deadline})` : ''}, appointments not confirmed by both people count as missing too.
        </Notice>
      )}

      <div className="grid grid-380 grid-stretch">
        <Card title="Why they did not go through">
          {missing.count === 0 ? <Empty>Every approved appointment went through.</Empty> : Object.entries(MISSING_KINDS).map(([key, kd]) => (
            <BreakRow key={key} label={kd.label} value={kindCount(key)} max={missing.count} tone={kd.tone} />
          ))}
        </Card>
        <Card title="Approved appointments" sub="Where every approved appointment stands">
          {missing.approved === 0 ? <Empty>No approved appointments yet.</Empty> : <>
            <BreakRow label="Pair-confirmed" value={missing.pairConfirmed} max={missing.approved} tone="good" />
            <BreakRow label="Still in progress" value={awaitingNotMissing} max={missing.approved} tone="warn" />
            <BreakRow label="Missing" value={missing.count} max={missing.approved} tone="bad" />
          </>}
        </Card>
      </div>

      {missing.count > 0
        ? <MissingList missing={missing.missing} term={term} />
        : <Notice tone="good" title="No missing observations">Every approved appointment went through, or is still within the observation window.</Notice>}
    </div>
  );
}

/* ---------- 4b: Survey completion ---------- */

function SurveyPage({ k, deadlines, term }) {
  const { survey } = k;
  const ready = isSurveyClosed(deadlines?.survey, deadlines?.surveyTime);
  const surveyDeadline = deadlines?.survey ? formatSurveyDeadline(deadlines.survey, deadlines.surveyTime) : '';
  // Before the survey closes, everything stops at "was observed" so survey progress stays hidden
  const steps = useMemo(() => (ready ? survey.funnel : survey.funnel.filter((s) => s.key !== 'surveyed')), [ready, survey.funnel]);
  const total = survey.denominator;
  const observed = survey.funnel.find((s) => s.key === 'observed')?.count || 0;

  // How far each sign-up got: index of the last step passed in order (cumulative, same as the funnel)
  const rows = useMemo(() => survey.stages.map((p, i) => {
    let reached = -1;
    while (reached + 1 < steps.length && p[steps[reached + 1].key]) reached += 1;
    return { ...p, rowKey: `${p.id}-${i}`, reached };
  }), [survey.stages, steps]);
  const drops = steps.slice(1).map((s, i) => ({ ...s, lost: steps[i].count - s.count, from: steps[i].label }));
  const biggest = drops.reduce((best, d) => (d.lost > (best?.lost || 0) ? d : best), null);

  // Least progress first; "Show all" opens the full list with search + Advanced filtering.
  const progressRows = useMemo(() => [...rows].sort((a, b) => a.reached - b.reached || String(a.name).localeCompare(String(b.name))), [rows]);
  const lastIdx = steps.length - 1;

  return (
    <div className="stack">
      {ready ? (
        <MetricHero
          code="4b" label="Survey completion" tone={total ? toneFor(survey.rate) : 'neutral'}
          value={pct(survey.rate)} meter={survey.rate}
          sub="Sign-ups that finished every step through the survey ÷ sign-ups"
          stats={[
            { label: 'Sign-ups', value: total },
            { label: 'Completed everything', value: survey.numerator, tone: 'good' },
            { label: 'Were observed', value: observed, sub: 'Could have taken the survey' },
            { label: 'Biggest drop-off', value: biggest ? `−${biggest.lost}` : '0', tone: biggest ? 'bad' : 'good', sub: biggest ? `Before “${biggest.label}”` : 'Nobody dropped out' },
          ]}
        />
      ) : (
        <>
          <MetricHero
            code="4b" label="Survey completion" tone="neutral" value="Locked"
            sub={`Calculated after the survey closes${surveyDeadline ? ` (${surveyDeadline})` : ''}`}
            stats={[
              { label: 'Sign-ups', value: total },
              { label: 'Were observed', value: observed, tone: 'good', sub: 'Can take the survey' },
              { label: 'Biggest drop-off', value: biggest ? `−${biggest.lost}` : '0', tone: biggest ? 'bad' : 'good', sub: biggest ? `Before “${biggest.label}”` : 'Nobody dropped out' },
            ]}
          />
          <Notice tone="info" icon="lock" title="Survey progress stays hidden until the survey closes">
            The funnel and the list below stop at “Was observed”{surveyDeadline ? ` until ${surveyDeadline}` : ''}, so nobody can tell who has answered yet.
          </Notice>
        </>
      )}

      <div className="grid grid-460 grid-stretch">
        <Card title="Process funnel" sub={ready ? 'Sign up → request → confirm → observed → survey' : 'Survey step appears after the survey closes'}>
          {steps.map((step, i) => (
            <React.Fragment key={step.key}>
              {i > 0 && drops[i - 1].lost > 0 && <p className="funnel-drop">−{drops[i - 1].lost} stopped after “{drops[i - 1].from}”</p>}
              <div className="bar-row">
                <span>{step.label}</span>
                <Meter size="lg" tone="info" value={total ? (step.count / total) * 100 : 0} label={`${step.label}: ${step.count}`} />
                <span>{step.count}</span>
              </div>
            </React.Fragment>
          ))}
        </Card>
        <Card title="Where people stopped" sub="Sign-ups by the last step they finished">
          {total === 0 ? <Empty>No sign-ups yet.</Empty> : steps.map((step, i) => {
            const n = rows.filter((r) => r.reached === i).length;
            const done = i === lastIdx;
            return <BreakRow key={step.key} label={done ? 'Finished every step' : step.label} value={n} max={total} tone={done ? 'good' : 'warn'} />;
          })}
        </Card>
      </div>

      <ProgressList rows={progressRows} steps={steps} ready={ready} term={term}
        sub={`${total} sign-ups · ${ready ? `${survey.numerator} finished every step` : `${observed} observed so far`}`} />
    </div>
  );
}

/* ---------- Page switch ---------- */

const PAGES = {
  'metric-1a': EligibilityPage,
  'metric-1b': OverduePage,
  'metric-2a': ParticipationPage,
  'metric-2b': UtilizationPage,
  'metric-3a': SufficiencyPage,
  'metric-4a': MissingPage,
  'metric-4b': SurveyPage,
};

export default function MetricDetail({ metric, ...props }) {
  const k = useKpis(props);
  const Page = PAGES[metric];
  if (!Page) return null;
  return <Page k={k} {...props} />;
}
