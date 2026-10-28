// The rest of the API surface, plus how the backend treats the team's seeded ("legacy") documents.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createApp } from '../app.js';
import models from '../models/index.js';
import { setClock } from '../services/clock.js';
import { dueStatuses } from '../services/kpis.js';
import { sectionKey, parseSectionKey, findForSections } from '../services/lookup.js';
import { loadSeedWorld, makeClient } from './support/world.js';

const {
  CourseSection, EvaluationCycle, Notification, Observation, ObserverMatch, Professor,
} = models;
const TERM = 'Fall 2026';
const enc = encodeURIComponent;
let client; let data; let ac; const AC = () => client.as(ac.email);

before(async () => {
  data = await loadSeedWorld();
  client = makeClient(createApp());
  ac = data.professors.find((p) => p.is_ac_member);
});

test('seed data is internally consistent (so the backend can trust it)', async () => {
  const sectionKeys = new Set(data.courseSections.map(sectionKey));
  const obsKeys = new Set(data.observations.map(sectionKey));
  assert.equal(data.professors.length, 100);
  assert.equal(new Set(data.professors.map((p) => p.email)).size, 100);
  assert.equal(sectionKeys.size, data.courseSections.length, 'section keys are unique');
  assert.ok(data.observations.every((o) => sectionKeys.has(sectionKey(o))), 'every observation points at a real section');
  assert.equal(obsKeys.size, data.observations.length, 'one observation per section');
  assert.ok(data.observerMatches.every((m) => obsKeys.has(sectionKey(m))), 'every match belongs to an observation');
  assert.ok(data.courseSections.every((s) => data.professors.some((p) => p.email === s.instructor_email)));
  assert.ok(data.evaluationCycles.some((c) => c.term === TERM));
  const bySection = new Map(data.courseSections.map((s) => [sectionKey(s), s]));
  assert.ok(data.observations.filter((o) => o.status === 'completed').every((o) => o.observer_email && o.observation_date && o.ratings), 'completed observations are complete');
  assert.ok(data.observations.filter((o) => ['signed_up', 'unmatched'].includes(o.status)).every((o) => o.observer_email === null));
  // The team's seed has two rows where the observer is also the section's instructor (CS 3083~003~Fall 2025 and
  // CS 2495~001~Fall 2026). They are historical data; the backend never creates such a pairing (see the eligibility tests).
  const selfObserved = data.observations.filter((o) => bySection.get(sectionKey(o)).instructor_email === o.observer_email).map(sectionKey).sort();
  assert.deepEqual(selfObserved, ['CS 2495~001~Fall 2026', 'CS 3083~003~Fall 2025']);
});

test('sectionKey and parseSectionKey round-trip', () => {
  const sec = data.courseSections[0];
  const key = sectionKey(sec);
  assert.deepEqual(parseSectionKey(key), { course_code: sec.course_code, section_number: sec.section_number, term: sec.term });
  assert.equal(key, `${sec.course_code}~${sec.section_number}~${sec.term}`);
});

test('the team\'s foreign-key validators accept the seed (and reject a dangling reference)', async () => {
  const fk = (await import('../validators/foreignKeys.js')).default;
  for (const sec of data.courseSections) await fk.validateCourseSection(sec);
  for (const o of data.observations.filter((x) => x.observer_email)) await fk.validateObservation(o);
  for (const m of data.observerMatches) await fk.validateObserverMatch(m);
  for (const sv of data.surveys) await fk.validateSurvey(sv);
  await assert.rejects(() => fk.validateCourseSection({ ...data.courseSections[0], instructor_email: 'ghost@utdallas.edu' }), /Professor not found/);
  await assert.rejects(() => fk.validateObserverMatch({ ...data.observerMatches[0], section_number: '999' }), /Observation not found/);
});

