// One-time Course Book import job (TA Q&A replacement for Step 4).
//
// "What is the expected method for getting our Coursebook data? Is there
// an API available or would a 1-time import using sample or anonymized
// data be sufficient enough?" / "I do not think there is an API for
// this. 1-time import using sample or anonymized data is good enough
// for MVP."
//
// This reads a local JSON file shaped like the UTD Course Book API's
// course records (same shape courseBookIngestion.normalizeCourseBookRecord
// already expects) and upserts them into course_section directly — no
// network call, no retry/backoff, no Mongo staging. src/jobs/
// syncCourseBook.js (the live-API batch job) is left in place for a
// future semester where a real API does exist, but this is the MVP path.
//
// Usage: node src/jobs/importCourseCatalog.js [path] [semester]
//   path     defaults to src/db/sample-data/course-catalog-sample.json
//   semester a short code like '26F' (year+F) or '26S' (year+S), used
//            only to derive term/year for every record in the file —
//            defaults to '26F'.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { normalizeCourseBookRecord, upsertCourseSection } = require('../services/courseBookIngestion');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', 'db', 'sample-data', 'course-catalog-sample.json');

async function importCatalog(catalogPath = DEFAULT_CATALOG_PATH, semester = '26F') {
    const raw = fs.readFileSync(catalogPath, 'utf8');
    const records = JSON.parse(raw);

    const summary = { semester, catalogPath, recordsProcessed: 0, errors: [] };

    for (const record of records) {
        try {
            const normalized = normalizeCourseBookRecord(record, semester);
            await upsertCourseSection(normalized);
            summary.recordsProcessed += 1;
        } catch (err) {
            summary.errors.push(`record "${record.courseNumber || '?'}" failed: ${err.message}`);
        }
    }

    return summary;
}

if (require.main === module) {
    const [, , argPath, argSemester] = process.argv;
    importCatalog(argPath || undefined, argSemester || undefined)
        .then(async (summary) => {
            console.log('[importCourseCatalog] done:', summary);
            await pool.end();
            process.exit(summary.errors.length ? 1 : 0);
        })
        .catch((err) => {
            console.error('[importCourseCatalog] fatal error:', err);
            process.exit(1);
        });
}

module.exports = { importCatalog };
