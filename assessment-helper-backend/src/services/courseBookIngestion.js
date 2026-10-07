// Step 4: UTD Course Book API Ingestion Engine
//
// Queries the UTD Course Book API for historical teaching data, stores
// the raw JSON payload in MongoDB (staging), then parses and upserts
// normalized rows into the PostgreSQL course_section table.
//
// Design goal: this whole module is a decoupled, asynchronous batch job.
// If the Course Book API is down, slow, or rate-limited, that failure is
// isolated here (logged + retried with backoff) and never blocks the
// core request/response cycle of the rest of the app or a live demo.

const axios = require('axios');
const { query } = require('../config/db');
const { getDb } = require('../config/mongo');

const BASE_URL = process.env.COURSE_BOOK_API_BASE_URL || 'https://coursebook.utdallas.edu/api';
const API_KEY = process.env.COURSE_BOOK_API_KEY || '';
const MAX_RETRIES = Number(process.env.COURSE_BOOK_MAX_RETRIES || 3);
const RETRY_BACKOFF_MS = Number(process.env.COURSE_BOOK_RETRY_BACKOFF_MS || 2000);

const httpClient = axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch historical course/section data for one semester from the UTD
 * Course Book API, retrying transient failures with exponential backoff.
 * Never throws for a single semester failure at the top level of
 * syncSemesters — it logs and lets other semesters continue.
 */
async function fetchSemesterFromCourseBook(semester) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await httpClient.get('/courses', { params: { semester } });
            return response.data;
        } catch (err) {
            lastError = err;
            const backoff = RETRY_BACKOFF_MS * attempt;
            console.warn(
                `[courseBookIngestion] semester=${semester} attempt=${attempt}/${MAX_RETRIES} failed ` +
                `(${err.message}); retrying in ${backoff}ms`
            );
            if (attempt < MAX_RETRIES) await sleep(backoff);
        }
    }
    throw lastError;
}

/**
 * Persist the untouched API response to the Mongo staging collection
 * for audit/replay, independent of whether downstream parsing succeeds.
 */
async function stagePayload(semester, payload) {
    const db = getDb();
    const doc = {
        fetchedAt: new Date(),
        semester,
        sourceUrl: `${BASE_URL}/courses?semester=${semester}`,
        payload,
        processed: false,
    };
    const { insertedId } = await db.collection('course_book_raw_payloads').insertOne(doc);
    return insertedId;
}

/**
 * Derive (term, year) from a short semester code like '26F' or '25S'.
 * Falls back to the current calendar year / SPRING if the code doesn't
 * match the expected two-digit-year + S/F pattern, rather than throwing
 * and aborting an otherwise-good sync.
 */
function parseSemesterCode(semester) {
    const match = /^(\d{2})([SF])$/i.exec((semester || '').trim());
    if (!match) {
        return { term: 'SPRING', year: new Date().getFullYear() };
    }
    const [, yy, termLetter] = match;
    return {
        term: termLetter.toUpperCase() === 'F' ? 'FALL' : 'SPRING',
        year: 2000 + Number(yy),
    };
}

/**
 * Derive a course_level (1000, 2000, ... 6000) from a course number like
 * 'CS 4485' by reading its first digit. Falls back to 1000 for anything
 * that doesn't parse, so a single malformed course number never blocks
 * the rest of the sync.
 */
function deriveCourseLevel(courseNumber) {
    const match = /(\d)\d{3}/.exec(courseNumber || '');
    return match ? Number(match[1]) * 1000 : 1000;
}

/**
 * Derive the department code from a course number's subject prefix
 * (e.g. 'CS 4485' -> 'CS'). Falls back to 'CS' since this deployment is
 * for the UTD CS department's own course catalog.
 */
function deriveDepartment(courseNumber) {
    const match = /^([A-Za-z]+)/.exec((courseNumber || '').trim());
    return match ? match[1].toUpperCase() : 'CS';
}

/**
 * Split an assumed "HH:MM-HH:MM" time range from the Course Book API
 * into separate start/end TIME values for course_section. Defensive:
 * an unparseable value yields nulls rather than throwing, so one bad
 * record doesn't abort the whole sync (upsertCourseSection still
 * requires NOT NULL columns, so such a record will fail its own insert
 * and get logged, but every other record keeps processing).
 */
function splitTimeRange(rangeString) {
    const match = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec((rangeString || '').trim());
    return match ? { start_time: match[1], end_time: match[2] } : { start_time: null, end_time: null };
}

