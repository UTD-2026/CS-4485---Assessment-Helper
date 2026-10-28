// The Observation Template. Everyone logged in can read it; only Assessment Committee members can change it.
// Editing never touches observations already started - they keep the version they began with.
const express = require('express');
const { EvaluationForm } = require('../models');
const { requireAc } = require('../middleware/auth');
const { asyncHandler, badRequest, conflict, notFound } = require('../middleware/errors');
const { audit } = require('../services/audit');
const { getObservationForm, OBSERVATION_FORM_ID, validateFields } = require('../services/forms');

const router = express.Router();

/** GET /api/forms -> every form's current definition */
router.get('/', asyncHandler(async (req, res) => {
  await getObservationForm(); // makes sure the default observation template exists
  res.json({ forms: await EvaluationForm.find({}).sort({ form_id: 1 }).lean() });
}));

/** GET /api/forms/:formId  (the observation template is "observation") */
router.get('/:formId', asyncHandler(async (req, res) => {
  const form = req.params.formId === OBSERVATION_FORM_ID ? await getObservationForm() : await EvaluationForm.findOne({ form_id: req.params.formId }).lean();
  if (!form) throw notFound('Form not found.');
  res.json({ form });
}));

/** POST /api/forms (AC)  { formId, title, fields: [...] } -> a brand-new form at version 1 */
router.post('/', requireAc, asyncHandler(async (req, res) => {
  const { formId, title, fields } = req.body || {};
  if (typeof formId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(formId)) throw badRequest('formId must be a short identifier (letters, digits, - or _).');
  if (typeof title !== 'string' || !title.trim()) throw badRequest('title is required.');
  const problem = validateFields(fields);
  if (problem) throw badRequest(problem);
  if (formId === OBSERVATION_FORM_ID) await getObservationForm();
  try {
    const created = await EvaluationForm.create({ form_id: formId, title: title.trim(), version: 1, fields, updated_by: req.user.email });
    await audit(req.user, 'form.created', { type: 'form', id: formId });
    res.status(201).json({ form: created.toObject ? created.toObject() : created });
  } catch (err) {
    if (err && err.code === 11000) throw conflict(`Form "${formId}" already exists - use PUT to publish a new version.`);
    throw err;
  }
}));

/**
 * PUT /api/forms/:formId (AC)  { title?, fields? }
 * "Change everything": criteria, rating scales, weights, wording. Bumps the version number.
 */
router.put('/:formId', requireAc, asyncHandler(async (req, res) => {
  const { title, fields } = req.body || {};
  const existing = req.params.formId === OBSERVATION_FORM_ID ? await getObservationForm() : await EvaluationForm.findOne({ form_id: req.params.formId }).lean();
  if (!existing) throw notFound('Form not found.');
  if (title === undefined && fields === undefined) throw badRequest('Send a title and/or fields to change.');
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) throw badRequest('title must be non-empty text.');
  if (fields !== undefined) {
    const problem = validateFields(fields);
    if (problem) throw badRequest(problem);
  }
  const next = {
    title: title !== undefined ? title.trim() : existing.title,
    fields: fields !== undefined ? fields : existing.fields,
    version: existing.version + 1,
    updated_by: req.user.email,
  };
  // Only succeeds if nobody else published a new version since we read it.
  const updated = await EvaluationForm.findOneAndUpdate({ form_id: existing.form_id, version: existing.version }, { $set: next }, { returnDocument: 'after' }).lean();
  if (!updated) throw conflict('Someone else just published a newer version of this form. Reload and try again.', { code: 'VERSION_CONFLICT' });
  await audit(req.user, 'form.updated', { type: 'form', id: existing.form_id, detail: { version: updated.version } });
  res.json({ form: updated });
}));

module.exports = router;
