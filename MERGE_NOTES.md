# Branch integration notes

Branch `integration/all-branches` combines every team branch into `main` (the most complete front end).
The API follows the team's **API Endpoints** Google Doc. Each branch is recorded as merged in git history, so
`git log --graph` shows where its work came from.

| Branch | What it contained | What happened to it |
|---|---|---|
| `main` (base) | Newest front end: digital evaluations, drafts, pair confirmation, scheduling validation, notifications, deadlines, manual resolution, template editor, KPIs; Mongoose models + seed data | Kept. Every screen kept its layout; mock data and browser-only state replaced with API calls |
| `mikael_backend_db` | `backend/server.js`, read-only `GET /api/professors`, `/course-sections`, `/evaluation-cycles`, `/observations`, `/observer-matches`, `/surveys`; Vite `/api` proxy | **Merged directly** (real git merge). Its server became the base of the API (`app.js` + `server.js`). The read-only routes were replaced by full routers for the same paths |
| `sriproflookup` | Faculty Search (search, filters, CSV export), Committee Reports (by hiring level, unmatched, outstanding, workload), corrected due rule, signed-up observer pool, day-overlap conflicts, workflow tests | Ported. **Faculty Search** and **Committee Reports** tabs added to the committee portal (reports now come from `/api/reports/*`); `facultyCsv.js` → `frontend/src/utils/facultyCsv.js`; the due rule and observer pool are enforced by the backend; the tests became backend unit tests. Its PDF-upload duty flow was not ported (main replaced it with digital evaluations) |
| `feature_api` | A second, larger standalone backend (JWT, workflow, KPIs, OpenAPI, 109 tests) with different URLs from the Doc | The Doc was chosen as the contract, so this backend is not shipped as-is. Ported pieces: `services/jwt.js` (login tokens), the eligibility helpers (`TT` = Tue/Thu, real time-range overlap), the due-status design (judge by the last completed observation *before* the term), and the root `backend:*` npm scripts |
| `add-backend` | Separate PostgreSQL + MongoDB backend built on a much older front end | Not shipped (the team's schema is MongoDB-only). Ported ideas: the observation **state machine** guard (`services/observationStateMachine.js`) and the committee due rule (same as Sri's) |
| `kavya-db` | First faker-based seed generator (camelCase fields, `_id` keys) | Superseded: `main`'s seed data is the refined version of this data set (same names and password hash, snake_case composite keys matching the models). Kept as the lineage of `backend/seed/seed-data.json` |

## Decisions worth knowing

- **Current term** = the earliest evaluation cycle whose survey deadline has not passed (Fall 2026 for the seed data). Override with `CURRENT_TERM`.
- **Due rule**: Assistant: due in every term of the calendar year after their last evaluation; Associate/Full: due in the same semester two years later; never evaluated = overdue. (Main's mock used "every 2 / 4 semesters"; three branches implemented the committee wording above.)
- **Observer pool**: lists only include professors who signed up this cycle ("Submit & Enter Observer Pool"). `OBSERVER_POOL=all` widens it.
- **Sign-up closes** at the end of the sign-up deadline day (server-enforced; the committee can move the deadline).
- **Template Editor** writes `backend/templates/<term>.json`, matching the Doc's "one JSON file per term". It defaults to the *next* term so the form in use doesn't change mid-cycle (main's "semester-locked" behaviour). This needs one extra endpoint (`PUT …/template`), marked as an extension.
- **Survey reminders** button uses one extra endpoint (`POST /api/surveys/reminders`), also marked as an extension.
- Notifications that the front end used to create in browser memory are now written by the server at each workflow step.
- `frontend/src/data/mockDatabase.js` and `frontend/src/utils/matchmaker.js` were removed (matching lives in `backend/services/matching.js`).

## Not done yet

UTD NetID single sign-on, Course Book import, email delivery, and survey file uploads (see `backend/README.md`).

## ui-overhaul ← main (PR #14, Nov 2026)

`main` had grown its own backend (`routes/apiHelpers.js`, no login tokens) and a front end wired to it. Every
route it added already existed in ui-overhaul, so ui-overhaul's structure was kept and main's behavior ported in:

- **Matching engine** (Scott's `backend/matching/matchmaker.js` + its unit tests) now drives observer lists through
  `services/matching.js`: committee members left off lists, same-course teachers ranked first, then workload,
  unreadable timings treated as conflicts.
- **Generate / top up all lists** for a term: `POST /api/observer-matches/generate` and a button on the Signup monitor.
- **Manual assignment warnings**: `select-observer` returns `meta.warnings` for broken rules; the UI shows them.
- **Login**: name-based usernames (`jsmith`) work alongside NetIDs; passwords hashed by main's scripts (hex salt) are accepted.
- `setup-demo-logins.js` sets `Password123!`. Course-section validation (3-digit section, `MW|TT HH:MM-HH:MM`, cycle must
  exist), new cycles copy the latest earlier template, extra fields on due-professors and evaluation-status.
- Survey submit button is disabled while sending. Vite proxies to `127.0.0.1:5000`.
- Removed: `routes/apiHelpers.js`, `templates/<Term>.json` (numeric ids didn't match seeded ratings), the mock
  `frontend/src/data/mockDatabase.js` and `frontend/src/utils/matchmaker.js` (the UI reads from the API).