test('cycles: create / duplicate / validation / list / current', async () => {
  const body = { term: 'Spring 2027', signupDeadline: '2027-02-05', observationDeadline: '2027-04-09', feedbackDeadline: '2027-04-30' };
  const made = await AC().post('/api/cycles', body);
  assert.equal(made.status, 201);
  assert.equal(made.body.cycle.phase, 'SIGNUP');
  assert.equal((await AC().post('/api/cycles', body)).status, 409);
  assert.equal((await AC().post('/api/cycles', { ...body, term: 'Summer 2027' })).status, 400, 'Summer is not enabled');
  assert.equal((await AC().post('/api/cycles', { ...body, term: 'Fall 2027', signupDeadline: '2027-10-01', observationDeadline: '2027-09-01' })).status, 400, 'out of order');
  assert.equal((await AC().post('/api/cycles', { ...body, term: 'Fall 2027', signupDeadline: '2027-02-30' })).status, 400, 'not a real date');
  const list = await client.as(data.professors[5].email).get('/api/cycles');
  assert.equal(list.body.cycles.length, 9);
  assert.equal(list.body.cycles.at(-1).term, 'Spring 2027');
  // creating next term's cycle early must NOT steal "current" from the one still in progress
  assert.equal((await AC().get('/api/cycles/current')).body.cycle.term, TERM);
  setClock('2026-12-05T12:00:00Z');
  assert.equal((await AC().get('/api/cycles/current')).body.cycle.term, 'Spring 2027', 'after Fall 2026 ends, the next cycle takes over');
  assert.equal((await AC().get(`/api/cycles/${enc('fall-2026')}`)).body.cycle.phase, 'CLOSED');
  setClock('2026-10-12T15:00:00Z');
  assert.equal((await AC().get('/api/cycles/Winter%202026')).status, 400);
  assert.equal((await AC().get('/api/cycles/Fall%202031')).status, 404);
});

test('due report, professors list and dashboard agree with each other', async () => {
  const report = (await AC().get(`/api/cycles/${enc(TERM)}/due-report`)).body;
  const list = (await AC().get(`/api/professors?term=${enc(TERM)}`)).body.professors;
  const dueInList = list.filter((p) => p.due.status !== 'not_due');
  assert.equal(report.count, dueInList.length);
  const dash = (await AC().get('/api/admin/dashboard-stats')).body;
  assert.equal(dash.facultyDueForEvaluation.total, report.count);
  assert.equal(dash.facultyDueForEvaluation.breakdown.reduce((n, r) => n + r.count, 0), report.count);
  const filtered = (await AC().get(`/api/professors?department=CS&hireLevel=full&term=${enc(TERM)}`)).body.professors;
  assert.ok(filtered.length > 0 && filtered.every((p) => p.department === 'CS' && p.hireLevel === 'full'));
  // a professor sees the same answer about themself
  const one = report.professors[0];
  const mine = (await client.as(one.email).get(`/api/professors/${enc(one.email)}/due-status`)).body;
  assert.equal(mine.status, one.status);
  assert.equal(mine.anniversary, one.anniversary);
});

test('due status on the seed: every verdict is explainable, and matches the committee rule', async () => {
  const sections = await CourseSection.find({}).lean();
  const observations = await Observation.find({}).lean();
  const professors = await Professor.find({}).lean();
  const due = dueStatuses({ professors, sections, observations, term: TERM });
  for (const p of professors) {
    const d = due.get(p.email);
    if (!d.baselineTerm) { assert.equal(d.status, 'overdue'); continue; }
    // independent re-derivation: terms since the baseline term
    const idx = { 'Spring': 0, 'Fall': 1 };
    const ord = (t) => Number(t.split(' ')[1]) * 2 + idx[t.split(' ')[0]];
    const gap = ord(TERM) - ord(d.baselineTerm);
    const expected = p.hire_level === 'assistant' ? (gap < 2 ? 'not_due' : gap <= 3 ? 'due' : 'overdue') : (gap < 4 ? 'not_due' : gap === 4 ? 'due' : 'overdue');
    assert.equal(d.status, expected, `${p.hire_level} last ${d.baselineTerm}`);
  }
});

