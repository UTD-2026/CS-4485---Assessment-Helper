# Backend

Express 5 + Mongoose API for Assessment Helper. It started from the `mikael_backend_db` branch (`server.js`, read-only routes,
`{ "data": ... }` responses) and now implements every endpoint in the team's **API Endpoints** Google Doc.

## Start the API

```bash
npm install                      # in backend/
cp .env.example .env             # set MONGODB_URI and JWT_SECRET
npm run test-db                  # ping MongoDB
npm run setup-db                 # collections + indexes (safe to re-run)
npm run seed                     # load seed/seed-data.json into EMPTY collections
npm run dev                      # http://127.0.0.1:5000/api/health
```

`npm run seed:reset-local` drops the collections first, but only for a `mongodb://localhost/...` database; the shared Atlas
database is never wiped. The Vite dev server proxies `/api` to `http://localhost:5000`.

| Variable | Default | Meaning |
|---|---|---|
| `MONGODB_URI` | (required) | Connection string |
| `PORT` / `HOST` | `5000` / `127.0.0.1` | Where the API listens |
| `JWT_SECRET` | dev-only value | Signs login tokens. Set a long random value outside local development |
| `TOKEN_LIFETIME` | `8h` | Login session length |
| `CURRENT_TERM` | derived | Force the current term (otherwise: earliest cycle whose survey deadline has not passed) |
| `OBSERVER_POOL` | `signed_up` | `signed_up` = observers come from professors who signed up this cycle; `all` = anyone teaching this term |
| `MAX_OBSERVERS_PER_LIST` | `5` | Size of a generated observer list |

## Conventions

- Every response is `{ "data": ... }` (lists may add `meta`). Errors are `{ "error": "message" }` with the doc's status codes
  (400, 401, 403, 404, 409, 500); archiving a notification returns 204.
- Everything except `/api/health`, `/api/auth/login` and `/api/auth/test-accounts` needs `Authorization: Bearer <token>`.
- Observations and observer matches are identified by course section: `/:course_code/:section_number/:term`, URL-encoded
  (`/api/observations/CS%202117/001/Fall%202026`).
- Professors only see observations and requests they are part of; ratings are visible to the observer, the observee and the
  committee; a saved draft only to its observer; survey answers never carry an email.

## Endpoints

### Auth (needed for the doc's 401 status)
| Method | Endpoint | Notes |
|---|---|---|
| POST | /api/auth/login | `{ username, password }` (NetID or email) → `{ token, professor }` |
| GET | /api/auth/me | The signed-in professor |
| GET | /api/auth/test-accounts | **Extension.** Public, off when `NODE_ENV=production`. Every professor's `{ netid, name, department, role }` (`Committee`/`Professor`) for the login page's test-accounts list |

### 1. Professors
| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/professors | `?term=` (default current). Each professor includes `evaluation_status` (`due`/`overdue`/`not_due`, next due term) |
| GET | /api/professors/:email | |
| PATCH | /api/professors/:email | Committee: `name, department, hire_level, is_ac_member, last_observed`. Self: `name` |
| GET | /api/professors/:email/evaluation-status | `?term=`; also says whether they signed up |

### 2. Course Sections
| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/course-sections | `?term=&instructor_email=` |
| GET | /api/course-sections/:course_code/:section_number/:term | |
| POST | /api/course-sections | Committee. `{ course_code, section_number, term, timing, instructor_email }` |
| PATCH | /api/course-sections/:course_code/:section_number/:term | Committee. `timing`, `instructor_email` |

### 3. Evaluation Cycles
| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/evaluation-cycles | `meta.current_term` = the term the app works in |
| GET | /api/evaluation-cycles/:term | |
| POST | /api/evaluation-cycles | Committee. `{ term, signup_deadline, observation_deadline, feedback_deadline }` (YYYY-MM-DD), optional `feedback_deadline_time` (HH:MM, 24-hour; omitted/null = survey closes 11:59 PM) |
| PATCH | /api/evaluation-cycles/:term | Committee. Any of the three deadlines and/or `feedback_deadline_time`; participants are notified |
| GET | /api/evaluation-cycles/:term/due-professors | Due + overdue professors with `signed_up` |
| GET | /api/evaluation-cycles/:term/template | Reads `templates/<term-slug>.json` (e.g. `fall-2026.json`), else `templates/default.json` |
| PUT | /api/evaluation-cycles/:term/template | **Extension.** Committee. `{ criteria: [{ id, criteria, ratingScale }] }` writes that term's JSON file (used by the Template Editor) |

