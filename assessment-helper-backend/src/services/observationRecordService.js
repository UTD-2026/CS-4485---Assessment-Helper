// Observation record service (TA Q&A follow-up).
//
// "I changed the requirement that the Observation is going to live in the
// webapp ... we will let the Observer use a copy of the Observation
// Template and make notes directly in that copy. Then Both Observer &
// Observee can sign that copy." There is no file upload anywhere in this
// flow — the record IS the in-app copy.
//
// A record snapshots the evaluation form's title/version/criteria at the
// moment it's created, so a later AC edit to the live template ("existing
// observations retain the older version of the form") never changes a
// record that's already in progress or signed.
//
// "Once an observation is signed, NOBODY gets to edit it." — enforced here
// by the isLocked flag; routes/observations.js sets it via lockRecord()
// the moment either signature lands.

const { getDb } = require('../config/mongo');

class RecordLockedError extends Error {
    constructor(assignmentId) {
        super(`Observation record for assignment ${assignmentId} is locked and can no longer be edited.`);
        this.name = 'RecordLockedError';
        this.statusCode = 409;
    }
}

/**
 * Creates the in-app observation record for an assignment, snapshotting
 * the given evaluation form's current title/version/fields as the
 * record's criteria. Optionally seeds initial values (e.g. if the
 * Observer already has notes ready).
 */
async function createRecord(assignmentId, formId, criteriaValues = {}) {
    const db = getDb();
    const form = await db.collection('evaluation_forms').findOne({ formId });
    if (!form) {
        const err = new Error(`Evaluation form "${formId}" not found.`);
        err.statusCode = 404;
        throw err;
    }

    const existing = await db.collection('observation_records').findOne({ assignmentId });
    if (existing) {
        const err = new Error(`An observation record already exists for assignment ${assignmentId}.`);
        err.statusCode = 409;
        throw err;
    }

    const criteria = (form.fields || []).map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        value: criteriaValues[field.key] !== undefined ? criteriaValues[field.key] : null,
    }));

    const now = new Date();
    const record = {
        assignmentId,
        formId,
        formVersion: form.version,
        formTitle: form.title,
        criteria,
        isLocked: false,
        createdAt: now,
        updatedAt: now,
    };

    await db.collection('observation_records').insertOne(record);
    return record;
}

/**
 * Updates the Observer's notes/values on an unsigned record. Rejects once
 * the record is locked — per the TA Q&A, nobody edits a signed record.
 */
async function updateRecord(assignmentId, criteriaValues) {
    const db = getDb();
    const existing = await db.collection('observation_records').findOne({ assignmentId });
    if (!existing) {
        const err = new Error(`No observation record found for assignment ${assignmentId}.`);
        err.statusCode = 404;
        throw err;
    }
    if (existing.isLocked) {
        throw new RecordLockedError(assignmentId);
    }

    const updatedCriteria = existing.criteria.map((c) =>
        criteriaValues[c.key] !== undefined ? { ...c, value: criteriaValues[c.key] } : c
    );

    await db.collection('observation_records').updateOne(
        { assignmentId },
        { $set: { criteria: updatedCriteria, updatedAt: new Date() } }
    );

    return getRecord(assignmentId);
}

/**
 * Locks a record so it can never be edited again. Idempotent: locking an
 * already-locked record is a no-op rather than an error, since both the
 * Observer's and Observee's signatures route through here.
 */
async function lockRecord(assignmentId) {
    const db = getDb();
    await db.collection('observation_records').updateOne(
        { assignmentId, isLocked: false },
        { $set: { isLocked: true, lockedAt: new Date(), updatedAt: new Date() } }
    );
    return getRecord(assignmentId);
}

async function getRecord(assignmentId) {
    const db = getDb();
    return db.collection('observation_records').findOne({ assignmentId });
}

module.exports = {
    RecordLockedError,
    createRecord,
    updateRecord,
    lockRecord,
    getRecord,
};
