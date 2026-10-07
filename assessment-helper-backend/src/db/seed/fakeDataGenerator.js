// Step 3 (revised, schema v3): Fake Data Generator & Privacy Script.
//
// Generates realistic-but-synthetic professor names, emails, and course
// assignment histories using @faker-js/faker, seeds PostgreSQL and
// MongoDB, and then drives the actual application services
// (evaluationCycleService / matchingService) through SEVERAL semesters
// in sequence — Spring 2025 through Fall 2026 — so that by the time the
// "current" Fall 2026 cycle is evaluated, most teachers have a REAL
// seeded evaluation history to compute their due date from, instead of
// the hire-date approximation fallback covering everyone.
//
// No real professor names, emails, or course histories are ever used.
//
// Usage: npm run db:seed

require('dotenv').config();
const { faker } = require('@faker-js/faker');
const { MongoClient } = require('mongodb');
const { pool, query, getClient } = require('../../config/db');
const { ensureEvaluationCyclesForAssessmentCycle } = require('../../services/evaluationCycleService');
const { generateAndPersistCandidates } = require('../../services/matchingService');
const { recordTransition } = require('../../middleware/auditLog');

const SEED = Number(process.env.SEED_RANDOM_SEED || 42);
faker.seed(SEED); // deterministic runs — reproducible demos/tests

const TEACHER_COUNT = Number(process.env.SEED_TEACHER_COUNT || 24);

const HIRING_LEVELS = [
    'ADJUNCT', 'LECTURER', 'SENIOR_LECTURER',
    'ASSISTANT_PROFESSOR', 'ASSOCIATE_PROFESSOR', 'PROFESSOR',
];

// Cadence is a plain number of years now, not a named frequency — see
// src/services/dueStatusCalculator.js for why "annual"/"biennial" don't
// generalize once a Summer term exists. due_window_terms=3 means "any
// term of the anniversary year"; =1 means "the exact anniversary term".
const RULE_CONFIG = {
    ADJUNCT:             { yearsBetweenEvaluations: 1, dueWindowTerms: 3 },
    LECTURER:            { yearsBetweenEvaluations: 1, dueWindowTerms: 3 },
    SENIOR_LECTURER:     { yearsBetweenEvaluations: 1, dueWindowTerms: 3 },
    ASSISTANT_PROFESSOR: { yearsBetweenEvaluations: 1, dueWindowTerms: 3 },
    ASSOCIATE_PROFESSOR: { yearsBetweenEvaluations: 2, dueWindowTerms: 1 },
    PROFESSOR:           { yearsBetweenEvaluations: 2, dueWindowTerms: 1 },
};

// Weighted so CS dominates (this is the UTD CS dept's own tool) but
// MATH/EE/PHYS give the department-eligibility rule real variety to
// filter against. Must match department.department_code rows seeded by
// schema.sql.
const DEPARTMENTS = ['CS', 'CS', 'CS', 'CS', 'CS', 'CS', 'MATH', 'MATH', 'EE', 'PHYS'];

const COURSES_BY_DEPT_LEVEL = {
    CS:   { 1000: ['CS 1336', 'CS 1337'], 2000: ['CS 2305', 'CS 2336'], 3000: ['CS 3345', 'CS 3377'], 4000: ['CS 4337', 'CS 4348', 'CS 4485'], 6000: ['CS 6314', 'CS 6320', 'CS 6375'] },
    MATH: { 1000: ['MATH 1326'], 2000: ['MATH 2418'], 3000: ['MATH 3310'], 4000: ['MATH 4334'], 6000: ['MATH 6321'] },
    EE:   { 1000: ['EE 1101'], 2000: ['EE 2310'], 3000: ['EE 3301'], 4000: ['EE 4301'], 6000: ['EE 6301'] },
    PHYS: { 1000: ['PHYS 1301'], 2000: ['PHYS 2325'], 3000: ['PHYS 3411'], 4000: ['PHYS 4301'], 6000: ['PHYS 6301'] },
};
const COURSE_LEVELS = [1000, 2000, 3000, 4000, 6000];
const DAY_PATTERNS = ['MW', 'TuTh', 'MWF'];
const START_TIMES = ['08:00', '09:00', '10:00', '11:30', '13:00', '14:00', '16:00'];
const SECTION_DURATION_MINUTES = { MW: 75, TuTh: 75, MWF: 50 };

