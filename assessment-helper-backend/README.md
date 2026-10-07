# Assessment Helper — Backend
## Stack

- **PostgreSQL** — system of record: teachers, course sections, scheduling
  rules, evaluation cycles, observation assignments, audit log.
- **MongoDB** — flexible document storage: dynamic evaluation forms, raw
  UTD Course Book API payloads, survey responses.
- **Node.js / Express** — API layer.
- **@faker-js/faker** — synthetic data generation (no real professor data,
  ever).

## Project layout

```
src/
  config/
    db.js                      Postgres pool singleton
    mongo.js                   Mongo client singleton
  db/
    schema.sql                 Step 1: DDL — tables, enums, FKs, timestamps
    migrate.js                 Applies schema.sql
    initMongo.js               Step 2: Mongo collections + JSON schema validators
    sample-data/
      course-catalog-sample.json  Anonymized sample for the 1-time Course Book import
    seed/
      fakeDataGenerator.js     Step 3: Faker-based synthetic seed script
  services/
    courseBookIngestion.js     Step 4: normalize/upsert course records (API or local import)
    matchingService.js         Step 5: eligibility-based observer matching (random selection)
    eligibilityService.js      Same-dept / same-level / no-conflict eligibility rules
    evaluationCycleService.js  Due/overdue evaluation_cycle persistence
    dueStatusCalculator.js     Semester-ordinal due/overdue math
    observationStateMachine.js Step 6: transition guard rules
    observationRecordService.js  In-app observation record (create/update/lock/get)
    notificationService.js     Logs reminders/alerts to notification_log
  middleware/
    auditLog.js                 Step 6: audit-log helper + actor-identification middleware
  routes/
    matchmaking.js              Step 5: POST /api/matchmaking/recommend
    observations.js             Step 6: observation workflow + in-app record endpoints
    observationRequests.js      Observee-to-observer request/respond/select flow
    evaluationForms.js          AC-only: create/edit the Observation Template
    assessmentCycles.js         AC workflow: kickoff, selection, reminders
    teachers.js                 Per-teacher due status, observations, teaching load
    signups.js                  Observee course signup
    dashboard.js                 Step 7: GET /api/admin/dashboard-stats/*
  jobs/
    syncCourseBook.js           Live-API batch sync (kept for future use)
    importCourseCatalog.js      1-time local catalog import (current MVP path)
    expireObservationRequests.js  Sweep job for 48h-expired requests
  app.js                        Express app wiring (CORS, JSON body parsing, routes)
  server.js                     Process entry point
```

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # edit .env with your local Postgres/Mongo connection details
   ```

3. **Create the Postgres database**, then apply the schema:
   ```bash
   createdb assessment_helper   # or run the equivalent in your Postgres client
   npm run db:migrate
   ```

4. **Initialize MongoDB collections + validators**:
   ```bash
   npm run mongo:init
   ```

5. **Seed synthetic data** (Step 3 — safe to run repeatedly; uses a fixed
   random seed for reproducible demos):
   ```bash
   npm run db:seed
   ```

6. **Start the API**:
   ```bash
   npm start
   # or: npm run dev   (auto-restarts on file changes)
   ```
   Health check: `GET http://localhost:4000/health`


```bash
npm run import:catalog
# equivalent to: node src/jobs/importCourseCatalog.js [path] [semester]
#   path     defaults to src/db/sample-data/course-catalog-sample.json
#   semester defaults to '26F' (year+F for Fall, year+S for Spring)
```

This reads a local anonymized JSON file (6 sample records are included)
and upserts straight into `course_section` — no network call, no retry
loop, no Mongo staging. It reuses the same `normalizeCourseBookRecord()` /
`upsertCourseSection()` functions the live-sync job uses, so both paths
stay consistent if a real API ever shows up.

