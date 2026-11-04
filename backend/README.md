# Backend

The Express API connects to MongoDB Atlas using `MONGODB_URI` from `backend/.env`.

## Start the API

Create `backend/.env` from the example, set `MONGODB_URI`, then start the server:

```bash
cp backend/.env.example backend/.env
cd backend
npm run dev
```

The server listens on `127.0.0.1:5000` by default. Set `PORT` in `backend/.env` to use another local port. It remains bound to the local machine while authentication is not implemented.

## Implemented endpoint groups

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

The template route reads `backend/templates/<term>.json`. No term template files are present yet, so it returns `404` until the group adds the JSON file for the requested cycle.

### Observations

- `GET /api/observations?term=...&observee_email=...&observer_email=...&status=...`
- `GET /api/observations/:course_code/:section_number/:term`
- `POST /api/observations`
- `PATCH /api/observations/:course_code/:section_number/:term`
- `PATCH /api/observations/:course_code/:section_number/:term/status`
- `PATCH /api/observations/:course_code/:section_number/:term/form`
- `PATCH /api/observations/:course_code/:section_number/:term/missed`

The observee is resolved from the matching course section's `instructor_email`. An initial signup can omit `observer_email`; its default status is `signed_up`. Form ratings and notes are stored in the existing `ratings` field, with signature dates stored in the observation's signature fields.

Successful responses use `{ "data": ... }`; collection responses use an array. Creates return `201`. Invalid input returns `400`, missing records `404`, duplicate keys or invalid state changes `409`, and unexpected errors `500`.

The Vite development server proxies `/api` to `http://localhost:5000`. Authentication, authorization, observer-match routes, surveys, reports, notifications, and email are not implemented in this endpoint group.
