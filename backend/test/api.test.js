// End-to-end API test against a real MongoDB.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/assessment_helper_test npm test
// The test database is wiped and loaded with seed/seed-data.json. Skipped when MONGODB_URI_TEST is not set.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const URI = process.env.MONGODB_URI_TEST;
const skip = !URI || !/localhost|127\.0\.0\.1/.test(URI) ? "set MONGODB_URI_TEST to a local database to run" : false;

const DATE_FIELDS = new Set(["last_observed", "signup_deadline", "observation_deadline", "feedback_deadline", "signup_date",
  "observation_date", "observer_signed_date", "observee_signed_date", "requested_date", "submitted_date"]);
const cast = (doc) => Object.fromEntries(Object.entries(doc).map(([k, v]) =>
  [k, DATE_FIELDS.has(k) && typeof v === "string" ? new Date(`${v}T00:00:00.000Z`) : v]));

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

test("full observation workflow through the API", { skip }, async (t) => {
  process.env.MONGODB_URI = URI;
  process.env.CURRENT_TERM = "Fall 2026";
  const { createApp } = require("../app");
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed", "seed-data.json"), "utf8"));
  const map = { professors: "professors", courseSections: "coursesections", evaluationCycles: "evaluationcycles", observations: "observations", observerMatches: "observermatches", surveys: "surveys" };
  for (const [k, c] of Object.entries(map)) await mongoose.connection.db.collection(c).insertMany(seed[k].map(cast));
  for (const m of Object.values(mongoose.models)) await m.syncIndexes();

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => { server.close(); await mongoose.disconnect(); });

  const call = async (method, url, token, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (username) => (await call("POST", "/auth/login", null, { username, password: "Password123!" })).body.data.token;
  const enc = (s) => encodeURIComponent(s);

  // Auth
  assert.equal((await call("GET", "/professors")).status, 401);
  assert.equal((await call("POST", "/auth/login", null, { username: "ddr199513", password: "nope" })).status, 401);
  const ac = await login("ddr199513");

  // Login page test-accounts list: public, no secrets, committee first
  const accounts = (await call("GET", "/auth/test-accounts")).body.data;
  assert.ok(accounts.length > 0 && accounts.every((a) => a.netid && a.name && ["Committee", "Professor"].includes(a.role) && !("password_hash" in a) && !("email" in a)));
  assert.equal(accounts.find((a) => a.netid === "ddr199513").role, "Committee");
  assert.equal(accounts[0].role, "Committee");

  // Pick an observee: a due/overdue professor with a Fall 2026 section who has not signed up yet
  const profs = (await call("GET", "/professors", ac)).body.data;
  const obsNow = (await call("GET", "/observations?term=Fall%202026", ac)).body.data;
  const signed = new Set(obsNow.map((o) => o.observee_email));
  const sections = (await call("GET", "/course-sections?term=Fall%202026", ac)).body.data;
  const observee = profs.find((p) => p.evaluation_status.status !== "not_due" && !signed.has(p.email) && sections.some((s) => s.instructor_email === p.email) && !p.is_ac_member);
  assert.ok(observee, "a professor who can sign up");
  const section = sections.find((s) => s.instructor_email === observee.email);
  const key = `/observations/${enc(section.course_code)}/${section.section_number}/${enc("Fall 2026")}`;
  const prof = await login(observee.netid);

  // Professors cannot see committee reports
  assert.equal((await call("GET", "/reports/kpis", prof)).status, 403);

  // Sign-up is closed in the seed (deadline 2026-09-18) unless the committee moves it
  const closed = await call("POST", "/observations", prof, { course_code: section.course_code, section_number: section.section_number });
  if (iso(new Date()) > "2026-09-18") assert.equal(closed.status, 409);
  const far = iso(addDays(60));
  assert.equal((await call("PATCH", "/evaluation-cycles/Fall%202026", ac, { signup_deadline: iso(addDays(5)), observation_deadline: far, feedback_deadline: iso(addDays(90)) })).status, 200);

  const signup = await call("POST", "/observations", prof, { course_code: section.course_code, section_number: section.section_number });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  assert.equal((await call("POST", "/observations", prof, { course_code: section.course_code, section_number: section.section_number })).status, 409);

  // Make sure there is at least one candidate: switch the pool to everyone via regenerate (committee)
  const gen = await call("POST", `${key}/generate-observer-list`, ac);
  assert.equal(gen.status, 201);
  let candidates = gen.body.data.candidates;

  if (!candidates.length) {
    // No eligible colleague in the pool: committee assigns someone manually
    const other = profs.find((p) => p.email !== observee.email);
    assert.equal((await call("POST", `${key}/select-observer`, ac, { observer_email: other.email })).status, 200);
    candidates = [{ observer_email: other.email }];
  } else {
    // Requests are blocked until the list is released
    assert.equal((await call("POST", `${key}/observer-requests`, prof, { observer_emails: [candidates[0].observer_email] })).status, 409);
    assert.equal((await call("POST", `${key}/release-observer-list`, ac)).status, 200);
    const reqs = await call("POST", `${key}/observer-requests`, prof, { observer_emails: [candidates[0].observer_email] });
    assert.equal(reqs.status, 201);
    const observerProf = profs.find((p) => p.email === candidates[0].observer_email);
    const obsToken = await login(observerProf.netid);
    const incoming = (await call("GET", "/observer-matches?status=requested", obsToken)).body.data;
    assert.ok(incoming.some((m) => m.observee_email === observee.email));
    // Only the requested observer may respond
    assert.equal((await call("PATCH", `/observer-matches/${enc(section.course_code)}/${section.section_number}/${enc("Fall 2026")}/${candidates[0].observer_email}/response`, prof, { response: "accept" })).status, 403);
    assert.equal((await call("PATCH", `/observer-matches/${enc(section.course_code)}/${section.section_number}/${enc("Fall 2026")}/${candidates[0].observer_email}/response`, obsToken, { response: "accept" })).status, 200);
    const sel = await call("POST", `${key}/select-observer`, prof, { observer_email: candidates[0].observer_email });
    assert.equal(sel.status, 200);
    assert.equal(sel.body.data.status, "matched");
  }

  const observerEmail = candidates[0].observer_email;
  const observerToken = await login(observerEmail.split("@")[0]);

  // Schedule: must be a class meeting day, not in the past, not after the deadline
  const meets = (d) => {
    const code = ["U", "M", "T", "W", "R", "F", "S"][d.getDay()];
    const days = section.timing.split(" ")[0];
    return (days === "TT" ? "TR" : days).includes(code);
  };
  let day = addDays(1);
  while (!meets(day)) day = new Date(day.getTime() + 86400000);
  let wrong = addDays(1);
  while (meets(wrong)) wrong = new Date(wrong.getTime() + 86400000);
  assert.equal((await call("PATCH", key, prof, { observation_date: iso(wrong) })).status, 400);
  const sched = await call("PATCH", key, prof, { observation_date: iso(day), observation_time: section.timing.split(" ")[1].split("-")[0] });
  assert.equal(sched.status, 200, JSON.stringify(sched.body));
  assert.equal(sched.body.data.status, "scheduled");

  // Evaluation: observer cannot confirm before submitting; draft then submit
  assert.equal((await call("PATCH", `${key}/form`, observerToken, { observer_signed: true })).status, 409);
  const template = (await call("GET", "/evaluation-cycles/Fall%202026/template", observerToken)).body.data.criteria;
  const answers = Object.fromEntries(template.map((c) => [c.id, { rating: c.ratingScale.startsWith("1") ? "4" : c.ratingScale.startsWith("Yes") ? "Yes" : undefined, notes: "Good class" }]));
  assert.equal((await call("PATCH", `${key}/form`, observerToken, { ratings: { [template[0].id]: { rating: "3" } }, draft: true })).status, 200);
  const asObserver = (await call("GET", key, observerToken)).body.data;
  assert.ok(asObserver.evaluation_draft, "draft visible to observer");
  assert.equal((await call("GET", key, prof)).body.data.evaluation_draft, undefined, "draft hidden from observee");
  assert.equal((await call("PATCH", `${key}/form`, observerToken, { ratings: answers, submit: true })).status, 200);
  assert.equal((await call("PATCH", `${key}/form`, observerToken, { observer_signed: true })).body.data.status, "awaiting_confirmation");
  const done = await call("PATCH", `${key}/form`, prof, { observee_signed: true });
  assert.equal(done.body.data.status, "completed");
  assert.ok(done.body.data.ratings[template[0].id]);

  // Survey: once, anonymous; "not OK" needs both written answers
  assert.equal((await call("POST", "/surveys", prof, { process_ok: false, difficulties: "  ", improvements: "More time" })).status, 400);
  assert.equal((await call("POST", "/surveys", prof, { process_ok: true, difficulties: "", improvements: "More time" })).status, 201);
  assert.equal((await call("POST", "/surveys", prof, { process_ok: true })).status, 409);
  const responses = (await call("GET", "/surveys/responses?term=Fall%202026", ac)).body.data;
  assert.ok(responses.length > 0 && responses.every((r) => !("professor_email" in r)));
  assert.ok(responses.every((r) => r.submitted_at === null || !Number.isNaN(Date.parse(r.submitted_at))));
  assert.equal((await call("GET", "/surveys/status", prof)).body.data.submitted, true);

  // Survey close time on the feedback deadline
  assert.equal((await call("PATCH", "/evaluation-cycles/Fall%202026", ac, { feedback_deadline_time: "25:00" })).status, 400);
  assert.equal((await call("PATCH", "/evaluation-cycles/Fall%202026", ac, { feedback_deadline_time: "17:30" })).body.data.feedback_deadline_time, "17:30");
  assert.equal((await call("GET", "/surveys/status", prof)).body.data.deadline_time, "17:30");
  assert.equal((await call("PATCH", "/evaluation-cycles/Fall%202026", ac, { feedback_deadline_time: null })).body.data.feedback_deadline_time, null);

  // Sign-up and observation close times work the same way
  assert.equal((await call("PATCH", "/evaluation-cycles/Fall%202026", ac, { signup_deadline_time: "9:00" })).status, 400);
  const timed = (await call("PATCH", "/evaluation-cycles/Fall%202026", ac, { signup_deadline_time: "09:00", observation_deadline_time: "17:00" })).body.data;
  assert.equal(timed.signup_deadline_time, "09:00");
  assert.equal(timed.observation_deadline_time, "17:00");
  const cleared = (await call("PATCH", "/evaluation-cycles/Fall%202026", ac, { signup_deadline_time: null, observation_deadline_time: null })).body.data;
  assert.equal(cleared.signup_deadline_time, null);
  assert.equal(cleared.observation_deadline_time, null);

  // Notifications
  const inbox = (await call("GET", "/notifications", prof)).body.data;
  assert.ok(inbox.some((n) => n.message.startsWith("Observation Completed")));
  assert.equal((await call("PATCH", `/notifications/${inbox[0].id}/archive`, prof)).status, 204);

  // Reports
  const kpis = (await call("GET", "/reports/kpis", ac)).body.data;
  assert.ok(kpis.participation_rate.denominator > 0);
  assert.equal((await call("GET", "/reports/outstanding-observations", ac)).status, 200);
  assert.equal((await call("GET", "/reports/unmatched-faculty?include=all_due", ac)).status, 200);
  assert.equal((await call("GET", `/professors/${observee.email}/evaluation-status`, ac)).body.data.signed_up, true);
});

