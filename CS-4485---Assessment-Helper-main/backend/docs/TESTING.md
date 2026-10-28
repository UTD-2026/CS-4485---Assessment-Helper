# Testing, seed data and proof-of-concept exit criteria

## What runs where

| Command | What it does | Needs |
|---|---|---|
| `npm test` | 109 tests: rules, auth, the whole workflow, visibility, surveys, NetID, Course Book, contract | Node only |
| `npm run docs:check` | fails if `docs/openapi.json` is stale | Node only |
| `npm run test-db` / `setup-db` / `seed` | the real MongoDB path | MongoDB URI |

The tests load in-memory stand-ins for `mongoose`, `express` and `dotenv` (`test/support/`). The rules, workflow, auth and route
handlers are the real code; the stand-in database is strict but is **not MongoDB**.

## Seed-data strategy

- `seed/seed-data.json` (the team's file, unchanged): 100 professors, 264 sections, 8 cycles, 149 observations, 325 observer rows, 90 surveys. One big CS department.
- Loaded exactly as `seed/seed.mjs` loads it (raw inserts, date strings cast), with the clock pinned to the seed's "today" (2026-10-12) so results never depend on the real date.
- Situations the CS seed lacks (a department with 0 or 2 eligible colleagues) are created on the fly by `test/support/scenarios.js` (MATH / STAT / SE), never written to the seed file.
- Dev password for every seeded account: `Password123!`.

## End-to-end test ownership

| Area | Owner | Where |
|---|---|---|
| Rules, API, workflow, contract | Backend | `test/*.test.mjs` (CI) |
| Browser flows (login, sign up, request, sign, survey) against the running API | Frontend team | to be written with Playwright or Cypress against `docker compose up` + the seed |
| Real MongoDB smoke test | Whoever first runs the Atlas setup | the five `README` commands, then log in as `ddr199513` |

(Assign names here; the repo cannot know who owns what.)

## Proof-of-concept exit criteria

1. `npm test` green in CI on a clean checkout.
2. `docker compose up` or Atlas + `npm start`, then `GET /health` returns `ok: true` and `database: connected`.
3. Seeded committee member signs in (password and mock NetID) and `GET /api/me` shows the committee role.
4. One signup walks the whole path: signup, observer list, request, accept, schedule, record, observer signs, observee signs, survey, and the committee reads the report only after both signatures.
5. Survey answers contain no identity (`test/surveys.test.mjs`).
6. `docs/openapi.json` is current and the frontend builds against it.
7. Known gaps are written down (README Limits).
