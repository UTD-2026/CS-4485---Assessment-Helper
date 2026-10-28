// The Observation Template (the form an observer fills in) and the rules for what a form may contain.
//
// TA Q&A: the Assessment Committee can change "everything in the template" (criteria, rating scales, weights,
// wording); nobody else can. Editing bumps the version number; observations already started keep the
// version they began with (see services/observationRecords.js).
const { EvaluationForm } = require('../models');

const OBSERVATION_FORM_ID = 'observation';

// The five criteria the team's seed data already uses as `ratings` keys, plus a free-text comments box.
const DEFAULT_OBSERVATION_FORM = {
  title: 'Peer Teaching Observation',
  version: 1,
  fields: [
    { key: 'organization', label: 'Organization', type: 'rating', min: 1, max: 5, weight: 1, required: true },
    { key: 'clarityOfInstruction', label: 'Clarity of instruction', type: 'rating', min: 1, max: 5, weight: 1, required: true },
    { key: 'studentEngagement', label: 'Student engagement', type: 'rating', min: 1, max: 5, weight: 1, required: true },
    { key: 'useOfMaterials', label: 'Use of materials', type: 'rating', min: 1, max: 5, weight: 1, required: true },
    { key: 'classroomEnvironment', label: 'Classroom environment', type: 'rating', min: 1, max: 5, weight: 1, required: true },
    { key: 'comments', label: 'Overall comments', type: 'text', required: false },
  ],
};

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Validate a list of field definitions. Keys become property names in `ratings`, so they must be plain identifiers.
 * @returns {string|null} an error message, or null when fine
 */
function validateFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return 'fields must be a non-empty array.';
  if (fields.length > 60) return 'A form may have at most 60 fields.';
  const seen = new Set();
  for (const [i, f] of fields.entries()) {
    const at = `fields[${i}]`;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return `${at} must be an object.`;
    if (typeof f.key !== 'string' || !KEY_PATTERN.test(f.key)) return `${at}.key must be a plain identifier (letters, digits, underscore; starts with a letter).`;
    if (seen.has(f.key)) return `Duplicate field key "${f.key}".`;
    seen.add(f.key);
    if (typeof f.label !== 'string' || !f.label.trim()) return `${at}.label must be a non-empty string.`;
    if (!['rating', 'text'].includes(f.type)) return `${at}.type must be "rating" or "text".`;
    if (f.required !== undefined && typeof f.required !== 'boolean') return `${at}.required must be true or false.`;
    if (f.weight !== undefined && (typeof f.weight !== 'number' || !(f.weight >= 0))) return `${at}.weight must be a number >= 0.`;
    if (f.type === 'rating') {
      if (!Number.isInteger(f.min) || !Number.isInteger(f.max) || f.min >= f.max) return `${at} (rating) needs integer min < max, e.g. min 1, max 5.`;
    }
  }
  return null;
}

/** The current observation template; creates the default one the first time anyone asks (race-safe). */
async function getObservationForm() {
  const existing = await EvaluationForm.findOne({ form_id: OBSERVATION_FORM_ID }).lean();
  if (existing) return existing;
  try {
    return await EvaluationForm.findOneAndUpdate(
      { form_id: OBSERVATION_FORM_ID },
      { $setOnInsert: { ...DEFAULT_OBSERVATION_FORM, updated_by: 'system' } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
  } catch (err) {
    if (err && err.code === 11000) return EvaluationForm.findOne({ form_id: OBSERVATION_FORM_ID }).lean();
    throw err;
  }
}

module.exports = {
  validateFields,
  getObservationForm,
  OBSERVATION_FORM_ID,
  DEFAULT_OBSERVATION_FORM,
};
