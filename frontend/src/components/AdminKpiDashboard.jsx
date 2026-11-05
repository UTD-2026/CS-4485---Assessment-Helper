import React, { useMemo } from 'react';
import { computeAllKpis, VIOLATION_TYPES, TARGET_LIST_SIZE } from '../utils/kpis.js';
import { isPastDeadline } from '../utils/deadlines.js';

/**
 * Committee KPI dashboard: implements the 4 KPI groups from the project spec.
 *
 * Props: global app state (signups, requests, observations, surveySubmissions, deadlines).
 * surveySubmissions only carries WHO submitted (never answers), so survey anonymity is preserved.
 */

const toneFor = (rate, good = 80, ok = 50) => (rate == null ? 'neutral' : rate >= good ? 'good' : rate >= ok ? 'warn' : 'bad');

function RateBar({ rate, tone }) {
  return (
    <div className="kpi-bar" aria-hidden="true">
      <div className={`kpi-bar-fill tone-${tone}`} style={{ width: `${Math.min(rate ?? 0, 100)}%` }} />
    </div>
  );
}

function Metric({ id, title, value, formula, detail, tone = 'neutral', rate, children }) {
  return (
    <div className={`kpi-metric tone-border-${tone}`}>
      <div className="kpi-metric-head">
        <span className="kpi-id">{id}</span>
        <h4>{title}</h4>
      </div>
      <div className={`kpi-value tone-text-${tone}`}>{value}</div>
      {rate !== undefined && <RateBar rate={rate} tone={tone} />}
      {detail && <p className="kpi-detail">{detail}</p>}
      <p className="kpi-formula">{formula}</p>
      {children}
    </div>
  );
}

function KpiGroup({ number, title, children }) {
  return (
    <section className="kpi-group">
      <h3 className="kpi-group-title"><span>{number}</span>{title}</h3>
      <div className="kpi-group-grid">{children}</div>
    </section>
  );
}

const Empty = ({ children }) => <p className="kpi-empty">{children}</p>;

