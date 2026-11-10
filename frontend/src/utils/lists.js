// Helpers shared by the filterable committee lists (KpiListDialogs.jsx, MetricDetails.jsx).

// Case-insensitive "any field contains q"; q is already trimmed + lowercased ('' matches everything).
export const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
export const countBy = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
export const optionsOf = (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();

// KPI 4a: why an approved appointment counts as missing
export const MISSING_KINDS = {
  reported: { label: 'Reported not held', tone: 'bad' },
  both: { label: 'Waiting on both', tone: 'warn' },
  observer: { label: 'Waiting on observer', tone: 'warn' },
  observee: { label: 'Waiting on observee', tone: 'warn' },
};
export const kindOf = (o) => (o.status === 'Missed' ? 'reported'
  : !o.observerConfirmed && !o.observeeConfirmed ? 'both'
  : !o.observerConfirmed ? 'observer' : 'observee');