### 4. Observations
| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/observations | `?term=&observee_email=&observer_email=&status=` (status may be a comma list) |
| GET | /api/observations/:course_code/:section_number/:term | |
| POST | /api/observations | Course sign-up: `{ course_code, section_number, term? }`. Must be your section, before the sign-up deadline, one per professor per term. Generates the observer list |
| PATCH | /api/observations/:course_code/:section_number/:term | Schedule: `{ observation_date, observation_time? }` (observee). Must be a class meeting day, not in the past, by the observation deadline |
| PATCH | …/status | `{ status, reason }`. Participants: `deferred` + reason (committee notified). Committee: any legal transition |
| PATCH | …/form | `{ ratings, draft: true }` save progress · `{ ratings, items?, submit: true }` submit · `{ observer_signed: true }` · `{ observee_signed: true }`. Both signed → `completed` and the observee's `last_observed` is updated |
| PATCH | …/missed | `{ reason? }` observer, observee or committee |

Status lifecycle (`services/observationStateMachine.js`): `signed_up | unmatched → matched → scheduled → awaiting_confirmation → completed`, plus `missed` and `deferred`.

### 5. Observer Matches
| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/observer-matches | `?term=&observer_email=&status=` (+ `observee_email`) |
| POST | /api/observations/…/generate-observer-list | Committee. Same department, not self, teaches the same course level this term, no time overlap; up to 5, lightest observer workload first |
| POST | /api/observations/…/release-observer-list | Committee. Observee is notified and can send requests |
| POST | /api/observations/…/observer-requests | Observee. `{ observer_emails: [...] }` from the released list |
| PATCH | /api/observer-matches/:course_code/:section_number/:term/:observer_email/response | Requested observer. `{ response: "accept" \| "decline" }` |
| POST | /api/observations/…/select-observer | `{ observer_email }`. Observee: an observer who accepted (other requests are cancelled). Committee: manual assignment |

Match statuses: `suggested → requested → accepted | declined → confirmed | cancelled`.

### 6. Surveys
| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/surveys/status | `?term=`. Committee may add `all=true` to get who submitted (emails only, for the KPI) |
| POST | /api/surveys | `{ process_ok, difficulties, improvements, has_attachment }`. Once per term, before the survey closes. `process_ok: false` requires both `difficulties` and `improvements` |
| GET | /api/surveys/responses | Committee. Answers with a hashed `response_id` and `submitted_at` (ISO timestamp), no email |
| POST | /api/surveys/reminders | **Extension.** Committee. Notifies signed-up professors who have not submitted (the "Request End-of-Process Surveys" button) |

### 7. Reports and KPIs (committee)
| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/reports/kpis?term= | All dashboard KPIs + faculty due by hire level + observer workload |
| GET | /api/reports/outstanding-observations?term= | Not completed/deferred; `meta.by_hire_level` |
| GET | /api/reports/unmatched-faculty?term= | No eligible candidates. `&include=all_due` adds every due/overdue professor without an observer, with a reason |

### 8. Notifications
| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/notifications | The signed-in user's notifications (`?archived=`) |
| PATCH | /api/notifications/:notification_id/read | |
| PATCH | /api/notifications/:notification_id/archive | 204 No Content |

## Data model changes (models/index.js)

Existing fields and keys are unchanged, so the seed data loads as before. Added:
- `Observation`: `observer_email` optional (null until selected), `observation_time`, `match_flag`, `list_generated_date`,
  `list_released_date`, `selected_manually`, `evaluation_items`, `evaluation_submitted_date`, `evaluation_draft`,
  `evaluation_draft_saved`, `missed_reason`, `missed_reported_by`, `missed_date`, `deferral_reason`, `deferred_by`
- `ObserverMatch`: `requested_date` optional (null for suggestions), `responded_date`
- `Survey`: `process_ok`, `difficulties`, `improvements`, `has_attachment` (seeded `process_rating` / feedback fields still read)
- New `Notification` collection (`setup-database.js` creates it)

## Tests

```bash
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/assessment_helper_test npm test
```

`test/api.test.js` wipes that local database, loads the seed data and runs the whole workflow through HTTP (login, sign-up,
list generation and release, request/accept/select, scheduling rules, draft, submit, pair confirmation, survey anonymity,
notifications, reports), plus unit tests for the due-status and eligibility rules. Without `MONGODB_URI_TEST` only the unit tests run.

## Known gaps

- Real UTD NetID single sign-on and UTD Course Book import are not wired in (password login against the seed hashes for now).
- Notifications are in-app only (no email).
- Survey attachments are recorded as a yes/no flag; files are not uploaded.
- Seed quirks: a few self-matches and many different-level suggestions, so Eligibility Accuracy shows ≈ 29% on the seed data.
