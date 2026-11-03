# CS 4485 – Assessment Helper

**NOTE: Everything below is subject to change, and will be constantly updating as time passes.**

A centralized platform for managing faculty evaluations, course histories, and peer-observation workflows. The platform is proposed to replace manual scheduling and email coordination for a teaching staff of roughly 100 instructors by automating evaluation scheduling, generating observer lists through focus-area matching, tracking observation agreements and submissions, and presenting role-scoped dashboards to professors and the evaluation committee, with a proof-of-concept integration with the UTD Course Book API suggested for pulling course and schedule data.

> **Status:** Full-stack prototype. React front end + Express/MongoDB API that follows the team's "API Endpoints" doc. Branch integration notes: [`MERGE_NOTES.md`](MERGE_NOTES.md).

## Features

**Login**
- NetID (or UTD email) + password, checked by the API (`POST /api/auth/login`), signed token kept for the browser tab
- Assessment Committee members open the Committee portal; all other faculty open the Professor portal

**Professor Portal**
- **My Cycle:** evaluation status from the server (Assistant: every calendar year; Associate/Full: every two years) and Step 1 course sign-up, which enters the observer pool and generates the observer list
- **Observee Status:** Step 2 (request observers from the released list), Step 3 (confirm one accepted observer), schedule the date (class meeting days/times only, before the observation deadline), pair confirmation, "Did Not Happen", "Could Not Complete Cycle"
- **My Duties:** accept/decline requests, fill in the digital evaluation (Save & Return drafts are stored on the server), mark the evaluation completed
- **My Evaluations:** submitted evaluations as observer and as observee, across terms
- **End Survey:** anonymous end-of-cycle survey, locked after the survey deadline
- **Notifications:** in-app inbox / archive, written by the server at every workflow step

**Committee / Admin Portal**
- **Live Metrics & KPIs:** eligibility accuracy, overdue count, participation, observer utilization, list sufficiency, missing observations, survey completion
- **Faculty Search:** name search, department/status filters, CSV export
- **Committee Reports:** due/overdue by hiring level, unmatched faculty, outstanding observations, observer workload (each exportable to CSV)
- **Signup Monitor:** view/regenerate observer lists, release lists, resolve manually, request end-of-process surveys
- **Deadlines:** sign-up, observation and survey deadlines for the current term (saved to the database; participants notified)
- **Template Editor:** per-term evaluation criteria saved to `backend/templates/<term>.json`
- **Digital Evaluations** and anonymous **Survey Responses**

## Getting Started

**Prerequisites:** [Node.js](https://nodejs.org/) 20.19+ and a MongoDB database (the team's Atlas cluster, or a local `mongod`).

```bash
# 1. Install the front end (workspace) and the backend
npm install
npm install --prefix backend

# 2. Configure the backend
cp backend/.env.example backend/.env      # then set MONGODB_URI and JWT_SECRET (never commit .env)
npm run backend:test-db                   # check the connection
npm run backend:setup-db                  # collections + indexes
npm run backend:seed                      # load backend/seed/seed-data.json (only into empty collections)

# 3. Run both (two terminals)
npm run backend:dev                       # API on http://127.0.0.1:5000  (try /api/health)
npm run dev                               # front end on http://localhost:5173 (proxies /api to the API)
```

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Create a production build in `frontend/dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run oxlint on the front end |
| `npm run backend:dev` / `backend:start` | Start the API (with / without auto-restart) |
| `npm run backend:test` | API tests (set `MONGODB_URI_TEST` to a local database for the end-to-end test) |
| `npm run backend:setup-db` / `backend:seed` / `backend:test-db` | Database setup, seeding, connection check |

## Test Login (seed data)

All seeded professors use the password `Password123!`. Sign in with the NetID (the part of the email before `@`).

| NetID | Good for trying |
|---|---|
| `ddr199513` | Committee portal (AC member) |
| `nal595463` | Observee with a released list and two pending requests |
| `jlh753843` | Observer with an incoming request and an appointment |
| `jdf262865` | Observee with a scheduled observation |

The seed's current term is **Fall 2026** (sign-up deadline 2026-09-18 has passed, so new sign-ups are closed until the committee moves the deadline on the Deadlines tab).

## API

Endpoints, request bodies and status codes: [`backend/README.md`](backend/README.md). They follow the team's API Endpoints doc; the few additions are marked "extension" there.

## Roadmap

**Core**
- Unified relational data model for teacher profiles, course metadata, and evaluation history
- Rule engine for evaluation scheduling based on hiring-level rules
- Focus-area matching algorithm for generating observer lists
- Assessment workflow state machine (request → accepted → confirmed → observed → submitted)
- Role-scoped dashboards backed by real data
- UTD Course Book API integration module
- UTD NetID login

**Stretch goals** (sequenced by dependency; the workflow state machine is the hook for several of them)
- Email notifications
- Workload analytics
- Role-based access control
- Exportable reports
- Calendar integration

## Contributing

1. Pull the latest changes: `git pull`
2. Create a feature branch: `git checkout -b <short-description>`
3. Commit your changes with a clear message
4. Push the branch and open a pull request for review before merging into `main`

## Team
- Hussnain Yasir
- Nicholas Kho
- Scott Tran
- Mikael Sagarwala
- Srikrupaa Sathiyanarayanan
- Kavyadharshini Seenuvasan
