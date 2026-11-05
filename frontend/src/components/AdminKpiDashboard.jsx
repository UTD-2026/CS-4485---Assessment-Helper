import React, { useCallback, useMemo, useState } from 'react';
import { computeAllKpis, VIOLATION_TYPES, TARGET_LIST_SIZE } from '../utils/kpis.js';
import { isSurveyClosed, formatSurveyDeadline } from '../utils/deadlines.js';
import { Badge, Card, Meter } from './ui.jsx';
import { plural } from '../utils/format.js';
import { PairingsDialog, MissingDialog } from './KpiListDialogs.jsx';

/**
 * Committee "Live metrics": the 4 KPI groups from the project spec.
 *
 * Props: global app state (signups, requests, observations, surveySubmissions, deadlines, professors, courses)
 * and onNavigate(tab, filters) so cards can jump to the matching list.
 * surveySubmissions only carries WHO submitted (never answers), so survey anonymity is preserved.
 */

const toneFor = (rate, good = 80, ok = 50) => (rate == null ? 'neutral' : rate >= good ? 'good' : rate >= ok ? 'warn' : 'bad');
const pct = (n) => `${n}%`;

function KpiCard({ id, label, value, tone, meter, sub, formula, children }) {
  return (
    <div className="card kpi-card">
      <div className="row-between">
        <span className="kpi-label">{label}</span>
        <Badge tone={tone}>{id}</Badge>
      </div>
      <div className={`kpi-value text-${tone}`}>{value}</div>
      {meter !== undefined && <Meter value={meter} tone={tone} label={`${label}: ${value}`} />}
      <div className="kpi-sub">{sub}</div>
      {children}
      {formula && <div className="formula">{formula}</div>}
    </div>
  );
}

