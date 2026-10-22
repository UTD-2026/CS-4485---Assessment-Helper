# CS 4485 – Assessment Helper

**NOTE: Everything below is subject to change, and will be constantly updating as time passes.**

A centralized platform for managing faculty evaluations, course histories, and peer-observation workflows. The platform is proposed to replace manual scheduling and email coordination for a teaching staff of roughly 100 instructors by automating evaluation scheduling, generating observer lists through focus-area matching, tracking observation agreements and submissions, and presenting role-scoped dashboards to professors and the evaluation committee, with a proof-of-concept integration with the UTD Course Book API suggested for pulling course and schedule data.

> **Status:** Front-end prototype.

## Features (current prototype)

**Login**
- NetID / username sign-in screen

**Professor Portal**
- **My Cycle:** evaluation status and Step 1 course sign-up (course/section and meeting days/time)
- **Observer Status:** Step 2 (request observers from eligible colleagues) and Step 3 (confirm or decline matches)
- **My Duties:** observer-side upload of the signed observation template (PDF)
- **End Survey:** end-of-cycle feedback form

**Committee / Admin Portal**
- **Faculty Search:** name search, department/status filters, and export of filtered results to CSV
- **Committee Reports:** due/overdue counts by hiring level, unmatched faculty, outstanding observations, and observer workload, each exportable to CSV
- **Matchmaking:** generate observer lists, notify faculty, and flag faculty with no eligible observers
- **Metrics (KPIs):** participation rate, list sufficiency, and overdue evaluations
- **Deadlines:** faculty due report with reminders

## Tech Stack

Committee reports use the current semester and live in-memory workflow state. Unmatched faculty are due/overdue professors without a non-missed observer assignment. Outstanding observations include every assignment not marked Completed. Average workload is total assignments (including missed sessions) divided by observers with at least one assignment; faculty with zero assignments remain visible in the workload table. Workflow data resets when the page refreshes.

| Layer | Current | Planned |
|---|---|---|
| Front end | React 19, Vite | – |
| Back end | – | Node.js |
| Database | – | MySQL |
| Scheduled jobs | – | Python cron jobs |
| Auth | Mock login | - |
| External data | Sample data | - |
| Linting | oxlint | – |

## Getting Started

**Prerequisites:** [Node.js](https://nodejs.org/) (LTS recommended) and Git.

```bash
# 1. Clone the repository
git clone https://github.com/<owner>/CS-4485---Assessment-Helper.git
cd CS-4485---Assessment-Helper

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Vite prints the local URL when it starts, which is normally `http://localhost:5173/`.

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run oxlint |

## Demo Login

The login screen is a front-end placeholder. It does not check passwords; the username alone selects the role:

| Username | Opens |
|---|---|
| `professor` | Professor Portal |
| `admin` | Committee / Admin Portal |

The password field must be filled in, but any value is accepted.

## Project Structure

```
├── public/               # Static assets (favicon, icons)
├── src/
│   ├── assets/           # Images and SVGs
│   ├── App.jsx           # Login, Professor dashboard, and Admin dashboard
│   ├── App.css           # Global styles and component styling
│   ├── FeedbackSurvey.jsx# End-of-process survey component
│   ├── index.css
│   └── main.jsx          # React entry point
├── index.html
├── package.json
└── vite.config.js
```

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

## Process document workflow

- Assistant professors are due in the calendar year following their last evaluation (either semester) and overdue after that year. Associate/full professors are due in the same semester two years later.
- Signup adds a professor to this cycle’s observer pool. After the signup deadline, the committee uses **Signup Monitor → Generate Observer Lists**, then **Notify Observee: List Ready** for each signup. Lists contain up to five signed-up, same-department, same-course-level professors with no shared meeting-day/time conflict.
- Observees choose a class meeting date before the observation deadline, request colleagues, and choose one accepted observer. Other requests are cancelled. Observers see accepted requests awaiting final selection as well as final appointments.
- Observers upload a signed PDF (maximum 5 MB) before confirming completion. Observees can download it. Both participants must still confirm that the observation happened.
- The survey opens after the observation deadline for observees and assigned observers.
- Deadline checks use the browser’s current local date. The sample semester remains Spring 2027. For a demonstration, sign up faculty first, then set the signup deadline to a past date; keep the observation deadline and requested class meeting date in the future. Set the observation deadline to a past date to demonstrate surveys.
- Notifications are in-app list-release messages, not email. All workflow data and signed PDFs remain in browser memory and reset on refresh. Historical records, actual email delivery, and server-enforced access controls still require a backend.
