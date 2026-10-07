// Evaluation form (Observation Template) admin routes.
//
// TA Q&A: "Assessment Committee members should be able to change
// everything that you mentioned in the template of the Observation
// Form" — criteria, ratings/types, weights, wording — and "Only
// Assessment Committee members can modify [form templates]."
//
// Editing bumps the version number rather than mutating in place, so
// "existing observations retain the older version of the form": any
// observation_records document already created has its own frozen
// formVersion/formTitle/criteria snapshot (see observationRecordService)
// and is untouched by this route.

const express = require('express');
const { query } = require('../config/db');
const { getDb } = require('../config/mongo');

const router = express.Router();

// Duplicated locally rather than centralized, matching the existing
// per-route-file pattern (see routes/assessmentCycles.js) — keeps this
// addition isolated from existing routes.
async function requireAcMember(req, res, next) {
    const acTeacherId = req.header('X-Actor-Id');
    if (!acTeacherId) {
        return res.status(400).json({ error: 'X-Actor-Id header identifying the AC member is required.' });
    }
    const result = await query('SELECT teacher_id, is_ac_member FROM teacher WHERE teacher_id = $1', [acTeacherId]);
    if (result.rowCount === 0 || !result.rows[0].is_ac_member) {
        return res.status(403).json({ error: 'Only Assessment Committee members may perform this action.' });
    }
    req.acTeacherId = acTeacherId;
    next();
}

/**
 * GET /api/admin/evaluation-forms
 * Lists every evaluation form definition (all versions retained).
 */
router.get('/', async (req, res, next) => {
    try {
        const db = getDb();
        const forms = await db.collection('evaluation_forms').find({}).sort({ formId: 1, version: -1 }).toArray();
        res.json(forms);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/evaluation-forms/:formId
 */
router.get('/:formId', async (req, res, next) => {
    try {
        const db = getDb();
        const form = await db.collection('evaluation_forms').findOne({ formId: req.params.formId });
        if (!form) return res.status(404).json({ error: 'Evaluation form not found.' });
        res.json(form);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/admin/evaluation-forms
 * AC-only. Creates a brand-new form definition at version 1.
 * body: { formId, title, fields: [...] }
 */
router.post('/', requireAcMember, async (req, res, next) => {
    try {
        const { formId, title, fields } = req.body || {};
        if (!formId || !title || !Array.isArray(fields) || fields.length === 0) {
            return res.status(400).json({ error: 'formId, title, and a non-empty fields array are required.' });
        }

        const db = getDb();
        const existing = await db.collection('evaluation_forms').findOne({ formId });
        if (existing) {
            return res.status(409).json({ error: `Form "${formId}" already exists — use PUT to create a new version.` });
        }

        const now = new Date();
        const form = { formId, title, version: 1, fields, createdAt: now, updatedAt: now };
        await db.collection('evaluation_forms').insertOne(form);
        res.status(201).json(form);
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/admin/evaluation-forms/:formId
 * AC-only. "Change everything ... criteria, ratings, weights, wording."
 * Bumps the version number; never touches any observation_records
 * already created against an earlier version.
 * body: { title?, fields? }
 */
router.put('/:formId', requireAcMember, async (req, res, next) => {
    try {
        const { title, fields } = req.body || {};
        const db = getDb();
        const existing = await db.collection('evaluation_forms').findOne({ formId: req.params.formId });
        if (!existing) return res.status(404).json({ error: 'Evaluation form not found.' });

        if (fields !== undefined && (!Array.isArray(fields) || fields.length === 0)) {
            return res.status(400).json({ error: 'fields, if provided, must be a non-empty array.' });
        }

        const updated = {
            title: title !== undefined ? title : existing.title,
            fields: fields !== undefined ? fields : existing.fields,
            version: existing.version + 1,
            updatedAt: new Date(),
        };

        await db.collection('evaluation_forms').updateOne({ formId: req.params.formId }, { $set: updated });
        res.json({ ...existing, ...updated });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