test('sections + my signup + my observations views', async () => {
  const P = data.professors.find((p) => !p.is_ac_member);
  const mine = await client.as(P.email).get('/api/sections');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.term, TERM);
  assert.ok(mine.body.sections.every((s) => s.instructorEmail === P.email));
  const other = data.professors.find((p) => p.email !== P.email);
  assert.equal((await client.as(P.email).get(`/api/sections?instructorEmail=${enc(other.email)}`)).status, 403);
  assert.equal((await AC().get(`/api/sections?instructorEmail=${enc(other.email)}`)).status, 200);
  const signup = await client.as(P.email).get('/api/signups/mine');
  assert.equal(signup.status, 200);
  assert.ok('observation' in signup.body && Array.isArray(signup.body.mySections));
  const obs = await client.as(P.email).get('/api/observations/mine');
  assert.equal(obs.status, 200);
  assert.ok(Array.isArray(obs.body.asObservee) && Array.isArray(obs.body.asObserver));
  assert.equal((await client.as(P.email).get('/api/observations/not-an-id')).status, 400);
  assert.equal((await client.as(P.email).get(`/api/observations/${enc('CS 9999~001~Fall 2026')}`)).status, 404);
});

const termKeys = async () => new Set((await CourseSection.find({ term: TERM }).lean()).map(sectionKey));
const tripleOf = (d) => ({ course_code: d.course_code, section_number: d.section_number, term: d.term });

test('legacy seeded requests (no expiry stamped) can still be answered, and confirming still stands the others down', async () => {
  const keys = await termKeys();
  const requested = (await ObserverMatch.find({ status: 'requested' }).lean()).filter((m) => keys.has(sectionKey(m)));
  assert.ok(requested.length > 0, 'the seed has outstanding requests');
  const legacy = requested[0];
  assert.equal(legacy.expires_at ?? null, null);
  const sectionId = sectionKey(legacy);
  const before = (await ObserverMatch.find(tripleOf(legacy)).lean()).filter((m) => m.status === 'requested' || m.status === 'suggested');

  setClock('2027-01-01T00:00:00Z'); // far in the future: legacy rows never expire by the clock
  const r = await client.as(legacy.observer_email).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  setClock('2026-10-12T15:00:00Z');
  const after = await ObserverMatch.find(tripleOf(legacy)).lean();
  assert.equal(after.filter((m) => m.status === 'confirmed').length, 1);
  assert.ok(before.filter((m) => m.observer_email !== legacy.observer_email).every((m) => after.find((a) => a.observer_email === m.observer_email).status === 'cancelled'));
  const o = await Observation.findOne(tripleOf(legacy)).lean();
  assert.equal(o.status, 'scheduled');
  assert.equal(o.observer_email, legacy.observer_email);
});

test('the sweeps leave legacy rows alone: no expiry stamp = never auto-expired', async () => {
  setClock('2027-06-01T00:00:00Z');
  const before = await ObserverMatch.find({ status: 'requested' }).lean();
  const r = await AC().post('/api/admin/jobs/expire-requests');
  assert.equal(r.body.expiredCount, 0);
  assert.equal((await ObserverMatch.find({ status: 'requested' }).lean()).length, before.length);
  setClock('2026-10-12T15:00:00Z');
});

