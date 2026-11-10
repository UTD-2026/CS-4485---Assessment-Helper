// Committee metric pages: which pages exist (one per KPI, listed under Metrics in the side rail)
// and the shared helpers the Live metrics page and the detail pages both use.

import { useMemo } from 'react';
import { computeAllKpis } from './kpis.js';

export const METRIC_PAGES = [
  { id: 'metric-1a', code: '1a', label: 'Eligibility', title: 'Eligibility accuracy', subtitle: 'Every audited observer pairing, checked against the eligibility rules' },
  { id: 'metric-1b', code: '1b', label: 'Overdue', title: 'Overdue evaluations', subtitle: 'Faculty past their evaluation due date' },
  { id: 'metric-2a', code: '2a', label: 'Sign-up rate', title: 'Participation rate', subtitle: 'Who was due this cycle, and who signed up' },
  { id: 'metric-2b', code: '2b', label: 'Observers', title: 'Observer utilization', subtitle: 'Professors who took on the observer role, and how the load is spread' },
  { id: 'metric-3a', code: '3a', label: 'List size', title: 'List sufficiency', subtitle: 'How many eligible observers the matching engine found for each sign-up' },
  { id: 'metric-4a', code: '4a', label: 'Missing', title: 'Missing observations', subtitle: 'Approved appointments that did not go through' },
  { id: 'metric-4b', code: '4b', label: 'Survey', title: 'Survey completion', subtitle: 'How far each sign-up got through the whole process' },
];
export const metricPageId = (code) => `metric-${code}`;

export const toneFor = (rate, good = 80, ok = 50) => (rate == null ? 'neutral' : rate >= good ? 'good' : rate >= ok ? 'warn' : 'bad');
export const pct = (n) => `${n}%`;
export const rateOf = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);

export function useKpis({ signups, requests, observations, surveySubmissions, deadlines, professors, courses }) {
  return useMemo(
    () => computeAllKpis({ signups, requests, observations, surveySubmissions, deadlines, professors, courses }),
    [signups, requests, observations, surveySubmissions, deadlines, professors, courses]
  );
}