export default function AdminKpiDashboard({ signups, requests, observations, surveySubmissions, deadlines, professors, courses, onNavigate }) {
  const k = useMemo(
    () => computeAllKpis({ signups, requests, observations, surveySubmissions, deadlines, professors, courses }),
    [signups, requests, observations, surveySubmissions, deadlines, professors, courses]
  );
  const { eligibility, overdue, participation, utilization, sufficiency, missing, survey } = k;
  const [openList, setOpenList] = useState(null); // 'pairings' | 'missing' | null: which pop-up list is open
  const closeList = useCallback(() => setOpenList(null), []);

  // The survey KPI is only generated once the survey (feedback) deadline has passed
  const surveyKpiReady = isSurveyClosed(deadlines?.survey, deadlines?.surveyTime);
  const surveyDeadline = deadlines?.survey ? formatSurveyDeadline(deadlines.survey, deadlines.surveyTime) : '';
  // Before the survey closes, the funnel stops at "was observed" so survey progress stays hidden
  const funnel = surveyKpiReady ? survey.funnel : survey.funnel.filter((s) => s.key !== 'surveyed');
  const eligibilityTone = eligibility.rate == null ? 'neutral' : eligibility.incorrect.length ? 'bad' : 'good';
  const overdueShown = overdue.overdue.slice(0, 6);
  const missingShown = missing.missing.slice(0, 6); // same preview length as Most overdue; the rest are in the pop-up

  return (
    <div className="stack">
      {/* One row per KPI section (1-4); each row splits its width evenly between that section's metrics. */}
      <section className="kpi-row" style={{ '--cols': 2 }} aria-label="KPI section 1">
        <KpiCard
          id="1a" label="Eligibility accuracy" tone={eligibilityTone}
          value={eligibility.rate == null ? '—' : pct(eligibility.rate)} meter={eligibility.rate ?? 0}
          sub={eligibility.total ? `${eligibility.correct} of ${eligibility.total} pairings pass every rule` : 'No observer pairings to audit yet'}
          formula="Correct pairings ÷ audited pairings (recommended + confirmed)"
        />
        <KpiCard
          id="1b" label="Overdue evaluations" tone={overdue.count === 0 ? 'good' : overdue.notSignedUp ? 'bad' : 'warn'}
          value={overdue.count}
          sub={overdue.count ? `${overdue.notSignedUp} of them have not signed up` : 'Nobody is overdue'}
          formula="Assistant: due through the next calendar year · Associate/Full: same semester two years later"
        />
      </section>

      <section className="kpi-row" style={{ '--cols': 2 }} aria-label="KPI section 2">
        <KpiCard
          id="2a" label="Participation rate" tone={toneFor(participation.rate)}
          value={pct(participation.rate)} meter={participation.rate}
          sub={`${participation.numerator} of ${participation.denominator} due faculty signed up`}
          formula="Signed up this cycle ÷ due this cycle"
        />
        <KpiCard
          id="2b" label="Observer utilization" tone={toneFor(utilization.rate)}
          value={pct(utilization.rate)} meter={utilization.rate}
          sub={`${plural(utilization.numerator, 'observer')} for ${plural(utilization.denominator, 'sign-up')}`}
          formula="Professors who took on the observer role ÷ sign-ups"
        />
      </section>

      <section className="kpi-row" style={{ '--cols': 1 }} aria-label="KPI section 3">
        <KpiCard
          id="3a" label="List sufficiency" tone={sufficiency.signups ? toneFor(sufficiency.rateOfTarget) : 'neutral'}
          value={sufficiency.average.toFixed(1)} meter={sufficiency.rateOfTarget}
          sub={`Avg list size · ${sufficiency.rateOfTarget}% of the ${TARGET_LIST_SIZE}-observer target`}
          formula={`Eligible observers per sign-up ÷ ${TARGET_LIST_SIZE}-observer target`}
        >
          <div className="kpi-chips">
            <Badge tone="good">{sufficiency.fullLists} full</Badge>
            <Badge tone="warn">{sufficiency.insufficient} insufficient</Badge>
            <Badge tone="bad">{sufficiency.none} none eligible</Badge>
          </div>
        </KpiCard>
      </section>

      <section className="kpi-row section-gap" style={{ '--cols': 2 }} aria-label="KPI section 4">
        <KpiCard
          id="4a" label="Missing observations" tone={missing.count ? 'bad' : 'good'}
          value={missing.count}
          sub={missing.count ? `${missing.count} of ${missing.approved} approved appointments did not go through` : 'Every approved appointment went through'}
          formula="Reported not held, or not confirmed by both people after the observation deadline"
        >
          <div className="kpi-chips">
            <Badge tone="info">{missing.approved} approved</Badge>
            <Badge tone="good">{missing.pairConfirmed} pair-confirmed</Badge>
            <Badge tone="warn">{missing.awaiting} awaiting</Badge>
            {missing.deadlinePassed && <Badge>Deadline passed</Badge>}
          </div>
        </KpiCard>
        {surveyKpiReady ? (
          <KpiCard
            id="4b" label="Survey completion" tone={survey.denominator ? toneFor(survey.rate) : 'neutral'}
            value={pct(survey.rate)} meter={survey.rate}
            sub={`${survey.numerator} of ${survey.denominator} sign-ups completed the whole process`}
            formula="Sign-ups that finished every step through the survey ÷ sign-ups"
          />
        ) : (
          <KpiCard
            id="4b" label="Survey completion" tone="neutral" value="Locked"
            sub={`Calculated after the survey closes${surveyDeadline ? ` (${surveyDeadline})` : ''}`}
            formula="Sign-ups that finished every step through the survey ÷ sign-ups"
          />
        )}
      </section>

      {/* grid-stretch: the two boxes in each row (funnel + audit, overdue + not held) are always the same height */}
      <div className="grid grid-460 grid-stretch">
        <Card title="Process funnel" sub={surveyKpiReady ? 'Sign up → request → confirm → observed → survey' : 'Survey step appears after the survey closes'}>
          {funnel.map((step) => (
            <div className="bar-row" key={step.key}>
              <span>{step.label}</span>
              <Meter size="lg" tone="info" value={survey.denominator ? (step.count / survey.denominator) * 100 : 0} label={`${step.label}: ${step.count}`} />
              <span>{step.count}</span>
            </div>
          ))}
        </Card>

        <Card
          title="Eligibility audit"
          sub={eligibility.incorrect.length ? `${plural(eligibility.incorrect.length, 'pairing')} break a rule` : 'Every audited pairing passes'}
          actions={eligibility.incorrect.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="dialog" onClick={() => setOpenList('pairings')}>Show pairings</button>
          )}
        >
          {Object.entries(VIOLATION_TYPES).map(([key, v]) => (
            <div className="list-row" key={key}>
              <span className="code-chip">{v.code}</span>
              <span className="grow">{v.label}</span>
              <Badge tone={eligibility.byType[key] ? 'bad' : 'good'}>{eligibility.byType[key]}</Badge>
            </div>
          ))}
        </Card>

        <Card
          title="Most overdue"
          sub={overdue.count ? `${overdueShown.length} of ${overdue.count} shown` : undefined}
          actions={overdue.count > 0 && onNavigate && (
            <button type="button" className="btn btn-accent btn-sm" onClick={() => onNavigate('faculty', { status: 'Overdue' })}>All {overdue.count}</button>
          )}
        >
          {overdueShown.length === 0 ? <p className="muted">No overdue faculty.</p> : overdueShown.map((f) => (
            <div className="list-row" key={f.professor_id}>
              <span className="grow">
                <span className="list-title">{f.name}</span>
                <span className="list-sub">Last evaluated {f.last_evaluation || 'never'}</span>
              </span>
              <span className="mono text-bad nowrap">{f.overdue_by} sem late</span>
              <Badge tone={f.signedUp ? 'good' : 'warn'}>{f.signedUp ? 'Signed up' : 'Not signed up'}</Badge>
            </div>
          ))}
        </Card>

        <Card
          title="Reported not held"
          sub={missing.count ? `${missingShown.length} of ${missing.count} approved appointments that did not go through` : 'Approved appointments that did not go through'}
          actions={missing.count > 0 && (
            <button type="button" className="btn btn-accent btn-sm" aria-haspopup="dialog" onClick={() => setOpenList('missing')}>Show all {missing.count}</button>
          )}
        >
          {missingShown.length === 0 ? <p className="muted">No missing observations.</p> : missingShown.map((o) => (
            <div className="list-row" key={o.id}>
              <span className="grow">
                <span className="list-title">{o.observeeName}</span> <span className="muted">· {o.observerName}</span>
                <span className="list-sub">{o.reason}</span>
              </span>
              <span className="mono faint nowrap">{o.courseCode}</span>
            </div>
          ))}
        </Card>
      </div>

      {openList === 'pairings' && <PairingsDialog pairings={eligibility.incorrect} onClose={closeList} />}
      {openList === 'missing' && <MissingDialog missing={missing.missing} onClose={closeList} />}
    </div>
  );
}
