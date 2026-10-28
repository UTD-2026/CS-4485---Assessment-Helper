# Assessment Helper: backend

Node + Express + Mongoose API for UTD's CS Assessment Committee: peer teaching observations from sign-up to survey.
It runs on the team's schema (`models/index.js`), setup script (`setup-database.js`) and seed (`seed/`).
**Stack decision:** Node.js + MongoDB (the proposal's "Python" and "MySQL" mentions should be corrected).

| Read this | For |
|---|---|
| [`docs/FRONTEND-CHANGES.md`](docs/FRONTEND-CHANGES.md) | what the frontend must change (we did not touch it) |
| [`docs/openapi.json`](docs/openapi.json) · `GET /api/docs/openapi.json` | the API contract (OpenAPI 3) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | ER diagram, architecture, MongoDB design decisions, indexes |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | localhost, Docker, free hosting, CI |
| [`docs/TESTING.md`](docs/TESTING.md) | seed strategy, test ownership, proof-of-concept exit criteria |

## Run it against MongoDB

```bash
cd backend
npm install
cp .env.example .env        # fill in MONGODB_URI (never commit .env)
npm run test-db             # pings MongoDB
npm run setup-db            # collections + indexes
npm run seed                # 100 professors, 264 sections, 8 cycles ... (refuses a non-empty database)
npm start                   # http://localhost:5000/health   (npm run dev restarts on save)
```

Every seeded account signs in with password `Password123!` and either its email or its NetID (the part before `@`):
committee members are `ddr199513`, `cjl239108`, `mam445002`; a regular professor is `ejg104485`.
Set `JWT_SECRET` in `.env` before deploying anywhere real (production refuses to start with the default).

## Run it without any database

```bash
npm test         # 109 tests: rules, auth, the whole workflow, visibility, surveys, NetID, Course Book, the API contract
```

Both load small in-memory stand-ins for `mongoose`, `express` and `dotenv` (`test/support/`). Everything above the database
(rules, workflow, auth, validation, route handlers) is the real code. The stand-in database is strict (it rejects
unsupported operators and undefined filter values and enforces unique indexes, enums and required fields) but it is **not
MongoDB**. See [Limits](#limits).

## Conventions the frontend needs to know

**Section ids.** The team's schema has no section `_id`; a section is `(course_code, section_number, term)`. The API shows
that as one string, the `sectionId`: `CS 2117~001~Fall 2025`. Send it in request bodies (`{ "sectionId": "..." }`) and
URL-encode it in paths (`/api/observations/CS%202117~001~Fall%202025/candidates`). A malformed id is a 400.

**Casing.** The database is snake_case (the team's models). The API speaks camelCase in requests and responses
(`courseCode`, `observerEmail`, `hireLevel`). Every response also carries `sectionId`, and each course section carries
`days` (`MW`, `TR`; R = Thursday), `startTime`, `endTime` and `courseLevel`, all derived from `timing` (`"MW 08:30-09:45"`).
The seed writes Tuesday/Thursday as `TT`; the backend reads that as Tuesday + Thursday. Keys inside `ratings`, `fields` and
`criteria` are the committee's own and are never renamed.

**Auth.** `POST /api/auth/login` with `{ "username": "ejg104485", "password": "..." }` (`email` also works) returns
`{ token, professor }`. Send `Authorization: Bearer <token>`. Committee-only routes check `is_ac_member` on every call, so
removing someone from the committee takes effect immediately. Tokens are HS256 JWTs built with `node:crypto`.

**Errors** are `{ error, code, details? }` with a meaningful status (400 bad input, 401, 403, 404, 409 conflict/wrong state,
410 expired request, 413 too large, 415 wrong type, 422 rules rejected it).

**Pagination.** `?page=1&pageSize=25` (max 100). New and large lists always answer with a `pagination` object; the older lists
(`/api/professors`, `/api/sections`, `/api/notifications`) stay unpaged until `page` or `pageSize` is sent.

**CORS.** Browser origins in `CORS_ORIGINS` (default: Vite on :5173, :3000) may call the API.

## Endpoints

| Area | Routes |
|---|---|
| Auth | `POST /api/auth/login` · `GET /api/auth/providers` · `POST /api/auth/netid/mock/ticket` · `POST /api/auth/netid/callback` · `GET /api/auth/me` |
| Who am I | `GET /api/me` · `GET /api/me/permissions` |
| API contract | `GET /api/docs/openapi.json` (no login) |
| What do I do next? | `GET /api/overview?term=` (next step for the professor and for each of their observer duties) |
| Cycles | `GET /api/cycles` · `/current` · `/:term` · `POST /api/cycles` (AC) · `PUT /api/cycles/:term` (AC) |
| Committee, per cycle | `GET /:term/eligible-faculty` · `GET /:term/due-report` · `/signups` · `/insufficient-observers` · `POST /:term/send-due-reminders` · `/run-observer-selection` · `/notify-observer-lists-ready` · `/notify-survey` |
| Professors / sections | `GET /api/professors` (AC) · `/:email` · `/:email/due-status` · `/:email/eligibility` · `GET /api/sections` · `GET /api/course-offerings` |
| Sign-up | `POST /api/signups` · `GET /api/signups/mine` |
| Observer lists | `GET /api/matching/preview/:sectionId` (AC) · `POST /api/matching/generate/:sectionId` (AC) · `GET /api/observations/:sectionId/candidates` |
| Requests | `POST /api/observation-requests` · `GET /incoming` · `POST /:sectionId/respond` (`CONFIRM`/`DECLINE`) · `POST /:sectionId/finalize` (two-step mode) |
| Observations | `GET /api/observations/mine` · `/:sectionId` · `PATCH /:sectionId/schedule` · `POST /:sectionId/report-not-held` · `POST`/`PUT /:sectionId/record` · `POST /:sectionId/sign` · `GET /:sectionId/calendar.ics` |
| Signed PDF | `PUT`/`POST /api/observations/:sectionId/files/signed-template` (raw `application/pdf`, optional `?filename=`) · `GET` the same path · `GET /:sectionId/files` |
| Template | `GET /api/forms` · `/:formId` · `POST /api/forms` (AC) · `PUT /api/forms/:formId` (AC) |
| Survey (anonymous) | `GET /api/surveys/templates` · `/templates/active` · `/status` · `POST /api/surveys` · `GET /mine` (finished terms only) · `GET /api/surveys?term=` (AC: counts, and answers once enough people replied) |
| Notifications | `GET /api/notifications?unread=true` · `POST /:id/read` · `POST /read-all` |
| Committee dashboard | `GET /api/admin/dashboard-stats` (+ `/faculty-due-for-evaluation`, `/overdue-evaluations`, `/eligibility-violations`, `/unmatched-faculty`, `/outstanding-observations`, `/participation`, `/survey-completion`) · `GET /api/admin/analytics/observer-workload` |
| CSV reports (AC) | `GET /api/reports/due` · `/signups` · `/observations` · `/workload` · `/kpis` (`?term=`) |
| Sweeps (AC) | `POST /api/admin/jobs/run` · `/expire-requests` · `/mark-missed` |
| Operations (AC) | `GET /api/admin/audit-log` · `GET /api/admin/course-book/status` · `POST /api/admin/course-book/refresh` · `POST /api/admin/surveys/anonymize-legacy` |

## How the workflow behaves

1. **Sign-up** (until the cycle's `signup_deadline`): one per professor per term, for one of their own sections.
2. **Observer selection** (committee, after the deadline): a colleague is eligible if they are not the observee, are in the
   section's department, teach a course at the same level this term, and have no overlapping class. 0 eligible = the
   signup becomes `unmatched` and shows on the committee alert; 1-4 = all of them are listed; 5 or more = a random 5.
   Level matching is exact by default (`LEVEL_MATCHING=band` groups 1-2 / 3-4 / 5+).
3. **Requests** (observee): each stays open 48 hours. By default the **first CONFIRM wins** (atomic); everyone else who was asked is
   told politely. With `CONFIRMATION_MODE=observee_final` a CONFIRM is only "accepted" and the observee picks one
   (`/finalize`). A late answer is a 410 and becomes `expired`. Sweeps run every 15 minutes inside the server (or `npm run jobs`).
4. **Date**: must be a real day the class meets, today or later, before the observation deadline.
5. **Record**: the observer fills in a copy of the committee's template in the app (the copy keeps its template version).
   The first signature locks it; the second completes the observation and moves `last_observed`. **The observer signs first.**
   Who may read the report (the committee's answer): the observer always; the observee after the observer signs; the committee
   after both sign. Hidden reports are stripped from every response, including the PDF download.
6. **Missed**: a date that passes unsigned is marked `missed`; either person can also press "Did Not Happen" (`report-not-held`).
   It can be rescheduled while the period is open.
7. **Signed PDF**, **calendar file**, **survey** (after completion, once per term) and **CSV reports** hang off the same observation.
8. **Survey is anonymous**: answers are stored with a random id and no name or time; a separate list only records *who finished*.
   The committee sees counts at once and the answers once `SURVEY_MIN_RESPONSES` (default 3) people replied.
9. **Audit log** of who did what (`GET /api/admin/audit-log`); surveys are never written to it.

## Integrations (proof-of-concept status)

- **NetID:** `NETID_MODE=mock` is a stand-in identity provider (ticket, then callback; one use, short life). It lets anyone sign
  in as any NetID, so production refuses to start with it unless `ALLOW_MOCK_NETID_IN_PRODUCTION=true`. Real UTD single sign-on needs approval.
- **Course Book:** `GET /api/course-offerings` goes through an adapter with timeout, retries, cache and fallback to our own
  sections (`COURSEBOOK_MODE=local` by default). The remote response format is an assumption until we have the API key.

Due status follows the committee's wording: assistants every year (due the whole year after the anniversary term),
associate/full every two years (due the anniversary term only); never observed = overdue. Each term is judged from the last
completed observation *before* that term.

## Where this differs from the team's models

`models/index.js` keeps the six schemas as written, with these changes:
- `observations.observer_email` and `observerMatches.requested_date` are no longer `required` (default `null`): the team's own
  seed has rows with `null` there (a signup nobody has accepted yet).
- Enums on observation and match `status`; extra indexes; and extra fields (`observee_email`, `record`, `status_history`,
  `expires_at`, `responded_date`, ...). All are optional, so the seed loads unchanged.
- Seven added collections: `evaluationforms`, `notifications`, `eligibilityviolations`, `observationfiles`, `surveytemplates`, `surveyresponses`, `auditlogs`. `setup-database.js` creates them.
- `observations` gained `observation_time`, `missed_reported_by`, `missed_reason`, `missed_date` (all optional).

Seed oddities worth knowing (nothing was changed in the seed): two observation rows have the section's own instructor as
observer (`CS 3083~003~Fall 2025`, `CS 2495~001~Fall 2026`); the four `unmatched` signups in Fall 2026 would have 27 to 30 eligible
colleagues under these rules (re-running observer selection lists them); only about 29% of the seed's observer rows obey the
eligibility rules The whole seed is one CS department, so the "few" and "none" cases in the tests use three
small departments added on the fly (`test/support/scenarios.js`).

## Limits

- **Never run against a real MongoDB, real Mongoose or real Express.** Only the in-memory stand-ins have been exercised. First
  thing to do on a machine with internet: the commands under "Run it against MongoDB".
- `package-lock.json` still lists `@faker-js/faker` from an earlier version; use `npm install` (it repairs the lock), not `npm ci`.
- The signed PDF is checked only by its `%PDF-` header and size; it is stored as base64 inside MongoDB (cap 1-10 MB).
- Not built: email delivery (notifications live in the database), real university SSO (only the mock), real Course Book data
  (adapter ready; the remote format is assumed), rate limiting.
- Survey anonymity is at the API level: someone with full database access could try to correlate rows by insertion order.
- The one-use NetID ticket check lives in memory, so it holds for one server process only.
- In two-step mode an `accepted` row that is later cancelled does not count as a yes in the workload statistics.
- The Dockerfile, compose file, `render.yaml` and CI workflow have not been run.
- Tests use a pinned clock (the seed's "today" is 2026-10-12) so results do not depend on the real date.

## Layout

`routes/` HTTP handlers · `services/` rules and workflow (pure where possible) · `middleware/` auth, CORS, errors, camelCase
output · `models/` Mongoose schemas · `jobs/` sweeps · `config/` env and database · `seed/`, `setup-database.js`,
`test-database.js`, `validators/` the team's files · `docs/` contract and design notes · `test/` (with the in-memory stand-ins in `test/support/`).
