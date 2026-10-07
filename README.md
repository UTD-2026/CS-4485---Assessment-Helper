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
- **Matchmaking:** generate observer lists, notify faculty, and flag faculty with no eligible observers
- **Metrics (KPIs):** participation rate, list sufficiency, and overdue evaluations
- **Deadlines:** faculty due report with reminders

## Tech Stack

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
