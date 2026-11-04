import React, { useMemo, useState } from 'react';
import { computeAllKpis, VIOLATION_TYPES, TARGET_LIST_SIZE } from '../utils/kpis.js';
import { isSurveyClosed, formatSurveyDeadline } from '../utils/deadlines.js';
import { Badge, Card, Meter } from './ui.jsx';
import { plural } from '../utils/format.js';

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

function KpiCompact({ id, label, value, tone, sub, formula, children }) {
  return (
    <div className="card kpi-compact">
      <div className={`kpi-value kpi-value-sm text-${tone}`}>{value}</div>
      <div className="stack-sm">
        <div><strong>{label}</strong> <span className="faint mono">{id}</span></div>
        <div className="kpi-sub">{sub}</div>
        {children}
        {formula && <div className="formula">{formula}</div>}
      </div>
    </div>
  );
}

export default function AdminKpiDashboard({ signups, requests, observations, surveySubmissions, deadlines, professors, courses, onNavigate }) {
  const k = useMemo(
    () => computeAllKpis({ signups, requests, observations, surveySubmissions, deadlines, professors, courses }),
    [signups, requests, observations, surveySubmissions, deadlines, professors, courses]
  );
  const { eligibility, overdue, participation, utilization, sufficiency, missing, survey } = k;
  const [showIncorrect, setShowIncorrect] = useState(false);

  // The survey KPI is only generated once the survey (feedback) deadline has passed
  const surveyKpiReady = isSurveyClosed(deadlines?.survey, deadlines?.surveyTime);
  const surveyDeadline = deadlines?.survey ? formatSurveyDeadline(deadlines.survey, deadlines.surveyTime) : '';
  // Before the survey closes, the funnel stops at "was observed" so survey progress stays hidden
  const funnel = surveyKpiReady ? survey.funnel : survey.funnel.filter((s) => s.key !== 'surveyed');
  const eligibilityTone = eligibility.rate == null ? 'neutral' : eligibility.incorrect.length ? 'bad' : 'good';
  const overdueShown = overdue.overdue.slice(0, 6);

  return (
    <div className="stack">
      {/* 1-2: the four headline KPIs */}
      <section className="grid grid-230" aria-label="Headline KPIs">
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

      {/* 3-4: compact KPIs */}
      <section className="grid grid-230 section-gap" aria-label="More KPIs">
        <KpiCompact
          id="3a" label="List sufficiency" tone={sufficiency.signups ? toneFor(sufficiency.rateOfTarget) : 'neutral'}
          value={sufficiency.average.toFixed(1)}
          sub={`Avg list size · ${sufficiency.rateOfTarget}% of the ${TARGET_LIST_SIZE}-observer target`}
        >
          <div className="row">
            <Badge tone="good">{sufficiency.fullLists} full</Badge>
            <Badge tone="warn">{sufficiency.insufficient} insufficient</Badge>
            <Badge tone="bad">{sufficiency.none} none eligible</Badge>
          </div>
        </KpiCompact>
        <KpiCompact
          id="4a" label="Missing observations" tone={missing.count ? 'bad' : 'good'}
          value={missing.count}
          sub={`${missing.approved} approved · ${missing.pairConfirmed} pair-confirmed · ${missing.awaiting} awaiting${missing.deadlinePassed ? ' · deadline passed' : ''}`}
        />
        {surveyKpiReady ? (
          <KpiCompact
            id="4b" label="Survey completion" tone={survey.denominator ? toneFor(survey.rate) : 'neutral'}
            value={pct(survey.rate)}
            sub={`${survey.numerator} of ${survey.denominator} sign-ups completed the whole process`}
          />
        ) : (
          <KpiCompact
            id="4b" label="Survey completion" tone="neutral" value="Locked"
            sub={`Calculated after the survey closes${surveyDeadline ? ` (${surveyDeadline})` : ''}`}
          />
        )}
      </section>

      <div className="grid grid-460">
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
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showIncorrect} onClick={() => setShowIncorrect(!showIncorrect)}>
              {showIncorrect ? 'Hide pairings' : 'Show pairings'}
            </button>
          )}
        >
          {Object.entries(VIOLATION_TYPES).map(([key, v]) => (
            <div className="list-row" key={key}>
              <span className="code-chip">{v.code}</span>
              <span className="grow">{v.label}</span>
              <Badge tone={eligibility.byType[key] ? 'bad' : 'good'}>{eligibility.byType[key]}</Badge>
            </div>
          ))}
          {showIncorrect && (
            <div className="inset scroll-list">
              {eligibility.incorrect.map((a, i) => (
                <div className="list-row" key={i}>
                  <span className="grow">
                    <span className="list-title">{a.observerName}</span> <span className="muted">→ {a.observeeName}</span>
                    <span className="list-sub">{a.courseCode} · {a.timing} · {a.source}</span>
                  </span>
                  <span className="mono faint">{a.violations.map((v) => `(${VIOLATION_TYPES[v].code})`).join(' ')}</span>
                </div>
              ))}
            </div>
          )}
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

        <Card title="Reported not held" sub="Approved appointments that did not go through">
          {missing.missing.length === 0 ? <p className="muted">No missing observations.</p> : missing.missing.map((o) => (
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
    </div>
  );
}
