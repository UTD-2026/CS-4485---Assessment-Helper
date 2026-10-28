# What the frontend needs to change

We did not touch the frontend. This is the list for whoever owns it. The full contract is `docs/openapi.json`
(also served at `GET /api/docs/openapi.json`; import it into Swagger UI or Postman). Every response example in it is checked
against the real responses by `test/contract.test.mjs`.

## 1. Basics (affects every screen)

| # | Change | Why |
|---|---|---|
| 1 | Replace the mock data with calls to the API. Set the base URL in one place (default `http://localhost:5000`). Send `Authorization: Bearer <token>` on everything except login and `/health`. | Backend is complete; mocks are no longer needed. |
| 2 | Identify a course section by the string **`sectionId`** (`CS 2117~001~Fall 2026`), not by a numeric or Mongo id. URL-encode it in paths. | The team's schema has no section `_id`. |
| 3 | Read **camelCase** (`courseCode`, `observerEmail`). The database is snake_case; the API converts. Keys inside `ratings` and form `fields` are the committee's own and are never renamed. | `middleware/present.js` |
| 4 | Errors are `{ error, code, details? }`. Branch on `code`, show `error`. | Stable codes such as `OBSERVER_MUST_SIGN_FIRST`, `SIGNUP_CLOSED`. |
| 5 | After login call **`GET /api/me`** (and `/api/me/permissions`) and drive menus from `roles` and `permissions`, not from guessing `isAcMember`. | TA asked for `GET /me` and `GET /me/permissions`. |
| 6 | Use `hireLevelLabel` ("Assistant") for display and `hireLevel` ("assistant") for logic. | Display name is no longer derived in the browser. |

## 2. Lists: pagination

Lists that can grow (`/api/admin/audit-log`, `/api/cycles/:term/eligible-faculty`, `/api/surveys` for the committee, and all
new lists) always return `{ ..., pagination: { page, pageSize, total, totalPages, hasNext } }`. Send `?page=1&pageSize=25`
(default 25, at most 100). The older lists (`/api/professors`, `/api/sections`, `/api/notifications`) stay unpaged until you
send `page` or `pageSize`, so existing screens keep working.

## 3. Sign-in

- Keep the password form (`POST /api/auth/login`, accepts a NetID or an email).
- For the NetID button: `GET /api/auth/providers` says whether it exists. In the proof of concept (`NETID_MODE=mock`) the
  frontend plays the identity provider's part: `POST /api/auth/netid/mock/ticket {netId}` then
  `POST /api/auth/netid/callback {ticket}` returns the same `{ token, professor }` as login. A ticket works once and lives
  `NETID_TICKET_SECONDS` (default 120). When UTD approves real single sign-on, only the first step changes (a redirect to UTD
  instead of the mock ticket); the callback and everything after it stay.
- Hide the NetID button when `providers` has no enabled `netid`.

## 4. Course sign-up and eligibility

- Signup screen: `GET /api/course-offerings?term=&department=&level=&q=` (filters by term, department, course level). Your own sections: `GET /api/sections`.
- Committee "who is due": `GET /api/cycles/:term/eligible-faculty` gives each person `status` (`due | overdue | not_due`), a
  plain-English `reason`, `blockers` (`NO_SECTIONS_THIS_TERM`, `ALREADY_SIGNED_UP`, `SIGNUP_CLOSED`), `canSignUp` and
  `ruleVersion`. Show `reason` as is. Per person: `GET /api/professors/:email/eligibility`.
- Show due/overdue from the API (`status`); do not recompute it in the browser.
- Times are shown to people in 12-hour form; the API accepts `8:30 AM` or `08:30` and returns `startTime`/`endTime` as 24-hour `HH:MM`. Format for display in the browser.

## 5. Observer lists and requests

- `GET /api/observations/:sectionId/candidates` now also returns `eligibleCount` and `flag` (`OK`, `INSUFFICIENT_OBSERVERS`
  = fewer than five eligible so everyone is listed, `NO_ELIGIBLE_OBSERVER`). Show a banner on the flags. The committee alert list is `GET /api/cycles/:term/insufficient-observers?includeFew=true`.
- **Two confirmation modes** (a server setting, `CONFIRMATION_MODE`; ask `/health`, which reports it as `confirmationMode`):
  - `first_wins` (default): the first `CONFIRM` ends it; the others are told automatically.
  - `observee_final`: `CONFIRM` only records "accepted" (the reply has `match.status: "accepted"` and
    `awaitingObserveeConfirmation: true`). The observee sees who accepted through each candidate's `status` in
    `GET /api/observations/:sectionId/candidates`, then calls `POST /api/observation-requests/:sectionId/finalize {observerEmail}`.
    `GET /api/overview` shows the action `CHOOSE_FINAL_OBSERVER` for the observee once someone accepted. Build the picker only if the committee chooses this mode.
- Match statuses now include `accepted`.

## 6. Observation: scheduling, report, signing

- Schedule with `PATCH /api/observations/:sectionId/schedule {observationDate, observationTime?}`. `observationTime` is the class start; if omitted the server uses it.
- **The observee signs only after the observer.** Disable the observee's Sign button until `report.observerSigned` is true; otherwise the server answers 409 `OBSERVER_MUST_SIGN_FIRST`.
- **Report visibility** (the committee's rule: observer always; observee after the observer signs; committee after both sign).
  Every observation object has `report: { canView, reason, message, started, observerSigned, observeeSigned }`. Render the
  report only when `report.canView`; otherwise show `report.message`. When it is hidden the server also leaves out `record`,
  `ratings` and `summary`, so the frontend cannot leak them. The signed-PDF download follows the same rule (403 if hidden).
- **"Did Not Happen" button:** `POST /api/observations/:sectionId/report-not-held {reason}` (observer or observee, on or after
  the scheduled day). The observation becomes `missed` and can be rescheduled. `missedReason`, `missedReportedBy` and `missedDate` are returned.
- Calendar download `GET /api/observations/:sectionId/calendar.ics` now uses the chosen time (default length 75 minutes).

## 7. Survey (anonymous)

- Render the form from `GET /api/surveys/templates/active` (versioned questions with `key`, `label`, `type` = `yes_no | rating | text`, `required`). Do not hard-code the questions.
- Before showing the form call `GET /api/surveys/status?term=` (`eligible`, `submitted`, `closed`, `canSubmit`, `deadline`).
- Submit with `POST /api/surveys {term, <question key>: value, ...}`. The reply only says it was received. After that `/api/surveys/mine` only tells you which terms you finished; there is no way to read your own answers back, by design.
- **Committee screen:** `GET /api/surveys?term=` returns counts always, but `responses` and `summary` only once at least
  `minResponsesForDetails` (default 3) people answered; before that `detailsWithheld` is true. Show "Results appear after 3 responses", not an error. Answers carry a random `responseId` and no name or date.
- The old fields `process_rating`, `positive_feedback`, `negative_feedback` are gone from the new flow.

## 8. Committee dashboard extras

- `GET /api/admin/audit-log` (who did what, filterable) for an Audit screen.
- `GET /api/admin/course-book/status` for an integration-health tile; `POST /api/admin/course-book/refresh`.
- Reports stay as CSV downloads under `/api/reports/*`.

## 9. Not done on the backend; needs a decision

- Real UTD single sign-on (needs UTD approval; the mock is a stand-in).
- Real Course Book data (needs the API key; the adapter and fallback are ready).
- Email delivery: notifications live in the database and show in the app only.
