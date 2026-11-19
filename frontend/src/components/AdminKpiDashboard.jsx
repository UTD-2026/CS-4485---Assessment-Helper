import React from 'react';
import Icon from './Icon.jsx';
import { TARGET_LIST_SIZE } from '../utils/kpis.js';
import { isSurveyClosed, formatSurveyDeadline } from '../utils/deadlines.js';
import { Badge, Meter } from './ui.jsx';
import { plural } from '../utils/format.js';
import { useKpis, toneFor, pct, metricPageId } from '../utils/metricPages.js';

/**
 * Committee "Live metrics": the 4 KPI groups from the project spec, headline numbers only.
 * Everything behind each number (breakdowns, full lists) is on that metric's own page
 * (see MetricDetails.jsx), opened from the Metrics group in the side rail or a card's "Details" link.
 *
 * Props: global app state (signups, requests, observations, surveySubmissions, deadlines, professors, courses)
 * and onNavigate(tab, filters) so cards can jump to their detail page.
 * surveySubmissions only carries WHO submitted (never answers), so survey anonymity is preserved.
 */

function KpiCard({ id, label, value, tone, meter, sub, formula, onOpen, children }) {
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
      {onOpen && (
        <button type="button" className="btn-link kpi-card-link" onClick={onOpen} aria-label={`${label} details`}>
          Details <Icon name="chevronRight" size={14} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

export default function AdminKpiDashboard({ onNavigate, ...data }) {
  const { deadlines } = data;
  const { eligibility, overdue, participation, utilization, sufficiency, missing, survey } = useKpis(data);
  const open = (code) => (onNavigate ? () => onNavigate(metricPageId(code)) : undefined);

  // The survey KPI is only generated once the survey (feedback) deadline has passed
  const surveyKpiReady = isSurveyClosed(deadlines?.survey, deadlines?.surveyTime);
  const surveyDeadline = deadlines?.survey ? formatSurveyDeadline(deadlines.survey, deadlines.surveyTime) : '';
  const eligibilityTone = eligibility.rate == null ? 'neutral' : eligibility.incorrect.length ? 'bad' : 'good';

  return (
    <div className="stack">
      {/* One row per KPI section (1-4); each row splits its width evenly between that section's metrics. */}
      <section className="kpi-row" style={{ '--cols': 2 }} aria-label="KPI section 1">
        <KpiCard
          id="1a" onOpen={open('1a')} label="Eligibility accuracy" tone={eligibilityTone}
          value={eligibility.rate == null ? '—' : pct(eligibility.rate)} meter={eligibility.rate ?? 0}
          sub={eligibility.total ? `${eligibility.correct} of ${eligibility.total} observer–observee matches follow every eligibility rule` : 'No observer pairings to audit yet'}
          formula="Correct pairings ÷ audited pairings (recommended + confirmed)"
        />
        <KpiCard
          id="1b" onOpen={open('1b')} label="Overdue evaluations" tone={overdue.count === 0 ? 'good' : overdue.notSignedUp ? 'bad' : 'warn'}
          value={overdue.count}
          sub={overdue.count ? `Professors past their evaluation due date · ${overdue.notSignedUp} still haven't signed up` : 'No professor is past their evaluation due date'}
          formula={<>Assistant: due through the next calendar year<br />Associate/Full: same semester two years later</>}
        />
      </section>

      <section className="kpi-row" style={{ '--cols': 2 }} aria-label="KPI section 2">
        <KpiCard
          id="2a" onOpen={open('2a')} label="Participation rate" tone={toneFor(participation.rate)}
          value={pct(participation.rate)} meter={participation.rate}
          sub={`${participation.numerator} of ${participation.denominator} professors due for evaluation have signed up`}
          formula="Signed up this cycle ÷ due this cycle"
        />
        <KpiCard
          id="2b" onOpen={open('2b')} label="Observer utilization" tone={toneFor(utilization.rate)}
          value={pct(utilization.rate)} meter={utilization.rate}
          sub={`${plural(utilization.numerator, 'professor')} serving as observers for ${plural(utilization.denominator, 'professor')} who signed up`}
          formula="Professors who took on the observer role ÷ sign-ups"
        />
      </section>

      <section className="kpi-row" style={{ '--cols': 1 }} aria-label="KPI section 3">
        <KpiCard
          id="3a" onOpen={open('3a')} label="List sufficiency" tone={sufficiency.signups ? toneFor(sufficiency.rateOfTarget) : 'neutral'}
          value={sufficiency.average.toFixed(1)} meter={sufficiency.rateOfTarget}
          sub={`Eligible observers found per sign-up, on average · ${sufficiency.rateOfTarget}% of the goal of ${TARGET_LIST_SIZE}`}
          formula={`Eligible observers per sign-up ÷ ${TARGET_LIST_SIZE}-observer target`}
        >
          <div className="kpi-chips">
            <Badge tone="good">{sufficiency.fullLists} with {TARGET_LIST_SIZE} observers</Badge>
            <Badge tone="warn">{sufficiency.insufficient} with fewer than {TARGET_LIST_SIZE}</Badge>
            <Badge tone="bad">{sufficiency.none} with no eligible observer</Badge>
          </div>
        </KpiCard>
      </section>

      <section className="kpi-row" style={{ '--cols': 2 }} aria-label="KPI section 4">
        <KpiCard
          id="4a" onOpen={open('4a')} label="Missing observations" tone={missing.count ? 'bad' : 'good'}
          value={missing.count}
          sub={missing.count ? `${missing.count} of ${missing.approved} scheduled observations didn't happen or were never confirmed` : 'Every scheduled observation took place'}
          formula="Reported not held, or not confirmed by both people after the observation deadline"
        >
          <div className="kpi-chips">
            <Badge tone="info">{missing.approved} scheduled</Badge>
            <Badge tone="good">{missing.pairConfirmed} confirmed by both</Badge>
            <Badge tone="warn">{missing.awaiting} awaiting confirmation</Badge>
            {missing.deadlinePassed && <Badge>Deadline passed</Badge>}
          </div>
        </KpiCard>
        {surveyKpiReady ? (
          <KpiCard
            id="4b" onOpen={open('4b')} label="Survey completion" tone={survey.denominator ? toneFor(survey.rate) : 'neutral'}
            value={pct(survey.rate)} meter={survey.rate}
            sub={`${survey.numerator} of ${survey.denominator} professors who signed up finished every step, including the survey`}
            formula="Sign-ups that finished every step through the survey ÷ sign-ups"
          />
        ) : (
          <KpiCard
            id="4b" onOpen={open('4b')} label="Survey completion" tone="neutral" value="Locked"
            sub={`Calculated after the survey closes${surveyDeadline ? ` (${surveyDeadline})` : ''}`}
            formula="Sign-ups that finished every step through the survey ÷ sign-ups"
          />
        )}
      </section>

    </div>
  );
}
