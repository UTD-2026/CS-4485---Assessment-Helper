import React, { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { Badge, Card, Meter, Notice } from './ui.jsx';
import { VIOLATION_TYPES, TARGET_LIST_SIZE } from '../utils/kpis.js';
import { useKpis, toneFor, pct, rateOf } from '../utils/metricPages.js';
import { isSurveyClosed, formatDeadline, formatSurveyDeadline } from '../utils/deadlines.js';
import { plural } from '../utils/format.js';
import { ListPanel, MissingList, PairingsList } from './KpiListDialogs.jsx';
import { MISSING_KINDS, kindOf, matches, optionsOf } from '../utils/lists.js';

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

function ClearButton({ show, onClick }) {
  return show ? <button type="button" className="btn btn-ghost btn-sm" onClick={onClick}>Clear</button> : null;
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

function OverduePage({ k, onNavigate }) {
  const { overdue } = k;
  const rows = overdue.overdue;
  const dueOnly = overdue.due.length - overdue.count;
  const maxLate = rows.reduce((m, f) => Math.max(m, f.overdue_by || 0), 0);
  const byLate = tally(rows, (f) => lateBucket(f.overdue_by || 0)).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
  const byDept = tally(rows, (f) => f.department);
  const byLevel = tally(rows, (f) => f.hire_level);

  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  const [level, setLevel] = useState('all');
  const [signed, setSigned] = useState('all');
  const departments = useMemo(() => optionsOf(rows, 'department'), [rows]);
  const levels = useMemo(() => optionsOf(rows, 'hire_level'), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((f) =>
      (dept === 'all' || f.department === dept) &&
      (level === 'all' || f.hire_level === level) &&
      (signed === 'all' || (signed === 'yes') === f.signedUp) &&
      matches(q, f.name, f.department, f.email));
  }, [rows, query, dept, level, signed]);
  const filtered = query || dept !== 'all' || level !== 'all' || signed !== 'all';

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
          { label: 'Due, not overdue yet', value: dueOnly, tone: dueOnly ? 'warn' : 'neutral', sub: 'Become overdue if missed this cycle' },
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

      <ListPanel
        titleId="overdue-title" title="Overdue faculty"
        sub={`${overdue.count} overdue · ${overdue.notSignedUp} not signed up · most overdue first`}
        actions={onNavigate && (
          <button type="button" className="btn btn-accent btn-sm" onClick={() => onNavigate('faculty', { status: 'Overdue' })}>
            Open in Faculty search <Icon name="chevronRight" size={14} />
          </button>
        )}
        filters={<>
          <input className="input" type="search" placeholder="Search by professor or department" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search overdue faculty" />
          <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
            <option value="all">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="select" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by hiring level">
            <option value="all">All levels</option>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select className="select" value={signed} onChange={(e) => setSigned(e.target.value)} aria-label="Filter by sign-up">
            <option value="all">Signed up or not</option>
            <option value="no">Not signed up · {overdue.notSignedUp}</option>
            <option value="yes">Signed up · {overdue.count - overdue.notSignedUp}</option>
          </select>
          <ClearButton show={filtered} onClick={() => { setQuery(''); setDept('all'); setLevel('all'); setSigned('all'); }} />
        </>}
        footer={`Showing ${shown.length} of ${overdue.count}.`}
      >
        <table className="data-table data-table-compact">
          <thead><tr><th>Professor</th><th>Level</th><th>Department</th><th>Last evaluated</th><th>Late by</th><th>This cycle</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan="6" className="empty-cell">{overdue.count ? 'No faculty match these filters.' : 'Nobody is overdue.'}</td></tr>}
            {shown.map((f) => (
              <tr key={f.professor_id}>
                <td className="strong nowrap">{f.name}</td>
                <td>{f.hire_level}</td>
                <td>{f.department}</td>
                <td className="mono">{f.last_evaluation || 'Never'}</td>
                <td className="mono text-bad nowrap">{f.overdue_by} sem</td>
                <td><Badge tone={f.signedUp ? 'good' : 'warn'}>{f.signedUp ? 'Signed up' : 'Not signed up'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListPanel>
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

function ParticipationPage({ k, signups, onNavigate }) {
  const { participation, overdue } = k;
  const signedIds = useMemo(() => new Set(signups.map((s) => s.observeeId)), [signups]);
  const rows = useMemo(() => overdue.due.map((f) => ({ ...f, signedUp: signedIds.has(f.professor_id) })), [overdue.due, signedIds]);
  const dueIds = useMemo(() => new Set(overdue.due.map((f) => f.professor_id)), [overdue.due]);
  const notDueSignups = new Set(signups.filter((s) => !dueIds.has(s.observeeId)).map((s) => s.observeeId)).size;
  const missingCount = participation.denominator - participation.numerator;

  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  const [status, setStatus] = useState('all');
  const [signed, setSigned] = useState('no');
  const departments = useMemo(() => optionsOf(rows, 'department'), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((f) =>
        (dept === 'all' || f.department === dept) &&
        (status === 'all' || f.status === status) &&
        (signed === 'all' || (signed === 'yes') === f.signedUp) &&
        matches(q, f.name, f.department, f.email))
      .sort((a, b) => Number(a.signedUp) - Number(b.signedUp) || (b.overdue_by || 0) - (a.overdue_by || 0) || a.name.localeCompare(b.name));
  }, [rows, query, dept, status, signed]);
  const filtered = query || dept !== 'all' || status !== 'all' || signed !== 'no';

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

      <ListPanel
        titleId="participation-title" title="Due faculty"
        sub={`${participation.denominator} due or overdue · ${missingCount} not signed up yet`}
        actions={onNavigate && (
          <button type="button" className="btn btn-accent btn-sm" onClick={() => onNavigate('faculty', { status: 'due-overdue' })}>
            Open in Faculty search <Icon name="chevronRight" size={14} />
          </button>
        )}
        filters={<>
          <input className="input" type="search" placeholder="Search by professor or department" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search due faculty" />
          <select className="select" value={signed} onChange={(e) => setSigned(e.target.value)} aria-label="Filter by sign-up">
            <option value="no">Not signed up · {missingCount}</option>
            <option value="yes">Signed up · {participation.numerator}</option>
            <option value="all">Signed up or not</option>
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by evaluation status">
            <option value="all">Due + overdue</option>
            <option value="Due">Due only</option>
            <option value="Overdue">Overdue only</option>
          </select>
          <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
            <option value="all">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <ClearButton show={filtered} onClick={() => { setQuery(''); setDept('all'); setStatus('all'); setSigned('no'); }} />
        </>}
        footer={`Showing ${shown.length} of ${rows.length}.`}
      >
        <table className="data-table data-table-compact">
          <thead><tr><th>Professor</th><th>Level</th><th>Department</th><th>Evaluation status</th><th>Last evaluated</th><th>This cycle</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan="6" className="empty-cell">{rows.length ? 'No faculty match these filters.' : 'Nobody is due this cycle.'}</td></tr>}
            {shown.map((f) => (
              <tr key={f.professor_id}>
                <td className="strong nowrap">{f.name}</td>
                <td>{f.hire_level}</td>
                <td>{f.department}</td>
                <td>{f.status === 'Overdue' ? <Badge tone="bad">Overdue · {f.overdue_by} sem</Badge> : <Badge tone="warn">Due</Badge>}</td>
                <td className="mono">{f.last_evaluation || 'Never'}</td>
                <td><Badge tone={f.signedUp ? 'good' : 'neutral'}>{f.signedUp ? 'Signed up' : 'Not signed up'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListPanel>
    </div>
  );
}

/* ---------- 2b: Observer utilization ---------- */

const LOAD_BUCKETS = ['1 observation', '2 observations', '3 observations', '4+ observations'];
const loadBucket = (n) => LOAD_BUCKETS[Math.min(n, 4) - 1];

function UtilizationPage({ k, observations, professors }) {
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

  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  const [sort, setSort] = useState('load');
  const departments = useMemo(() => optionsOf(observers, 'department'), [observers]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return observers
      .filter((o) => (dept === 'all' || o.department === dept) && matches(q, o.name, o.department, ...o.observees))
      .sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [observers, query, dept, sort]);
  const filtered = query || dept !== 'all';

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

      <ListPanel
        titleId="observers-title" title="Observers this cycle"
        sub={`${observers.length} observers · ${activeObs} active observations (reported-not-held ones are left out)`}
        filters={<>
          <input className="input" type="search" placeholder="Search by observer, department or observee" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search observers" />
          <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
            <option value="all">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            <option value="load">Most observations first</option>
            <option value="name">Name A–Z</option>
          </select>
          <ClearButton show={filtered} onClick={() => { setQuery(''); setDept('all'); }} />
        </>}
        footer={`Showing ${shown.length} of ${observers.length}.`}
      >
        <table className="data-table data-table-compact">
          <thead><tr><th>Observer</th><th>Department</th><th>Observing</th><th>Completed</th><th>In progress</th><th>Observees</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan="6" className="empty-cell">{observers.length ? 'No observers match these filters.' : 'No observers yet.'}</td></tr>}
            {shown.map((o) => (
              <tr key={o.id}>
                <td className="strong nowrap">{o.name}</td>
                <td>{o.department}</td>
                <td><strong className="num">{o.total}</strong></td>
                <td><span className="num text-good">{o.completed}</span></td>
                <td><span className="num">{o.inProgress}</span></td>
                <td>{o.observees.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListPanel>
    </div>
  );
}

/* ---------- 3a: List sufficiency ---------- */

const FLAGS = {
  OK: { label: 'Full list', tone: 'good' },
  'INSUFFICIENT OBSERVERS': { label: 'Insufficient', tone: 'warn' },
  'NO ELIGIBLE OBSERVER': { label: 'None eligible', tone: 'bad' },
};

function SufficiencyPage({ k, signups, professors, onNavigate }) {
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

  const [query, setQuery] = useState('');
  const [flag, setFlag] = useState('short');
  const [dept, setDept] = useState('all');
  const departments = useMemo(() => optionsOf(rows, 'department'), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) =>
        (flag === 'all' || (flag === 'short' ? r.matchFlag !== 'OK' : r.matchFlag === flag)) &&
        (dept === 'all' || r.department === dept) &&
        matches(q, r.observeeName, r.courseCode, r.department))
      .sort((a, b) => a.size - b.size || a.observeeName.localeCompare(b.observeeName));
  }, [rows, query, flag, dept]);
  const filtered = query || flag !== 'short' || dept !== 'all';

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

      <ListPanel
        titleId="lists-title" title="Observer lists"
        sub={`${rows.length} sign-ups · ${sufficiency.insufficient + sufficiency.none} short of the ${TARGET_LIST_SIZE}-observer target`}
        actions={onNavigate && (
          <button type="button" className="btn btn-accent btn-sm" onClick={() => onNavigate('signups')}>
            Open Signup monitor <Icon name="chevronRight" size={14} />
          </button>
        )}
        filters={<>
          <input className="input" type="search" placeholder="Search by observee, course or department" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search observer lists" />
          <select className="select" value={flag} onChange={(e) => setFlag(e.target.value)} aria-label="Filter by list status">
            <option value="short">Short lists · {sufficiency.insufficient + sufficiency.none}</option>
            <option value="all">All lists · {rows.length}</option>
            {Object.entries(FLAGS).map(([key, f]) => <option key={key} value={key}>{f.label} · {rows.filter((r) => r.matchFlag === key).length}</option>)}
          </select>
          <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
            <option value="all">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <ClearButton show={filtered} onClick={() => { setQuery(''); setFlag('short'); setDept('all'); }} />
        </>}
        footer={`Showing ${shown.length} of ${rows.length}. Shortest lists first.`}
      >
        <table className="data-table data-table-compact">
          <thead><tr><th>Observee</th><th>Department</th><th>Course</th><th>Class time</th><th>List size</th><th>Status</th><th>Released</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan="7" className="empty-cell">{rows.length ? 'No sign-ups match these filters.' : 'No sign-ups yet.'}</td></tr>}
            {shown.map((r) => {
              const f = FLAGS[r.matchFlag] || { label: r.matchFlag, tone: 'neutral' };
              return (
                <tr key={r.id}>
                  <td className="strong nowrap">{r.observeeName}</td>
                  <td>{r.department}</td>
                  <td className="mono nowrap">{r.courseCode}</td>
                  <td className="nowrap">{r.timing}</td>
                  <td><span className={`num text-${f.tone}`}>{r.size}</span><span className="faint"> / {TARGET_LIST_SIZE}</span></td>
                  <td><Badge tone={f.tone}>{f.label}</Badge></td>
                  <td>{r.listReleased ? <Badge tone="good">Released</Badge> : <Badge>Not yet</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ListPanel>
    </div>
  );
}

/* ---------- 4a: Missing observations ---------- */

function MissingPage({ k, deadlines }) {
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
        ? <MissingList missing={missing.missing} />
        : <Notice tone="good" title="No missing observations">Every approved appointment went through, or is still within the observation window.</Notice>}
    </div>
  );
}

/* ---------- 4b: Survey completion ---------- */

function SurveyPage({ k, deadlines }) {
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

  const [query, setQuery] = useState('');
  const [reached, setReached] = useState('all');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (reached === 'all' || r.reached === Number(reached)) && matches(q, r.name))
      .sort((a, b) => a.reached - b.reached || String(a.name).localeCompare(String(b.name)));
  }, [rows, query, reached]);
  const filtered = query || reached !== 'all';
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

      <ListPanel
        titleId="process-title" title="Progress by sign-up"
        sub={`${total} sign-ups · ${ready ? `${survey.numerator} finished every step` : `${observed} observed so far`}`}
        filters={<>
          <input className="input" type="search" placeholder="Search by professor" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sign-ups" />
          <select className="select" value={reached} onChange={(e) => setReached(e.target.value)} aria-label="Filter by last step finished">
            <option value="all">Any step</option>
            {steps.map((s, i) => <option key={s.key} value={i}>{i === lastIdx ? `Finished (${s.label.toLowerCase()})` : `Stopped after: ${s.label}`} · {rows.filter((r) => r.reached === i).length}</option>)}
          </select>
          <ClearButton show={filtered} onClick={() => { setQuery(''); setReached('all'); }} />
        </>}
        footer={`Showing ${shown.length} of ${total}. Furthest along last.`}
      >
        <table className="data-table data-table-compact">
          <thead><tr><th>Professor</th><th>Progress</th><th>Last step finished</th><th>Next step</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan="4" className="empty-cell">{total ? 'No sign-ups match these filters.' : 'No sign-ups yet.'}</td></tr>}
            {shown.map((r) => {
              const next = steps[r.reached + 1];
              return (
                <tr key={r.rowKey}>
                  <td className="strong nowrap">{r.name}</td>
                  <td>
                    <span className="step-dots" role="img" aria-label={`${r.reached + 1} of ${steps.length} steps`}>
                      {steps.map((s, i) => <span key={s.key} className={`step-dot${i <= r.reached ? ' done' : ''}`} title={s.label} />)}
                    </span>
                  </td>
                  <td>{r.reached >= 0 ? steps[r.reached].label : '—'}</td>
                  <td>{next ? <Badge tone="warn">{next.label}</Badge> : <Badge tone="good">{ready ? 'Done' : 'Observed'}</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ListPanel>
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
