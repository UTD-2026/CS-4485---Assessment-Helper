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
- **Signup Monitor:** generate or top up every observer list at once (same department, same course level, no class at that time), view/regenerate single lists, release lists, assign an observer manually (with a warning when it breaks a matching rule)
- **Deadlines:** sign-up, observation and survey deadlines for the current term (saved to the database; participants notified)
- **Template Editor:** per-term evaluation criteria saved to `backend/templates/<term>.json`
- **Digital Evaluations** and anonymous **Survey Responses**

## Getting Started

**Prerequisites:** [Node.js](https://nodejs.org/) 20.19+ and a MongoDB database (the team's Atlas cluster, or a local `mongod`).

### Team setup (shared Atlas database)

Follow these steps once on each computer, in order.

**1. Install dependencies.** The root install only covers the front end, so the backend needs its own install:

```bash
npm install
npm install --prefix backend
```

**2. Create `backend/.env`.** This file is git-ignored, so `git pull` does not give it to you. Copy the example:

```bash
cp backend/.env.example backend/.env
```

Then fill it in:

```
MONGODB_URI=mongodb+srv://<db-user>:<db-password>@assessmenthelper.rmnovya.mongodb.net/<db-name>?retryWrites=true&w=majority
PORT=5000
JWT_SECRET=<any long random string>
```

- Get the real `MONGODB_URI` from a teammate in a private message. Never commit it or post it in a public channel.
- `JWT_SECRET` can be any long random string, and each person can use their own. One way to generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

**3. Check the connection.**

```bash
npm run backend:test-db
```

The shared database is already set up and seeded, so you don't need `backend:setup-db` or `backend:seed`. They are only for a new, empty database. Running them is still safe, because seeding only fills empty collections.

**4. Start both servers, each in its own terminal, and leave both running:**

```bash
npm run backend:dev     # API on http://127.0.0.1:5000  (check http://127.0.0.1:5000/api/health)
npm run dev             # app on http://localhost:5173
```

**5. Sign in.** Open http://localhost:5173 and sign in with a test account (see [Test Login](#test-login-seed-data) below).

### Local database instead (optional)

If you can't reach Atlas, you can install [MongoDB Community Server](https://www.mongodb.com/try/download/community) and run it locally:

1. Set `MONGODB_URI=mongodb://127.0.0.1:27017/assessment_helper` in `backend/.env`.
2. Run `npm run backend:setup-db`, then `npm run backend:seed`.

A local database is only on your computer, so teammates won't see your changes.

### Login troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| Login fails with a 502 or a network error | The backend isn't running | Run `npm run backend:dev` in a second terminal and keep it open |
| Backend crashes with `Cannot find module 'mongoose'` (or another package) | Backend dependencies aren't installed | `npm install --prefix backend` |
| Backend logs `MONGODB_URI` missing or `JWT_SECRET` errors | `backend/.env` is missing or empty | Create it as shown in step 2. The file must be in `backend/`, not the repo root |
| Backend logs `bad auth` / `authentication failed` | Wrong database username or password in `MONGODB_URI` | Check the user under **Database Access** in Atlas, and get the current URI from the team |
| Backend logs `Could not connect to any servers` / `IP that isn't whitelisted` | Your network can't reach Atlas | The Atlas **Network Access** list allows `0.0.0.0/0` (all IPs). If it still fails, your Wi-Fi may block port 27017, so try a phone hotspot or use a local database |
| "Invalid username or password" | Wrong credentials | Use the NetID (e.g. `ddr199513`), not the full name, with password `Password123!` |
| Changes you made don't show up for teammates | You're on a local database | Point `MONGODB_URI` at the shared Atlas cluster |

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
| `npm run backend:setup-demo-logins` | Reset every professor's password to `Password123!` (use if test logins stop working) |

## Test Login (seed data)

All seeded professors use the password `Password123!`. Sign in with the NetID (the part of the email before `@`). For the full list of accounts, click **"click here"** under *Test credentials* on the login page. Clicking a username fills it in.

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