export default function AdminKpiDashboard({ signups, requests, observations, surveySubmissions, deadlines }) {
  const k = useMemo(
    () => computeAllKpis({ signups, requests, observations, surveySubmissions, deadlines }),
    [signups, requests, observations, surveySubmissions, deadlines]
  );
  const { eligibility, overdue, participation, utilization, sufficiency, missing, survey } = k;
  // The Survey KPI is only generated/shown once the survey (feedback) deadline has passed
  const surveyKpiReady = isPastDeadline(deadlines?.survey);

  return (
    <div className="kpi-dashboard">
      {/* ---------- 1. FACULTY EVALUATION ---------- */}
      <KpiGroup number="1" title="Faculty Evaluation KPI">
        <Metric
          id="1a"
          title="Evaluation Eligibility Accuracy"
          value={eligibility.rate == null ? '—' : `${eligibility.rate}%`}
          rate={eligibility.rate ?? 0}
          tone={eligibility.rate == null ? 'neutral' : eligibility.incorrect.length ? 'bad' : 'good'}
          detail={eligibility.total
            ? `${eligibility.correct} of ${eligibility.total} observer pairings pass every rule · ${eligibility.incorrect.length} incorrect occurrence(s)`
            : 'No observer pairings to audit yet.'}
          formula="Correct pairings ÷ all audited pairings (recommended + confirmed observers)"
        >
          <table className="kpi-mini-table">
            <thead><tr><th>Incorrect occurrence</th><th>Count</th></tr></thead>
            <tbody>
              {Object.entries(VIOLATION_TYPES).map(([key, v]) => (
                <tr key={key}>
                  <td>({v.code}) {v.label}</td>
                  <td><span className={`badge ${eligibility.byType[key] ? 'badge-error' : 'badge-success'}`}>{eligibility.byType[key]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {eligibility.incorrect.length > 0 && (
            <ul className="kpi-list">
              {eligibility.incorrect.map((a, i) => (
                <li key={i}>
                  <strong>{a.observerName}</strong> → {a.observeeName} ({a.courseCode}, {a.timing}) · {a.source}:{' '}
                  {a.violations.map(v => `(${VIOLATION_TYPES[v].code})`).join(' ')}
                </li>
              ))}
            </ul>
          )}
        </Metric>

        <Metric
          id="1b"
          title="Overdue Evaluation Count"
          value={overdue.count}
          tone={overdue.count === 0 ? 'good' : overdue.notSignedUp ? 'bad' : 'warn'}
          detail={`${overdue.count} overdue · ${overdue.notSignedUp} of them not signed up yet`}
          formula="Evaluation Cycle: Assistant every 2 semesters, Associate/Full every 4. Overdue = past the semester it was due."
        >
          {overdue.overdue.length === 0 ? <Empty>No overdue faculty.</Empty> : (
            <table className="kpi-mini-table">
              <thead><tr><th>Professor</th><th>Last eval</th><th>Overdue</th><th>Signed up</th></tr></thead>
              <tbody>
                {overdue.overdue.map(f => (
                  <tr key={f.professor_id}>
                    <td>{f.name} <small>({f.hire_level})</small></td>
                    <td>{f.last_evaluation || 'Never'}</td>
                    <td><span className="badge badge-error">{f.overdue_by} sem</span></td>
                    <td>{f.signedUp ? <span className="badge badge-success">Yes</span> : <span className="badge badge-warning">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Metric>
      </KpiGroup>

      {/* ---------- 2. ASSESSMENT PARTICIPATION ---------- */}
      <KpiGroup number="2" title="Assessment Participation KPI">
        <Metric
          id="2a"
          title="Assessment Participation Rate"
          value={`${participation.rate}%`}
          rate={participation.rate}
          tone={toneFor(participation.rate)}
          detail={`${participation.numerator} signed up of ${participation.denominator} due`}
          formula="# of Profs who signed up this cycle ÷ # of Profs who were due"
        />
        <Metric
          id="2b"
          title="Observer Utilization Rate"
          value={`${utilization.rate}%`}
          rate={utilization.rate}
          tone={toneFor(utilization.rate)}
          detail={`${utilization.numerator} observer(s) for ${utilization.denominator} sign-up(s)${utilization.observers.length ? ': ' + utilization.observers.map(o => o.name).join(', ') : ''}`}
          formula="# of Profs who took on the Observer role ÷ # of Profs who signed up"
        />
      </KpiGroup>

      {/* ---------- 3. RECOMMENDATION ENGINE ---------- */}
      <KpiGroup number="3" title="Recommendation Engine KPI">
        <Metric
          id="3a"
          title="List Sufficiency Rate"
          value={<>{sufficiency.average.toFixed(1)}<small className="kpi-unit"> avg observers / sign-up</small></>}
          rate={sufficiency.rateOfTarget}
          tone={sufficiency.signups ? toneFor(sufficiency.rateOfTarget) : 'neutral'}
          detail={`${sufficiency.totalMatches} total matches across ${sufficiency.signups} sign-up(s) · ${sufficiency.rateOfTarget}% of the ${TARGET_LIST_SIZE}-observer target`}
          formula="Total # of observer matches ÷ # of sign-ups (average list size)"
        >
          <div className="kpi-chips">
            <span className="badge badge-success">{sufficiency.fullLists} full list</span>
            <span className="badge badge-warning">{sufficiency.insufficient} insufficient</span>
            <span className="badge badge-error">{sufficiency.none} no eligible observer</span>
          </div>
        </Metric>
      </KpiGroup>

      {/* ---------- 4. SURVEY & OBSERVATION COMPLETION ---------- */}
            <KpiGroup number="4" title="Survey & Observation Completion KPI">
        <Metric
          id="4a"
          title="Missing Observation Count"
          value={missing.count}
          tone={missing.count ? 'bad' : 'good'}
          detail={`${missing.approved} approved · ${missing.pairConfirmed} pair-confirmed · ${missing.awaiting} awaiting confirmation${missing.deadlinePassed ? ' · observation deadline has passed' : ''}`}
          formula="Approved appointments that did not go through: reported as not held, or not pair-confirmed (observer + observee) by the observation deadline"
        >
          {missing.missing.length > 0 && (
            <ul className="kpi-list">
              {missing.missing.map(o => (
                <li key={o.id}><strong>{o.observeeName}</strong> ← {o.observerName} ({o.courseCode}): {o.reason}</li>
              ))}
            </ul>
          )}
        </Metric>

        {!surveyKpiReady ? (
          <Metric
            id="4b"
            title="Survey Completion Rate"
            value="🔒"
            tone="neutral"
            detail={`Locked until the survey deadline${deadlines?.survey ? ` (${deadlines.survey})` : ''} passes. This KPI is generated once the survey window closes.`}
            formula="# of submitted surveys (full process) ÷ # of sign-ups"
          />
        ) : (
          <Metric
            id="4b"
            title="Survey Completion Rate"
            value={`${survey.rate}%`}
            rate={survey.rate}
            tone={survey.denominator ? toneFor(survey.rate) : 'neutral'}
            detail={`${survey.numerator} of ${survey.denominator} sign-up(s) completed the entire process`}
            formula="# of submitted surveys (full process) ÷ # of sign-ups. Process = Sign up AND sent request(s) AND 1 request confirmed AND was observed AND took the final survey"
          >
            <div className="kpi-funnel">
              {survey.funnel.map(step => (
                <div className="kpi-funnel-row" key={step.key}>
                  <span className="kpi-funnel-label">{step.label}</span>
                  <div className="kpi-funnel-track">
                    <div className="kpi-funnel-fill" style={{ width: `${survey.denominator ? (step.count / survey.denominator) * 100 : 0}%` }} />
                  </div>
                  <span className="kpi-funnel-count">{step.count}</span>
                </div>
              ))}
            </div>
          </Metric>
        )}
      </KpiGroup>
    </div>
  );
}
