// The in-app observation record (TA Q&A): "the Observation is going to live in the webapp ... the Observer uses
// a copy of the Observation Template and makes notes directly in that copy. Then both Observer & Observee can
// sign that copy." There is no file upload anywhere in this flow.
//
// A record SNAPSHOTS the whole template (every field, with its range / weight / required flag) when it is created,
// so a later AC edit never changes a record already in progress or signed ("existing observations retain the older
// version of the form"). The first signature LOCKS the record: nobody edits it afterwards.
//
// These are pure helpers; the database work lives in services/workflow.js.

const snapshotCriteria = (form) => (form.fields || []).map((field) => ({ ...field, value: null }));

/** Check submitted values against the snapshot. Unknown keys, out-of-range ratings and non-text text are errors. */
function validateValues(criteria, values) {
  const errors = [];
  const clean = {};
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return { errors: ['values must be an object like { "organization": 4, "comments": "..." }.'], clean };
  }
  const byKey = new Map(criteria.map((c) => [c.key, c]));
  for (const [k, v] of Object.entries(values)) {
    const field = byKey.get(k);
    if (!field) { errors.push(`"${k}" is not a field on this form.`); continue; }
    if (v === null) { clean[k] = null; continue; }
    if (field.type === 'rating') {
      if (!Number.isInteger(v) || v < field.min || v > field.max) errors.push(`"${k}" must be a whole number from ${field.min} to ${field.max}.`);
      else clean[k] = v;
    } else if (typeof v !== 'string') {
      errors.push(`"${k}" must be text.`);
    } else if (v.length > 5000) {
      errors.push(`"${k}" is longer than 5000 characters.`);
    } else {
      clean[k] = v;
    }
  }
  return { errors, clean };
}

const applyValues = (criteria, clean) =>
  criteria.map((c) => (Object.prototype.hasOwnProperty.call(clean, c.key) ? { ...c, value: clean[c.key] } : c));

const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const missingRequired = (criteria) => criteria.filter((c) => c.required && isEmpty(c.value)).map((c) => c.key);

/** {criterionKey: number} for every rating that has a value - the shape the team's `ratings` field uses. */
function ratingsFromCriteria(criteria) {
  const out = {};
  for (const c of criteria) if (c.type === 'rating' && typeof c.value === 'number') out[c.key] = c.value;
  return out;
}

/** Weighted score as a share of the maximum possible (0..1), using each field's own min/max. */
function summarize(criteria) {
  let weighted = 0;
  let totalWeight = 0;
  let rated = 0;
  for (const c of criteria) {
    if (c.type !== 'rating' || typeof c.value !== 'number') continue;
    const w = typeof c.weight === 'number' ? c.weight : 1;
    weighted += w * ((c.value - c.min) / (c.max - c.min));
    totalWeight += w;
    rated += 1;
  }
  return { ratedCount: rated, ratingFieldCount: criteria.filter((c) => c.type === 'rating').length, weightedPercent: totalWeight ? Number((weighted / totalWeight).toFixed(4)) : null };
}

module.exports = {
  validateValues,
  ratingsFromCriteria,
  summarize,
  snapshotCriteria,
  applyValues,
  isEmpty,
  missingRequired,
};
