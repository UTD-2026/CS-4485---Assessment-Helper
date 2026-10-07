// Step 2: Initializes MongoDB collections used for flexible document
// storage: dynamic evaluation forms, raw UTD Course Book API payloads,
// and survey response submissions.
//
// We attach a $jsonSchema validator to each collection. This keeps the
// obviously-required shape enforced (so bad writes fail loudly) while
// still letting per-document fields (form questions, survey answers)
// vary freely without a SQL migration.
//
// Usage: npm run mongo:init

require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGO_DB || 'assessment_helper_docs';

const COLLECTIONS = [
    {
        name: 'evaluation_forms',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['formId', 'title', 'version', 'fields', 'createdAt'],
                properties: {
                    formId: { bsonType: 'string', description: 'stable ID for this form definition' },
                    title: { bsonType: 'string' },
                    version: { bsonType: 'int', description: 'incremented whenever fields change' },
                    // fields is deliberately unstructured beyond "it's an array" —
                    // question types and options evolve without needing a migration.
                    fields: { bsonType: 'array', minItems: 1 },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date', description: 'set whenever the AC edits this template (bumps version)' },
                },
            },
        },
    },
    {
        // TA Q&A: "Required: In-app view of copy of the Observation Template
        // ... we will let the Observer use a copy of the Observation Template
        // and make notes directly in that copy. Then Both Observer & Observee
        // can sign that copy." / "Once an observation is signed, NOBODY gets
        // to edit it." / "existing observations retain the older version of
        // the form" — so each record snapshots the form's title/version/
        // criteria at creation time rather than referencing the live template.
        name: 'observation_records',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['assignmentId', 'formId', 'formVersion', 'formTitle', 'criteria', 'isLocked', 'createdAt'],
                properties: {
                    assignmentId: { bsonType: 'string', description: 'the observation_assignment this record belongs to' },
                    formId: { bsonType: 'string' },
                    formVersion: { bsonType: 'int', description: 'snapshot of evaluation_forms.version at creation time' },
                    formTitle: { bsonType: 'string', description: 'snapshot of evaluation_forms.title at creation time' },
                    criteria: {
                        bsonType: 'array',
                        minItems: 1,
                        description: 'snapshot of the form fields, with the Observer\'s notes/values filled in',
                        items: {
                            bsonType: 'object',
                            required: ['key', 'label'],
                            properties: {
                                key: { bsonType: 'string' },
                                label: { bsonType: 'string' },
                                type: { bsonType: 'string' },
                                value: {},
                            },
                        },
                    },
                    isLocked: { bsonType: 'bool', description: 'true once either party has signed — nobody may edit after that' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                    lockedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'course_book_raw_payloads',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['fetchedAt', 'semester', 'sourceUrl', 'payload'],
                properties: {
                    fetchedAt: { bsonType: 'date' },
                    semester: { bsonType: 'string' },
                    sourceUrl: { bsonType: 'string' },
                    // payload is the untouched JSON body returned by the UTD Course
                    // Book API, kept verbatim for audit/replay purposes (Step 4).
                    payload: { bsonType: ['object', 'array'] },
                    processed: { bsonType: 'bool' },
                },
            },
        },
    },
    {
        name: 'survey_responses',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                // Schema v3: a survey response has NO stored relation to
                // observation_assignment (no observationAssignmentId) — it's
                // about the respondent's overall experience of the semester's
                // process, not one specific observation record. There's also
                // no "type"/formId field; the fields below are fixed, not a
                // dynamic per-template answer array.
                required: ['respondentTeacherId', 'role', 'term', 'year', 'processOk', 'submittedAt'],
                properties: {
                    respondentTeacherId: { bsonType: 'string' },
                    role: { enum: ['OBSERVEE', 'OBSERVER'], description: 'which role this person played this semester' },
                    term: { enum: ['SPRING', 'SUMMER', 'FALL'] },
                    year: { bsonType: 'int' },
                    processOk: { bsonType: 'bool', description: '"Was this process ok or not"' },
                    // Renamed from a generic "ratings" field: explicit positive
                    // vs. negative feedback rather than one free-text "comments"
                    // box or an ambiguous "ratings" blob.
                    positiveFeedback: { bsonType: 'string', description: 'what went well' },
                    negativeFeedback: { bsonType: 'string', description: 'difficulties experienced' },
                    // Optional numeric scores an Observer may leave against the
                    // observation criteria — renamed from "ratings" to
                    // criteriaScores to say what it actually measures.
                    criteriaScores: {
                        bsonType: 'array',
                        items: {
                            bsonType: 'object',
                            required: ['criterion', 'score'],
                            properties: {
                                criterion: { bsonType: 'string' },
                                score: { bsonType: 'int', minimum: 1, maximum: 5 },
                            },
                        },
                    },
                    // "the system should let me, as an Observee, upload a file
                    // to shed light on any trouble during the observation."
                    uploadedFileRef: { bsonType: 'string', description: 'reference to an uploaded supporting file' },
                    submittedAt: { bsonType: 'date' },
                },
            },
        },
    },
];

async function main() {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    const existing = (await db.listCollections().toArray()).map((c) => c.name);

    for (const { name, validator } of COLLECTIONS) {
        if (existing.includes(name)) {
            console.log(`[mongo:init] "${name}" exists — updating validator`);
            await db.command({ collMod: name, validator, validationLevel: 'moderate' });
        } else {
            console.log(`[mongo:init] creating "${name}"`);
            await db.createCollection(name, { validator, validationLevel: 'moderate' });
        }
    }

    // Helpful indexes for the query patterns we know about up front.
    await db.collection('course_book_raw_payloads').createIndex({ semester: 1, processed: 1 });
    await db.collection('survey_responses').createIndex({ respondentTeacherId: 1, term: 1, year: 1 });
    await db.collection('survey_responses').createIndex({ role: 1, term: 1, year: 1 });
    await db.collection('observation_records').createIndex({ assignmentId: 1 }, { unique: true });

    console.log('[mongo:init] done.');
    await client.close();
}

main().catch((err) => {
    console.error('[mongo:init] failed:', err);
    process.exit(1);
});