test("due-status rule (committee spec)", () => {
  const { calculateDueStatus } = require("../services/dueStatus");
  assert.equal(calculateDueStatus("assistant", "Spring 2025", "Spring 2026").status, "due");
  assert.equal(calculateDueStatus("assistant", "Spring 2025", "Fall 2026").status, "due");
  assert.equal(calculateDueStatus("assistant", "Spring 2025", "Spring 2027").status, "overdue");
  assert.equal(calculateDueStatus("assistant", "Spring 2025", "Fall 2025").status, "not_due");
  assert.equal(calculateDueStatus("assistant", "Fall 2025", "Spring 2026").status, "due");
  for (const level of ["associate", "full"]) {
    assert.equal(calculateDueStatus(level, "Spring 2025", "Spring 2027").status, "due");
    assert.equal(calculateDueStatus(level, "Spring 2025", "Fall 2027").status, "overdue");
    assert.equal(calculateDueStatus(level, "Fall 2025", "Spring 2027").status, "not_due");
  }
  assert.equal(calculateDueStatus("full", null, "Fall 2026").status, "overdue");
});

test("eligibility rules", () => {
  const { evaluateEligibility, schedulesConflict } = require("../services/eligibility");
  const observee = { email: "a@x", department: "CS" };
  const section = { course_code: "CS 1337", timing: "MW 08:30-09:45" };
  const ok = { email: "b@x", department: "CS" };
  assert.equal(evaluateEligibility({ observee, candidate: observee, section, candidateSections: [] }).violation, "SAME_PROFESSOR");
  assert.equal(evaluateEligibility({ observee, candidate: { ...ok, department: "MATH" }, section, candidateSections: [] }).violation, "DIFFERENT_DEPARTMENT");
  assert.equal(evaluateEligibility({ observee, candidate: ok, section, candidateSections: [{ course_code: "CS 3345", timing: "TR 10:00-11:15" }] }).violation, "DIFFERENT_LEVEL");
  assert.equal(evaluateEligibility({ observee, candidate: ok, section, candidateSections: [{ course_code: "CS 1200", timing: "W 09:00-10:15" }] }).violation, "SCHEDULE_CONFLICT");
  assert.equal(evaluateEligibility({ observee, candidate: ok, section, candidateSections: [{ course_code: "CS 1200", timing: "TT 08:30-09:45" }] }).eligible, true);
  assert.equal(schedulesConflict("TT 10:00-11:15", "R 11:00-12:15"), true);
});