The original live-API batch job is still in the codebase
(`src/jobs/syncCourseBook.js` / `npm run sync:coursebook`) for that future
case, decoupled from the live server so API downtime or rate limiting
never affects demos or the rest of the system. Configure
`COURSE_BOOK_API_BASE_URL`, `COURSE_BOOK_API_KEY`, and
`COURSE_BOOK_SYNC_SEMESTERS` in `.env` if you do wire up a real API;
`normalizeCourseBookRecord()` in `src/services/courseBookIngestion.js`
documents the assumed response shape and is the one place to adjust once
a real API contract is confirmed.

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/health` | Liveness check |
| POST   | `/api/assessment-cycles` | AC kicks off a new semester cycle (requires `X-Actor-Id` of an AC member) |
| POST   | `/api/assessment-cycles/:id/advance-status` | Move the cycle to its next stage |
| GET    | `/api/assessment-cycles/:id/due-report` | Due/overdue faculty for this cycle |
| POST   | `/api/assessment-cycles/:id/send-due-reminders` | Notify due/overdue faculty |
| GET    | `/api/assessment-cycles/:id/signups` | All signups (course #, section, meeting time, Observee) |
| POST   | `/api/assessment-cycles/:id/run-observer-selection` | Bulk-generate candidate lists for every signup |
| GET    | `/api/assessment-cycles/:id/insufficient-observers` | AC alert: signups with no/insufficient observers |
| POST   | `/api/assessment-cycles/:id/notify-observer-lists-ready` | Notify Observees their candidate list is ready |
| POST   | `/api/assessment-cycles/:id/notify-survey` | Notify Observees to complete the end-of-process survey |
| GET    | `/api/teachers/:id/evaluation-status` | An Observee's due/overdue history across cycles |
| GET    | `/api/teachers/:id/observations` | Observations received, past and current |
| GET    | `/api/teachers/:id/teaching-load?term=&year=` | Courses this teacher teaches this semester (signup picker) |
| GET    | `/api/teachers/:id/observer-requests` | An Observer's incoming requests |
| POST   | `/api/signups` | Observee signs up with one course section |
| GET    | `/api/signups/:id/candidates` | The (up to 5) eligible observer candidates for a signup |
| POST   | `/api/matchmaking/recommend` | Preview eligible observers for a signup without persisting |
| POST   | `/api/matchmaking/generate/:signupId` | Persist the candidate list for one signup |
| POST   | `/api/observation-requests` | Observee sends requests to chosen candidates (each expires 48h after creation) |
| GET    | `/api/observation-requests/observer/:teacherId` | An Observer's requests |
| POST   | `/api/observation-requests/:id/respond` | Observer confirms or declines. A CONFIRM auto-cancels every other pending request for the same signup; a response after 48h is rejected (410) |
| POST   | `/api/observation-requests/:id/select` | Observee picks their final observer (creates the assignment) |
| POST   | `/api/observations/:id/transition` | Guarded state transition + audit log |
| POST   | `/api/observations/:id/sign` | Observee/Observer signs off that the observation happened; first signature locks the in-app observation record |
| POST   | `/api/observations/:id/could-not-complete` | Observee flags an observation that fell through |
| GET    | `/api/observations/:id/history` | Full audit trail for one assignment |
| POST   | `/api/observations/:id/record` | Creates the in-app observation record (the Observer's copy of the template) |
| PUT    | `/api/observations/:id/record` | Observer updates notes on an unsigned record (409 once locked) |
| GET    | `/api/observations/:id/record` | View the in-app copy of the Observation Template + notes |
| GET    | `/api/admin/evaluation-forms` | List all evaluation form templates (every version retained) |
| GET    | `/api/admin/evaluation-forms/:formId` | One form template |
| POST   | `/api/admin/evaluation-forms` | AC-only: create a new form template (v1) |
| PUT    | `/api/admin/evaluation-forms/:formId` | AC-only: edit criteria/ratings/weights/wording — bumps the version; existing signed records keep their own frozen snapshot |
| GET    | `/api/admin/dashboard-stats/*` | KPIs — see the table below, all accept `?assessmentCycleId=` |

Run `npm run expire:requests` (e.g. hourly via cron) to sweep PENDING
requests nobody ever answered past their 48-hour `expires_at` into
`EXPIRED`, notifying the observer.

### Example: kick off a semester and run the whole happy path

```bash
# 1. AC kicks off Fall 2026
curl -X POST http://localhost:4000/api/assessment-cycles \
  -H "Content-Type: application/json" -H "X-Actor-Id: <ac-member-uuid>" \
  -d '{"term":"FALL","year":2026,"signupDeadline":"2026-09-15","observationPeriodDeadline":"2026-11-01","surveyDeadline":"2026-11-20"}'

# 2. Observee signs up with their course
curl -X POST http://localhost:4000/api/signups \
  -H "Content-Type: application/json" \
  -d '{"assessmentCycleId":"<cycle-id>","observeeTeacherId":"<teacher-id>","courseSectionId":"<section-id>"}'

# 3. AC runs Observer Selection after the signup deadline
curl -X POST http://localhost:4000/api/assessment-cycles/<cycle-id>/run-observer-selection \
  -H "X-Actor-Id: <ac-member-uuid>"

# 4. Observee sends requests, an observer confirms, Observee selects them
curl -X POST http://localhost:4000/api/observation-requests \
  -H "Content-Type: application/json" \
  -d '{"signupId":"<signup-id>","observerTeacherIds":["<candidate-1>","<candidate-2>"]}'
curl -X POST http://localhost:4000/api/observation-requests/<request-id>/respond \
  -H "Content-Type: application/json" -d '{"response":"CONFIRM"}'
curl -X POST http://localhost:4000/api/observation-requests/<request-id>/select

# 5. Observation happens; both parties sign; assignment completes
curl -X POST http://localhost:4000/api/observations/<assignment-id>/sign \
  -H "Content-Type: application/json" -H "X-Actor-Id: <teacher-uuid>" -d '{"role":"OBSERVEE"}'
curl -X POST http://localhost:4000/api/observations/<assignment-id>/transition \
  -H "Content-Type: application/json" -H "X-Actor-Id: <teacher-uuid>" -d '{"toStatus":"SUBMITTED"}'
curl -X POST http://localhost:4000/api/observations/<assignment-id>/transition \
  -H "Content-Type: application/json" -H "X-Actor-Id: <teacher-uuid>" -d '{"toStatus":"COMPLETED"}'
```

`X-Actor-Id` stands in for real authentication until Role-Based Access
Control (a stretch goal) is implemented; every transition and every AC
action still requires an explicit actor so the audit log and AC-only
routes stay attributable/enforceable.

### Semester-based due/overdue math (schema v3: three terms, numeric cadence)

Evaluation due dates are calculated from real Assessment Committee
rules, not arbitrary dates — see `src/services/dueStatusCalculator.js`.
The academic year has three terms (SPRING, SUMMER, FALL), and cadence is
stored as a plain integer (`scheduling_rule.years_between_evaluations`)
rather than a named frequency like "annual"/"biennial" — those labels
stop being precise once a Summer term exists.

- **Assistant Professors** (`years_between_evaluations = 1`,
  `due_window_terms = 3`): due in *any* term of the calendar year after
  their last evaluation — a 3-term due window, one per term now that a
  year has three of them.
- **Associate/Full Professors** (`years_between_evaluations = 2`,
  `due_window_terms = 1`): due in the *exact same term*, 2 calendar
  years later — miss it and the very next term is OVERDUE.

Both rules reduce to one formula: represent a semester as an integer
(`year*3 + termIndex`), and vary only the width of the due window. The
worked examples from the spec (Spring 2025 → due Spring/Summer/Fall 2026
for Assistant; Spring 2025 → due exactly Spring 2027, overdue Summer
2027 for Associate/Full) are used as this module's own sanity checks.

### Other schema v3 changes worth knowing about

- **`department`** is now a real reference table (`src/db/schema.sql`),
  not a freeform `VARCHAR` — `teacher.department` and
  `course_section.department` are foreign keys into it.
- **`course_section`** stores `start_time`/`end_time` as real `TIME`
  columns, not a `"HH:MM-HH:MM"` string — see
  `src/services/eligibilityService.js` for the exact-minute conflict
  check this enables.
- **`evaluation_cycle`** is keyed naturally by `(teacher_id, term, year)`
  — no surrogate `cycle_id`. `observation_assignment` carries `(term,
  year)` directly and references `evaluation_cycle` via that composite
  pair.
- **No file upload on the observation sign-off** —
  `observee_signed_at`/`observer_signed_at` timestamps are still
  required, but the `signed_document_ref` column is gone.
- **Mongo's `survey_responses`** no longer references `formId` or
  `observationAssignmentId` — a survey is matched to a teacher's
  semester purely by `(respondentTeacherId, role, term, year)` in
  application code (see `src/routes/dashboard.js`'s Survey Completion
  Rate route). Fields are now explicit `positiveFeedback` /
  `negativeFeedback` instead of a generic comment blob, "ratings" is
  renamed to `criteriaScores`, and `uploadedFileRef` was added (the
  upload moved here from the observation sign-off).

### Eligibility-based observer matching (replaces focus-area matching)

Per the TA Q&A, candidate *selection* is not a ranking at all: **if
fewer than 5 observers are eligible, every one of them is shown**; if 5
or more are eligible, **5 are picked at random** (`shuffled()` in
`matchingService.js`) rather than by workload, prior participation, or
any other tiebreaker. Current observation load is still computed and
returned alongside each candidate, but purely as informational
metadata for the AC dashboard — it no longer drives who gets picked.

### The full workflow, end to end

1. **AC kicks off a semester** — `POST /api/assessment-cycles` — which
   also computes every active teacher's DUE / OVERDUE / NOT_YET_DUE
   status for that semester (`evaluationCycleService`).
2. **Observee signs up** with exactly one course they teach that
   semester — `POST /api/signups`.
3. **AC runs Observer Selection** after the signup deadline —
   `POST /api/assessment-cycles/:id/run-observer-selection` — which
   calls the matching engine for every signup, persists up to 5 eligible
   candidates each, and flags any signup with zero/insufficient matches
   for the AC's alert dashboard.
4. **AC notifies Observees their list is ready** —
   `POST /api/assessment-cycles/:id/notify-observer-lists-ready`.
5. **Observee sends requests** to some or all of their candidates —
   `POST /api/observation-requests` — each request expires 48 hours
   after it's created (TA Q&A: *"Typical expectation is people respond
   within 48 hours ... invitations should expire after 48 hours"*).
6. **Each candidate confirms or declines** —
   `POST /api/observation-requests/:id/respond`. The **first CONFIRM**
   automatically cancels every other still-pending request for that
   signup and notifies those observers with a graceful decline — the
   Observee doesn't have to wait for every candidate to answer before
   the rest stand down (TA Q&A: *"once the Observee gets a confirmation,
   the system should automatically send a graceful cancellation email to
   the other observers in that subset"*). A response sent after the
   48-hour window returns `410 Gone` and the request flips to `EXPIRED`.
7. **Observee selects their confirmed observer** —
   `POST /api/observation-requests/:id/select` — this is the one place
   an `observation_assignment` row is created; it's immediately walked
   from `PROPOSED` to `CONFIRMED` (both audit-logged). (In practice
   there's normally only one `OBSERVER_CONFIRMED` request left at this
   point, since step 6 already stood down the others — this route still
   defensively stands down any stragglers too.)
8. **The observation happens in person**, with the Observer taking
   notes directly in an in-app copy of the Observation Template rather
   than filling out and uploading a separate file — TA Q&A:
   *"we will let the Observer use a copy of the Observation Template and
   make notes directly in that copy."* `POST /api/observations/:id/record`
   creates that copy (snapshotting the live template's title/version/
   criteria at that moment), `PUT /api/observations/:id/record` lets the
   Observer keep editing it while unsigned, and `GET` returns it.
   Both parties then sign — `POST /api/observations/:id/sign` (role
   `OBSERVEE` or `OBSERVER`) — and the **first signature permanently
   locks the record**: *"Once an observation is signed, NOBODY gets to
   edit it."* The assignment is advanced through `SUBMITTED` →
   `COMPLETED` via `POST /api/observations/:id/transition`, which also
   flips the teacher's `evaluation_cycle` to `COMPLETED`.
   If the observation falls through, the Observee can instead call
   `POST /api/observations/:id/could-not-complete`, which cancels the
   assignment and feeds the Missing Observation Count KPI.
9. **AC requests the survey** after the observation-period deadline —
   `POST /api/assessment-cycles/:id/notify-survey`.
10. **KPIs** are computed live from steps 1–9's data — see
    `GET /api/admin/dashboard-stats/*`, all scoped by
    `?assessmentCycleId=`.

### KPI formulas, as specified

| KPI | Formula | Route |
|---|---|---|
| Evaluation Eligibility Accuracy | eligible evaluations / (eligible + violations) | `/overdue-evaluations` |
| Overdue Evaluation Count | count of `evaluation_cycle.status = 'OVERDUE'` | `/overdue-evaluations` |
| Assessment Participation Rate | signups / teachers who were due | `/participation` |
| Observer Utilization Rate | distinct observers / signups | `/participation` |
| List Sufficiency Rate | avg observer matches per signup (+ % sufficient) | `/participation` |
| Missing Observation Count | confirmed appointments that later couldn't complete | `/outstanding-observations` |
| Survey Completion Rate | Observee surveys submitted / signups | `/survey-completion` |
| Faculty due for evaluation (by hire-level) | breakdown of DUE/OVERDUE by `hiring_level` | `/faculty-due-for-evaluation` |
| Outstanding Observation Report (by hire-level) | non-COMPLETED assignments by `hiring_level` | `/outstanding-observations` |
| Unmatched faculty report | insufficient-observer signups + due-but-not-signed-up | `/unmatched-faculty` |

### Notifications

`src/services/notificationService.js` logs every reminder/alert to
`notification_log` rather than sending real email, in keeping with the
project's free/open-source-only logistics rule. Swapping in real
delivery later (e.g. a free SMTP relay via `nodemailer`) only requires
changing the body of `send()` — every call site in the app is unchanged.

## Notes & next steps

- The UTD Course Book API's real response schema is unknown at the time
  of writing; `normalizeCourseBookRecord()` documents the placeholder
  assumption and is the single point to update.
- Authentication/RBAC, email notifications, and calendar integration are
  the project's stated stretch goals and are intentionally out of scope
  for this pass — `X-Actor-Id` and `is_active`/`hiring_level` columns are
  designed so RBAC can be layered on without a schema rework.
- Run `npm run db:seed` again any time you want a fresh, reproducible set
  of synthetic teachers/sections/cycles/observations for a demo.
