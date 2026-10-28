# Deployment, CI and API documentation

The TA's guidance: a free host with no time limit is welcome, **otherwise localhost is acceptable**. We support both; the
localhost route is the one that has the fewest unknowns. Nothing below has been executed against a live MongoDB or a live
host by the author (see the README's Limits); treat the first run as the test.

## Option 1: localhost with npm (simplest)

```bash
cd backend
npm install
cp .env.example .env            # put your MongoDB Atlas (or local) URI in MONGODB_URI
npm run test-db && npm run setup-db && npm run seed
npm start                        # http://localhost:5000/health
```

## Option 2: localhost with Docker (API + MongoDB in one command)

```bash
cd backend
docker compose up --build -d              # API http://localhost:5000, MongoDB localhost:27017
docker compose run --rm setup-db          # collections and indexes (once)
docker compose run --rm seed              # committee seed data (once; refuses a non-empty database)
docker compose down -v                    # stop and wipe the data
```

The compose file sets `NODE_ENV=development` on purpose: that enables the mock NetID sign-in and the default JWT secret. Do not
publish this stack to the internet unchanged.

## Option 3: a free host (check the terms yourself)

- **API:** Render (`render.yaml` at the repo root; free web services sleep when idle, so the first request after a pause is slow, and the free tier has monthly limits).
- **Database:** MongoDB Atlas free M0 cluster (512 MB; the whole seed is a few MB). Create a database user, allow the host's IP (or 0.0.0.0/0 for a class project), and paste the `mongodb+srv://` string into `MONGODB_URI`.
- Free-tier terms change; read the providers' current pages before promising a "no time limit" host to the TA.
- Set on the host: `NODE_ENV=production`, `JWT_SECRET` (long and random), `CORS_ORIGINS` (the frontend's address), `NETID_MODE=off` (or `mock` plus `ALLOW_MOCK_NETID_IN_PRODUCTION=true` for a throwaway demo). In production the server refuses to start with the default secret or with an unapproved mock NetID.
- Run `setup-db` and `seed` once from your own machine pointed at the Atlas URI (`npm run setup-db`, `npm run seed`).

## Environment variables

All are listed with comments in `.env.example`. The important ones: `MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`,
`CONFIRMATION_MODE`, `NETID_MODE`, `COURSEBOOK_MODE`, `SURVEY_MIN_RESPONSES`.

## Health and operations

- `GET /health` reports `ok`, database state, confirmation mode, NetID mode and Course Book mode (no secrets).
- Background sweeps (expire stale requests, mark missed observations) run in the server every `JOBS_INTERVAL_MINUTES`. On a host that sleeps, set a scheduler to run `npm run jobs` or call `POST /api/admin/jobs/run`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: the whole test suite and a check that
`docs/openapi.json` is current. It needs no database and no secrets because the tests use in-memory stand-ins. Locally: `npm test`, `npm run docs:check`.

## API documentation

- Live: `GET /api/docs/openapi.json` (no login).
- File: `docs/openapi.json`, rebuilt by `npm run docs`.
- It is generated from `docs/openapi.js`, and `test/contract.test.mjs` fails if a route exists but is undocumented, a documented route is missing, the stated access level is not what the server enforces, an example no longer matches a real response, or the committed JSON is stale.
