# Backend

The Express API connects to MongoDB Atlas using `MONGODB_URI` from `backend/.env`.

## Start the API

Create `backend/.env` from the example, set `MONGODB_URI`, then start the server:

```bash
cp backend/.env.example backend/.env
cd backend
npm run dev
```

The server listens on `127.0.0.1:5000` by default. Set `PORT` in `backend/.env` to use another local port. Keep it bound to the local machine; the API routes do not yet enforce authenticated sessions.

## Demo professor accounts

The login endpoint checks professor credentials against `password_hash`. Run `npm run setup-demo-logins` once after the database has been seeded to set each professor's password to the shared demo password `123`. This updates only the `professors.password_hash` values. Future database seeding also creates per-account scrypt hashes for `123`.

Usernames are generated from the professor's first initial and last name, with punctuation removed. The current professor list has one duplicate base username; those two accounts use the middle initial as well. Committee members (`is_ac_member: true`) enter the Committee portal; other accounts enter the Professor portal.

## Implemented endpoint groups

### Authentication

- `POST /api/auth/login` with `{ "username": "...", "password": "123" }`

The login response contains the professor profile and portal role, but never the stored password hash. AC access is based on `is_ac_member`.

### Professors

- `GET /api/professors`
- `GET /api/professors/:email`
- `PATCH /api/professors/:email`
- `GET /api/professors/:email/evaluation-status`

Professor responses never include `password_hash`. The PATCH route accepts `name`, `department`, `hire_level`, `last_observed`, and `is_ac_member`; it does not change the professor email or password hash.

Evaluation status uses the existing prototype rule: assistant professors are evaluated every two terms, and associate/full professors every four. The last completed observation term is used as the evaluation term; if there is no completed observation record, `last_observed` is mapped to Spring for January through June and Fall for July through December. The status response includes `assessed_term`, `last_evaluation_term`, `next_due_term`, `status`, and `semesters_overdue`.

### Course Sections

- `GET /api/course-sections?term=...&instructor_email=...`
- `GET /api/course-sections/:course_code/:section_number/:term`
- `POST /api/course-sections`
- `PATCH /api/course-sections/:course_code/:section_number/:term`

The composite key is fixed after creation. PATCH accepts `timing` and/or `instructor_email`. `section_number` must be a three-character string, such as `"001"`; the timing format is `MW HH:MM-HH:MM` or `TT HH:MM-HH:MM`.

### Evaluation Cycles

- `GET /api/evaluation-cycles`
- `GET /api/evaluation-cycles/:term`
- `POST /api/evaluation-cycles`
- `PATCH /api/evaluation-cycles/:term`
- `GET /api/evaluation-cycles/:term/due-professors`
- `GET /api/evaluation-cycles/:term/template`

Cycle deadlines must be ordered signup, observation, then feedback. The due-professors response includes due and overdue faculty and counts by hire level.

The template route reads `backend/templates/<term>.json`. JSON templates are present for each seeded cycle. Creating a cycle copies the latest available template to its new term file. The template editor in the demo UI is a local preview because the agreed API has no template-update route; edit the matching JSON file to publish criteria changes.

### Observations

- `GET /api/observations?term=...&observee_email=...&observer_email=...&status=...`
- `GET /api/observations/:course_code/:section_number/:term`
- `POST /api/observations`
- `PATCH /api/observations/:course_code/:section_number/:term`
- `PATCH /api/observations/:course_code/:section_number/:term/status`
- `PATCH /api/observations/:course_code/:section_number/:term/form`
- `PATCH /api/observations/:course_code/:section_number/:term/missed`

The observee is resolved from the matching course section's `instructor_email`. An initial signup can omit `observer_email`; its default status is `signed_up`. Form ratings and notes are stored in the existing `ratings` field, with signature dates stored in the observation's signature fields.

### Surveys

- `GET /api/surveys/status?professor_email=...&term=...`
- `POST /api/surveys`
- `GET /api/surveys/responses?term=...`

The database keeps the professor email to enforce one response per professor per term and to report completion. The reporting endpoint removes respondent identities. The current UI does not upload file contents: it saves only whether an attachment was selected.

Successful responses use `{ "data": ... }`; collection responses use an array. Creates return `201`. Invalid input returns `400`, missing records `404`, duplicate keys or invalid state changes `409`, and unexpected errors `500`.

The Vite development server proxies `/api` to `http://127.0.0.1:5000`. The login screen authenticates against the professor collection. Authentication currently gates the UI only; API authorization and role-based route protection are not implemented. The shared password is intentionally for local demonstration only. Keep the API bound to the local machine. Observer matching, reports/KPIs, notifications, and email remain mock-only or unimplemented as agreed.