// The full semester sequence this seed script walks through, oldest
// first. Summer appears once (2025) since not every teacher has a
// summer course load — see buildCourseSectionsForTerm(). The LAST entry
// is the "current", still-open cycle the live demo revolves around.
const SEMESTER_SEQUENCE = [
    { term: 'SPRING', year: 2025 },
    { term: 'SUMMER', year: 2025 },
    { term: 'FALL',   year: 2025 },
    { term: 'SPRING', year: 2026 },
    { term: 'FALL',   year: 2026 }, // current / open cycle
];

function addMinutes(hhmm, minutes) {
    const [h, m] = hhmm.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const endH = Math.floor(total / 60) % 24;
    const endM = total % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

function semesterCode(term, year) {
    return `${String(year).slice(2)}${term[0]}`; // e.g. '26F', '25U' for summer — kept distinct from Spring's '25S'
}

function coursesFor(department, level) {
    const table = COURSES_BY_DEPT_LEVEL[department] || COURSES_BY_DEPT_LEVEL.CS;
    return table[level] || table[4000];
}

function buildFakeTeachers(count) {
    const teachers = [];
    const usedEmails = new Set();

    for (let i = 0; i < count; i++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        let email = faker.internet.email({ firstName, lastName, provider: 'example-university.edu' }).toLowerCase();
        while (usedEmails.has(email)) {
            email = `${firstName}.${lastName}.${faker.string.alphanumeric(4)}@example-university.edu`.toLowerCase();
        }
        usedEmails.add(email);

        teachers.push({
            teacher_id: faker.string.uuid(),
            full_name: `${firstName} ${lastName}`,
            email,
            hiring_level: faker.helpers.arrayElement(HIRING_LEVELS),
            department: faker.helpers.arrayElement(DEPARTMENTS),
            is_ac_member: false, // assigned after generation, see below
            hire_date: faker.date.past({ years: 12, refDate: '2025-01-01' }).toISOString().slice(0, 10),
            is_active: faker.datatype.boolean({ probability: 0.94 }),
            // Each teacher keeps a stable "preferred level" so their course
            // history is coherent across semesters (a real professor mostly
            // teaches around the same level year to year) rather than
            // jumping randomly every term.
            preferredLevel: faker.helpers.arrayElement(COURSE_LEVELS),
        });
    }

    const acCandidates = teachers.filter(
        (t) => t.is_active && t.department === 'CS' && ['ASSOCIATE_PROFESSOR', 'PROFESSOR'].includes(t.hiring_level)
    );
    for (const t of faker.helpers.arrayElements(acCandidates, Math.min(3, acCandidates.length))) {
        t.is_ac_member = true;
    }

    return teachers;
}

/**
 * One course section per active teacher for a given term/year, at a
 * level near their stable "preferred level" (small chance of teaching a
 * level up or down, for realism). Summer only gets a subset of teachers
 * — a smaller, lighter course catalog, like a real summer session.
 */
function buildCourseSectionsForTerm(teachers, term, year) {
    const participants = term === 'SUMMER'
        ? faker.helpers.arrayElements(teachers.filter((t) => t.is_active), Math.round(teachers.length * 0.35))
        : teachers.filter((t) => t.is_active);

    const sections = [];
    const seenOfferings = new Set();

    for (const t of participants) {
        const levelDrift = faker.helpers.arrayElement([-1000, 0, 0, 0, 1000]);
        const level = COURSE_LEVELS.includes(t.preferredLevel + levelDrift) ? t.preferredLevel + levelDrift : t.preferredLevel;
        const courseNumber = faker.helpers.arrayElement(coursesFor(t.department, level));
        const sectionNumber = faker.helpers.arrayElement(['001', '002', '501']);
        const key = `${courseNumber}|${sectionNumber}|${term}|${year}`;
        if (seenOfferings.has(key)) continue; // extremely rare with this pool size, but keep the unique constraint happy
        seenOfferings.add(key);

        const days = faker.helpers.arrayElement(DAY_PATTERNS);
        const startTime = faker.helpers.arrayElement(START_TIMES);

        sections.push({
            section_id: faker.string.uuid(),
            course_number: courseNumber,
            course_title: `${courseNumber.split(' ')[1]} — ${faker.company.catchPhraseDescriptor()} Topics`,
            section_number: sectionNumber,
            semester: semesterCode(term, year),
            term,
            year,
            department: t.department,
            course_level: level,
            instructor_id: t.teacher_id,
            meeting_days: days,
            start_time: startTime,
            end_time: addMinutes(startTime, SECTION_DURATION_MINUTES[days]),
            location: `ECSS ${faker.number.int({ min: 2, max: 4 })}.${faker.number.int({ min: 100, max: 999 })}`,
            source: 'SEED',
            external_reference: null,
        });
    }
    return sections;
}

function buildSchedulingRules() {
    return HIRING_LEVELS.map((level) => ({
        rule_id: faker.string.uuid(),
        hiring_level: level,
        years_between_evaluations: RULE_CONFIG[level].yearsBetweenEvaluations,
        due_window_terms: RULE_CONFIG[level].dueWindowTerms,
        required_observations_per_cycle: 1,
        description: `Evaluate every ${RULE_CONFIG[level].yearsBetweenEvaluations} year(s) for ${level.replaceAll('_', ' ').toLowerCase()} faculty ` +
            `(${RULE_CONFIG[level].dueWindowTerms}-term due window).`,
    }));
}

async function seedCoreData({ teachers, sections, rules }) {
    const client = await getClient();
    try {
        await client.query('BEGIN');

        for (const t of teachers) {
            await client.query(
                `INSERT INTO teacher (teacher_id, full_name, email, hiring_level, department, is_ac_member, hire_date, is_active)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (teacher_id) DO NOTHING`,
                [t.teacher_id, t.full_name, t.email, t.hiring_level, t.department, t.is_ac_member, t.hire_date, t.is_active]
            );
        }

        for (const r of rules) {
            // hiring_level + is_active(=TRUE default) is the real natural
            // key (scheduling_rule_unique_active_level) — upsert on that so
            // re-running the seed updates the existing rule per level
            // instead of colliding with a freshly random rule_id.
            await client.query(
                `INSERT INTO scheduling_rule (rule_id, hiring_level, years_between_evaluations, due_window_terms, required_observations_per_cycle, description)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (hiring_level, is_active) DO UPDATE SET
                    years_between_evaluations = EXCLUDED.years_between_evaluations,
                    due_window_terms = EXCLUDED.due_window_terms,
                    required_observations_per_cycle = EXCLUDED.required_observations_per_cycle,
                    description = EXCLUDED.description`,
                [r.rule_id, r.hiring_level, r.years_between_evaluations, r.due_window_terms, r.required_observations_per_cycle, r.description]
            );
        }

        for (const s of sections) {
            await client.query(
                `INSERT INTO course_section
                    (section_id, course_number, course_title, section_number, semester, term, year,
                     department, course_level, instructor_id, meeting_days, start_time, end_time, location, source, external_reference)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                 ON CONFLICT (section_id) DO NOTHING`,
                [s.section_id, s.course_number, s.course_title, s.section_number, s.semester, s.term, s.year,
                    s.department, s.course_level, s.instructor_id, s.meeting_days, s.start_time, s.end_time, s.location, s.source, s.external_reference]
            );
        }

        await client.query('COMMIT');
        console.log(`[seed:postgres] inserted ${teachers.length} teachers, ${rules.length} scheduling rules, ${sections.length} course sections.`);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function seedAssessmentCycle({ term, year }, acMember, isCurrent) {
    // Deadlines are just illustrative offsets within the semester.
    const deadlines = isCurrent
        ? [`${year}-09-15`, `${year}-11-01`, `${year}-11-20`]
        : [`${year}-01-15`, `${year}-03-01`, `${year}-03-20`];
    const status = isCurrent ? 'OPEN_FOR_SIGNUP' : 'CLOSED';

    const result = await query(
        `INSERT INTO assessment_cycle (term, year, signup_deadline, observation_period_deadline, survey_deadline, kicked_off_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (term, year) DO UPDATE SET status = EXCLUDED.status
         RETURNING *`,
        [term, year, ...deadlines, acMember ? acMember.teacher_id : null, status]
    );
    return result.rows[0];
}

/**
 * Runs one semester end-to-end through the real services: compute
 * due/overdue for everyone, sign up a portion of due/overdue teachers
 * with their course section that term, run the matching engine, and
 * simulate the request -> confirm -> select -> complete pipeline.
 *
 * @param {boolean} pushToCompletion - historical cycles are pushed much
 *   further toward COMPLETED than the current cycle, so later semesters
 *   have real baselines to compute against; the current cycle is left
 *   in a realistic, partially-worked-through state for the live demo.
 */
async function simulateSemester(assessmentCycle, sectionsByInstructorThisTerm, pushToCompletion) {
    const evalCycles = await ensureEvaluationCyclesForAssessmentCycle(assessmentCycle.assessment_cycle_id);
    const dueTeacherIds = evalCycles.filter((c) => c.status === 'DUE' || c.status === 'OVERDUE').map((c) => c.teacher_id);

    const signupRate = pushToCompletion ? 0.9 : 0.7;
    const signingUp = faker.helpers.arrayElements(dueTeacherIds, Math.round(dueTeacherIds.length * signupRate));

    const signupIds = [];
    for (const teacherId of signingUp) {
        const section = sectionsByInstructorThisTerm.get(teacherId);
        if (!section) continue;
        try {
            const result = await query(
                `INSERT INTO signup (assessment_cycle_id, observee_teacher_id, course_section_id)
                 VALUES ($1,$2,$3) RETURNING signup_id`,
                [assessmentCycle.assessment_cycle_id, teacherId, section.section_id]
            );
            signupIds.push(result.rows[0].signup_id);
        } catch (err) {
            if (err.code !== '23505') throw err;
        }
    }

    let completedCount = 0;
    for (const signupId of signupIds) {
        const outcome = await generateAndPersistCandidates(signupId);
        if (!outcome.isSufficient) continue;

        const candidatesResult = await query('SELECT candidate_teacher_id FROM observer_candidate WHERE signup_id = $1 ORDER BY rank', [signupId]);
        const candidateIds = candidatesResult.rows.map((r) => r.candidate_teacher_id);
        const requestedIds = faker.helpers.arrayElements(candidateIds, Math.min(candidateIds.length, faker.number.int({ min: 1, max: 3 })));

        const signupResult = await query(
            `SELECT s.observee_teacher_id, s.course_section_id, cs.meeting_days, cs.start_time, cs.end_time
             FROM signup s JOIN course_section cs ON cs.section_id = s.course_section_id WHERE s.signup_id = $1`,
            [signupId]
        );
        const signup = signupResult.rows[0];

        const confirmProbability = pushToCompletion ? 0.85 : 0.55;
        const requestRows = [];
        for (const observerId of requestedIds) {
            const status = faker.datatype.boolean({ probability: confirmProbability }) ? 'OBSERVER_CONFIRMED' : faker.helpers.arrayElement(['PENDING', 'OBSERVER_DECLINED']);
            try {
                const result = await query(
                    `INSERT INTO observation_request (signup_id, observer_teacher_id, requested_days, requested_start_time, requested_end_time, status, responded_at)
                     VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6 = 'PENDING' THEN NULL ELSE now() END)
                     RETURNING request_id, status, observer_teacher_id`,
                    [signupId, observerId, signup.meeting_days, signup.start_time, signup.end_time, status]
                );
                requestRows.push(result.rows[0]);
            } catch (err) {
                if (err.code !== '23505') throw err;
            }
        }
        await query(`UPDATE signup SET status = 'REQUESTS_SENT' WHERE signup_id = $1`, [signupId]);

        const confirmed = requestRows.find((r) => r.status === 'OBSERVER_CONFIRMED');
        if (!confirmed) continue;
        await query(`UPDATE signup SET status = 'OBSERVER_CONFIRMED' WHERE signup_id = $1`, [signupId]);

        const cycleCheck = await query(
            `SELECT 1 FROM evaluation_cycle WHERE teacher_id = $1 AND term = $2 AND year = $3`,
            [signup.observee_teacher_id, assessmentCycle.term, assessmentCycle.year]
        );
        if (cycleCheck.rowCount === 0) continue;

        const finalStatus = pushToCompletion
            ? faker.helpers.arrayElement(['COMPLETED', 'COMPLETED', 'COMPLETED', 'SUBMITTED'])
            : faker.helpers.arrayElement(['CONFIRMED', 'CONFIRMED', 'SUBMITTED', 'COMPLETED']);

        let assignment;
        try {
            const assignmentResult = await query(
                `INSERT INTO observation_assignment
                    (term, year, signup_id, source_request_id, observee_teacher_id, observer_teacher_id, course_section_id, status,
                     confirmed_at, submitted_at, completed_at, observee_signed_at, observer_signed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                         now(),
                         CASE WHEN $8 IN ('SUBMITTED','COMPLETED') THEN now() ELSE NULL END,
                         CASE WHEN $8 = 'COMPLETED' THEN now() ELSE NULL END,
                         CASE WHEN $8 IN ('SUBMITTED','COMPLETED') THEN now() ELSE NULL END,
                         CASE WHEN $8 IN ('SUBMITTED','COMPLETED') THEN now() ELSE NULL END)
                 RETURNING *`,
                [assessmentCycle.term, assessmentCycle.year, signupId, confirmed.request_id, signup.observee_teacher_id, confirmed.observer_teacher_id, signup.course_section_id, finalStatus]
            );
            assignment = assignmentResult.rows[0];
        } catch (err) {
            if (err.code === '23505') continue;
            throw err;
        }

        await query(`UPDATE observation_request SET status = 'SELECTED' WHERE request_id = $1`, [confirmed.request_id]);
        await query(
            `UPDATE observation_request SET status = 'NOT_SELECTED' WHERE signup_id = $1 AND request_id <> $2 AND status IN ('PENDING','OBSERVER_CONFIRMED')`,
            [signupId, confirmed.request_id]
        );
        await query(`UPDATE signup SET status = 'COMPLETED' WHERE signup_id = $1`, [signupId]);

        const client = await getClient();
        try {
            await client.query('BEGIN');
            await recordTransition(client, { assignmentId: assignment.assignment_id, changedBy: 'SEED_SCRIPT', fromStatus: null, toStatus: 'PROPOSED', note: 'Seed data.' });
            if (['CONFIRMED', 'SUBMITTED', 'COMPLETED'].includes(finalStatus)) {
                await recordTransition(client, { assignmentId: assignment.assignment_id, changedBy: 'SEED_SCRIPT', fromStatus: 'PROPOSED', toStatus: 'CONFIRMED', note: 'Seed data.' });
            }
            if (['SUBMITTED', 'COMPLETED'].includes(finalStatus)) {
                await recordTransition(client, { assignmentId: assignment.assignment_id, changedBy: 'SEED_SCRIPT', fromStatus: 'CONFIRMED', toStatus: 'SUBMITTED', note: 'Seed data.' });
            }
            if (finalStatus === 'COMPLETED') {
                await recordTransition(client, { assignmentId: assignment.assignment_id, changedBy: 'SEED_SCRIPT', fromStatus: 'SUBMITTED', toStatus: 'COMPLETED', note: 'Seed data.' });
                await client.query(
                    `UPDATE evaluation_cycle SET status = 'COMPLETED' WHERE teacher_id = $1 AND term = $2 AND year = $3`,
                    [signup.observee_teacher_id, assessmentCycle.term, assessmentCycle.year]
                );
                completedCount += 1;
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    return { signups: signupIds.length, completed: completedCount };
}

async function seedMongo() {
    const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');
    await client.connect();
    const db = client.db(process.env.MONGO_DB || 'assessment_helper_docs');

    // Keep the evaluation_forms template around — AC-editable criteria —
    // even though survey_responses no longer references it by ID.
    const form = {
        formId: 'peer-observation-v1',
        title: 'Peer Classroom Observation Form',
        version: 1,
        fields: [
            { key: 'clarity_of_objectives', label: 'Learning objectives were clear', type: 'likert_5' },
            { key: 'student_engagement', label: 'Students were actively engaged', type: 'likert_5' },
            { key: 'pacing', label: 'Pacing was appropriate for the material', type: 'likert_5' },
        ],
        createdAt: new Date(),
    };
    await db.collection('evaluation_forms').updateOne({ formId: form.formId }, { $setOnInsert: form }, { upsert: true });

    const completedAssignments = await query(
        `SELECT assignment_id, term, year, observee_teacher_id, observer_teacher_id FROM observation_assignment WHERE status = 'COMPLETED'`
    );

    const CRITERIA = ['clarity_of_objectives', 'student_engagement', 'pacing'];
    const surveyDocs = [];
    for (const a of completedAssignments.rows) {
        // Observee survey — no link back to the assignment_id (schema v3):
        // matched at query time purely by (respondentTeacherId, term, year).
        surveyDocs.push({
            respondentTeacherId: a.observee_teacher_id,
            role: 'OBSERVEE',
            term: a.term,
            year: a.year,
            processOk: faker.datatype.boolean({ probability: 0.85 }),
            positiveFeedback: faker.lorem.sentence(),
            negativeFeedback: faker.datatype.boolean({ probability: 0.35 }) ? faker.lorem.sentence() : '',
            uploadedFileRef: faker.datatype.boolean({ probability: 0.1 }) ? `uploads/observation-notes-${faker.string.alphanumeric(8)}.pdf` : undefined,
            submittedAt: faker.date.recent({ days: 200 }),
        });
        if (faker.datatype.boolean({ probability: 0.7 })) {
            surveyDocs.push({
                respondentTeacherId: a.observer_teacher_id,
                role: 'OBSERVER',
                term: a.term,
                year: a.year,
                processOk: faker.datatype.boolean({ probability: 0.9 }),
                positiveFeedback: faker.lorem.sentence(),
                negativeFeedback: faker.datatype.boolean({ probability: 0.2 }) ? faker.lorem.sentence() : '',
                criteriaScores: CRITERIA.map((criterion) => ({ criterion, score: faker.number.int({ min: 2, max: 5 }) })),
                submittedAt: faker.date.recent({ days: 200 }),
            });
        }
    }
    // Strip undefined optional fields before insert (Mongo driver keeps
    // them otherwise, which the $jsonSchema validator would still accept,
    // but cleaner documents make the demo output easier to read).
    const cleanedDocs = surveyDocs.map((doc) => JSON.parse(JSON.stringify(doc)));
    if (cleanedDocs.length) {
        await db.collection('survey_responses').insertMany(cleanedDocs);
    }

    console.log(`[seed:mongo] upserted 1 evaluation form, inserted ${cleanedDocs.length} survey responses.`);
    await client.close();
}

async function main() {
    console.log(`[seed] generating synthetic data (seed=${SEED}, teachers=${TEACHER_COUNT})`);
    console.log('[seed] NOTE: all identities below are fabricated by Faker — no real professor data is used.');

    const teachers = buildFakeTeachers(TEACHER_COUNT);

    const allSections = [];
    const sectionsByTermByInstructor = new Map(); // "TERM-YEAR" -> Map(instructor_id -> section)
    for (const { term, year } of SEMESTER_SEQUENCE) {
        const sections = buildCourseSectionsForTerm(teachers, term, year);
        allSections.push(...sections);
        sectionsByTermByInstructor.set(`${term}-${year}`, new Map(sections.map((s) => [s.instructor_id, s])));
    }

    const rules = buildSchedulingRules();
    await seedCoreData({ teachers, sections: allSections, rules });

    const acMember = teachers.find((t) => t.is_ac_member) || null;

    console.log(`[seed] walking ${SEMESTER_SEQUENCE.length} semesters in sequence so later cycles have real evaluation history...`);
    for (let i = 0; i < SEMESTER_SEQUENCE.length; i++) {
        const semester = SEMESTER_SEQUENCE[i];
        const isCurrent = i === SEMESTER_SEQUENCE.length - 1;
        const assessmentCycle = await seedAssessmentCycle(semester, acMember, isCurrent);
        const sectionsByInstructor = sectionsByTermByInstructor.get(`${semester.term}-${semester.year}`);

        const { signups, completed } = await simulateSemester(assessmentCycle, sectionsByInstructor, !isCurrent);
        console.log(
            `[seed] ${semester.term} ${semester.year}${isCurrent ? ' (current)' : ''}: ` +
            `${signups} signups, ${completed} observations completed.`
        );
    }

    await seedMongo();

    console.log('[seed] complete.');
}

if (require.main === module) {
    main()
        .catch((err) => {
            console.error('[seed] failed:', err);
            process.exitCode = 1;
        })
        .finally(async () => {
            await pool.end();
        });
}

module.exports = { buildFakeTeachers, buildCourseSectionsForTerm };