test('seeded scheduled/missed observations behave: a missed one can be rescheduled by its people', async () => {
  const sections = await CourseSection.find({ term: TERM }).lean();
  const byKey = new Map(sections.map((s) => [sectionKey(s), s]));
  const missed = (await Observation.find({ status: 'missed' }).lean()).find((o) => byKey.has(sectionKey(o)));
  assert.ok(missed, 'the seed has a missed observation in the current term');
  const section = byKey.get(sectionKey(missed));
  const { nextClassDay } = await import('./support/scenarios.js');
  const date = nextClassDay(section, '2026-10-13');
  const res = await client.as(section.instructor_email).patch(`/api/observations/${enc(sectionKey(missed))}/schedule`, { observationDate: date });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.observation.status, 'scheduled');
  // and the observer can then start the form copy for a seeded observation that has no `record` yet
  const rec = await client.as(missed.observer_email).post(`/api/observations/${enc(sectionKey(missed))}/record`);
  assert.equal(rec.status, 201, JSON.stringify(rec.body));
  assert.equal(rec.body.observation.record.criteria.length, 6);
});

test('reminders: due vs overdue, only people who have not signed up; survey reminder', async () => {
  const report = (await AC().get(`/api/cycles/${enc(TERM)}/due-report`)).body.professors;
  const expectDue = report.filter((p) => p.status === 'due' && !p.signedUp);
  const expectOverdue = report.filter((p) => p.status === 'overdue' && !p.signedUp);
  assert.equal((await AC().post(`/api/cycles/${enc(TERM)}/send-due-reminders`, { reminderType: 'BOGUS' })).status, 400);
  const d = await AC().post(`/api/cycles/${enc(TERM)}/send-due-reminders`, { reminderType: 'DUE_REMINDER' });
  assert.equal(d.body.notified, expectDue.length);
  const o = await AC().post(`/api/cycles/${enc(TERM)}/send-due-reminders`, { reminderType: 'OVERDUE_REMINDER' });
  assert.equal(o.body.notified, expectOverdue.length);
  const sample = expectOverdue[0];
  const n = (await Notification.find({ recipient_email: sample.email }).lean()).filter((x) => x.type === 'OVERDUE_REMINDER');
  assert.equal(n.length, 1);
  assert.match(n[0].message, /overdue/);
  assert.match(n[0].message, /2026-09-18/);

  const survey = await AC().post(`/api/cycles/${enc(TERM)}/notify-survey`);
  const completed = (await Observation.find({ status: 'completed' }).lean()).length;
  assert.equal(survey.status, 200);
  assert.ok(survey.body.notified > 0 && survey.body.notified <= completed);
});

test('signups listing for the AC has everything the committee asked for', async () => {
  const r = (await AC().get(`/api/cycles/${enc(TERM)}/signups`)).body;
  const keys = await termKeys();
  const expected = (await Observation.find({}).lean()).filter((o) => keys.has(sectionKey(o))).length;
  assert.ok(expected > 0);
  assert.equal(r.count, expected);
  assert.equal(r.signups.length, r.count);
  const row = r.signups[0];
  for (const f of ['sectionId', 'courseCode', 'sectionNumber', 'days', 'startTime', 'endTime', 'observeeName', 'observeeEmail', 'status']) assert.ok(f in row, f);
  assert.equal((await client.as(data.professors.find((p) => !p.is_ac_member).email).get(`/api/cycles/${enc(TERM)}/signups`)).status, 403);
});

test('cycle phases follow the calendar', async () => {
  const phase = async (iso) => { setClock(iso); return (await AC().get(`/api/cycles/${enc(TERM)}`)).body.cycle.phase; };
  assert.equal(await phase('2026-09-18T23:59:00Z'), 'SIGNUP', 'the deadline day itself is still open');
  assert.equal(await phase('2026-09-19T00:01:00Z'), 'OBSERVATION');
  assert.equal(await phase('2026-11-13T22:00:00Z'), 'OBSERVATION');
  assert.equal(await phase('2026-11-14T00:01:00Z'), 'FEEDBACK');
  assert.equal(await phase('2026-12-01T00:01:00Z'), 'CLOSED');
  setClock('2026-10-12T15:00:00Z');
  assert.ok((await EvaluationCycle.countDocuments({})) >= 8);
});