/**
 * Normalize one raw Course Book API record into our course_section shape.
 * Kept intentionally defensive — the upstream API's field names are
 * assumed here and should be adjusted to match the real UTD Course Book
 * response schema once test/API access is confirmed.
 */
function normalizeCourseBookRecord(record, semester) {
    const courseNumber = record.courseNumber || record.course_number;
    const { term, year } = parseSemesterCode(semester);
    const { start_time, end_time } = splitTimeRange(record.time);
    return {
        course_number: courseNumber,
        course_title: record.title || record.course_title || 'Untitled Course',
        section_number: record.section || record.section_number,
        semester,
        term,
        year,
        department: deriveDepartment(courseNumber),
        course_level: deriveCourseLevel(courseNumber),
        instructor_full_name: record.instructor || record.instructor_name || null,
        meeting_days: record.days || null,
        start_time,
        end_time,
        location: record.location || null,
        external_reference: String(record.id || record.courseBookId || `${courseNumber}-${record.section}-${semester}`),
    };
}

/**
 * Best-effort instructor match by full name. Historical Course Book data
 * often predates a teacher's profile creation, so a miss is expected and
 * handled by leaving instructor_id NULL rather than failing the sync.
 */
async function findInstructorIdByName(fullName) {
    if (!fullName) return null;
    const result = await query('SELECT teacher_id FROM teacher WHERE full_name = $1 LIMIT 1', [fullName]);
    return result.rows[0]?.teacher_id || null;
}

/**
 * Upsert one normalized record into course_section. Uses the same unique
 * key as the schema constraint (course_number, section_number, semester)
 * so repeated syncs are idempotent.
 */
async function upsertCourseSection(normalized) {
    const instructorId = await findInstructorIdByName(normalized.instructor_full_name);

    await query(
        `INSERT INTO course_section
            (course_number, course_title, section_number, semester, term, year, department, course_level,
             instructor_id, meeting_days, start_time, end_time, location, source, external_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'COURSE_BOOK_API',$14)
         ON CONFLICT (course_number, section_number, semester)
         DO UPDATE SET
            course_title = EXCLUDED.course_title,
            department = EXCLUDED.department,
            course_level = EXCLUDED.course_level,
            instructor_id = COALESCE(EXCLUDED.instructor_id, course_section.instructor_id),
            meeting_days = EXCLUDED.meeting_days,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            location = EXCLUDED.location,
            external_reference = EXCLUDED.external_reference,
            updated_at = now()`,
        [
            normalized.course_number, normalized.course_title, normalized.section_number, normalized.semester,
            normalized.term, normalized.year, normalized.department, normalized.course_level,
            instructorId, normalized.meeting_days, normalized.start_time, normalized.end_time, normalized.location,
            normalized.external_reference,
        ]
    );
}

/**
 * Full sync for one semester: fetch -> stage raw -> normalize -> upsert.
 * Returns a small summary object for logging/observability.
 */
async function syncSemester(semester) {
    const summary = { semester, fetched: false, staged: false, recordsProcessed: 0, errors: [] };

    let payload;
    try {
        payload = await fetchSemesterFromCourseBook(semester);
        summary.fetched = true;
    } catch (err) {
        summary.errors.push(`fetch failed after ${MAX_RETRIES} attempts: ${err.message}`);
        return summary; // isolate the failure — caller continues to the next semester
    }

    try {
        await stagePayload(semester, payload);
        summary.staged = true;
    } catch (err) {
        summary.errors.push(`staging to Mongo failed: ${err.message}`);
        // continue anyway — we can still try to populate Postgres from memory
    }

    const records = Array.isArray(payload) ? payload : payload.courses || payload.results || [];
    for (const record of records) {
        try {
            const normalized = normalizeCourseBookRecord(record, semester);
            await upsertCourseSection(normalized);
            summary.recordsProcessed += 1;
        } catch (err) {
            summary.errors.push(`record failed: ${err.message}`);
        }
    }

    return summary;
}

/**
 * Entry point for the batch sync job. Semesters are processed
 * sequentially and independently so one bad semester's API downtime
 * never prevents the others from syncing.
 */
async function syncSemesters(semesters) {
    const results = [];
    for (const semester of semesters) {
        console.log(`[courseBookIngestion] syncing semester ${semester}...`);
        const result = await syncSemester(semester);
        results.push(result);
        console.log(`[courseBookIngestion] semester=${semester} summary:`, result);
    }
    return results;
}

module.exports = {
    syncSemesters,
    syncSemester,
    normalizeCourseBookRecord, // exported for unit testing
    upsertCourseSection, // reused by src/jobs/importCourseCatalog.js (TA Q&A: 1-time local import, no live API)
};
