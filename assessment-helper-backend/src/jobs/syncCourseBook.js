// Standalone entry point for the UTD Course Book ingestion batch job.
// Run manually (node src/jobs/syncCourseBook.js) or wire up to a cron /
// scheduled task runner at COURSE_BOOK_SYNC_INTERVAL_MINUTES. Kept
// separate from server.js on purpose: the API sync must never block or
// crash the live HTTP server.

require('dotenv').config();
const { connectMongo, closeMongo } = require('../config/mongo');
const { syncSemesters } = require('../services/courseBookIngestion');

async function main() {
    const semesters = (process.env.COURSE_BOOK_SYNC_SEMESTERS || '25F,26S')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    await connectMongo();
    try {
        const results = await syncSemesters(semesters);
        const failed = results.filter((r) => r.errors.length > 0);
        if (failed.length) {
            console.warn(`[syncCourseBook] completed with ${failed.length}/${results.length} semester(s) reporting errors.`);
        } else {
            console.log('[syncCourseBook] completed with no errors.');
        }
    } finally {
        await closeMongo();
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error('[syncCourseBook] fatal error:', err);
        process.exit(1);
    });
}

module.exports = { main };
