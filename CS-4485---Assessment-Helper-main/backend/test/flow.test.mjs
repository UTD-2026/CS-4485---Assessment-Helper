// End-to-end workflow on the team's seed data, through the real routes, with time travel.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createApp } from '../app.js';
import models from '../models/index.js';
import { parseSectionKey, sectionKey } from '../services/lookup.js';
import { meetingOf } from '../services/eligibility.js';
import { now, setClock } from '../services/clock.js';
import { loadSeedWorld, makeClient } from './support/world.js';
import { addSmallDepartments, nextClassDay, nextNonClassDay, pickScenarios } from './support/scenarios.js';

const { CourseSection, EvaluationForm, Notification, Observation, ObserverMatch, Professor } = models;
const TERM = 'Fall 2026';
const tripleOf = (d) => ({ course_code: d.course_code, section_number: d.section_number, term: d.term });
const enc = encodeURIComponent;
const HOUR = 3600 * 1000;
const plusHours = (h) => setClock(new Date(now().getTime() + h * HOUR));

let client; let ac; let data; let sc; let NON_AC;
const AC = () => client.as(ac.email);

async function notificationsOf(email, type) {
  return (await Notification.find({ recipient_email: email }).lean()).filter((n) => !type || n.type === type);
}
async function matchStatuses(sectionId) {
  const rows = await ObserverMatch.find(parseSectionKey(sectionId)).lean();
  return Object.fromEntries(rows.map((m) => [m.observer_email, m.status]));
}
/** signup -> (AC generates the list) -> returns the candidate emails */
async function signupAndList(scenario) {
  const who = client.as(scenario.observee.email);
  const created = await who.post('/api/signups', { sectionId: sectionKey(scenario.section) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const gen = await AC().post(`/api/matching/generate/${enc(sectionKey(scenario.section))}`);
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  const list = await who.get(`/api/observations/${enc(sectionKey(scenario.section))}/candidates`);
  assert.equal(list.status, 200);
  return { who, sectionId: sectionKey(scenario.section), generated: gen.body, candidates: list.body.candidates.map((c) => c.observerEmail), list: list.body };
}

before(async () => {
  data = await loadSeedWorld();
  client = makeClient(createApp());
  ac = data.professors.find((p) => p.is_ac_member);
  NON_AC = data.professors.find((p) => !p.is_ac_member).email; // a professor who is certainly not on the committee
  await addSmallDepartments(TERM); // the seed has no 'nobody qualifies' / 'a couple qualify' situations, so add tiny departments
  sc = await pickScenarios(TERM, { many: 3, few: 2, none: 1 });
  assert.ok(sc.many.length === 3 && sc.few.length === 2 && sc.none.length === 1, 'the seed data should contain all three situations');
});

test('signup is closed after the deadline; AC can extend it; only your own class; one signup per term', async () => {
  const P = sc.many[0];
  const closed = await client.as(P.observee.email).post('/api/signups', { sectionId: sectionKey(P.section) });
  assert.equal(closed.status, 409);
  assert.equal(closed.body.code, 'SIGNUP_CLOSED');

  const ext = await AC().put(`/api/cycles/${enc(TERM)}`, { signupDeadline: '2026-10-20' });
  assert.equal(ext.status, 200);
  assert.equal(ext.body.cycle.phase, 'SIGNUP');
  assert.equal((await AC().put(`/api/cycles/${enc(TERM)}`, { signupDeadline: '2026-12-31' })).status, 400, 'deadlines must stay in order');

  // somebody else's class
  const other = sc.many[1];
  const stolen = await client.as(P.observee.email).post('/api/signups', { sectionId: sectionKey(other.section) });
  assert.equal(stolen.status, 403);
  assert.equal((await client.as(P.observee.email).post('/api/signups', { sectionId: 'not-an-id' })).status, 400);
  assert.equal((await client.as(P.observee.email).post('/api/signups', {})).status, 400);

  const ok = await client.as(P.observee.email).post('/api/signups', { sectionId: sectionKey(P.section) });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.observation.status, 'signed_up');
  assert.equal(ok.body.observation.observeeEmail, P.observee.email);
  const again = await client.as(P.observee.email).post('/api/signups', { sectionId: sectionKey(P.section) });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ALREADY_SIGNED_UP');

  // a professor with two classes still gets only one signup
  const mine = await CourseSection.find({ instructor_email: P.observee.email, term: TERM }).lean();
  for (const s of mine.filter((x) => sectionKey(x) !== sectionKey(P.section))) {
    assert.equal((await client.as(P.observee.email).post('/api/signups', { sectionId: sectionKey(s) })).status, 409);
  }
  const me = await client.as(P.observee.email).get('/api/signups/mine');
  assert.equal(me.body.observation.status, 'signed_up');
});

test('requests cannot be sent before observer selection has produced a list', async () => {
  const P = sc.many[0];
  const r = await client.as(P.observee.email).post('/api/observation-requests', { sectionId: sectionKey(P.section), observerEmails: [P.eligible[0].candidate.email] });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'NOTHING_SENT');
  assert.equal(r.body.details.rejected[0].reason, 'NOT_IN_CANDIDATE_LIST');
});

test('AC observer selection: refuses while signups are open, then picks all (<5) / random 5 (>=5) / none', async () => {
  const refused = await AC().post(`/api/cycles/${enc(TERM)}/run-observer-selection`);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'SIGNUP_STILL_OPEN');

  // sign the other scenario professors up first so one selection run handles everybody
  for (const s of [sc.many[1], sc.few[0], sc.few[1], sc.none[0]]) {
    assert.equal((await client.as(s.observee.email).post('/api/signups', { sectionId: sectionKey(s.section) })).status, 201, s.observee.name);
  }
  const run = await AC().post(`/api/cycles/${enc(TERM)}/run-observer-selection`, { force: true });
  assert.equal(run.status, 200);
  assert.ok(run.body.processed >= 5);
  assert.ok(run.body.unmatched >= 1);

  const listOf = async (s) => (await client.as(s.observee.email).get(`/api/observations/${enc(sectionKey(s.section))}/candidates`)).body;
  const eligibleSet = (s) => new Set(s.eligible.map((e) => e.candidate.email));

  const many = await listOf(sc.many[0]);
  assert.equal(many.candidates.length, 5, 'five or more eligible -> exactly 5 shown');
  assert.ok(many.candidates.every((c) => c.status === 'suggested' && eligibleSet(sc.many[0]).has(c.observerEmail)), 'all drawn from the eligible pool');
  assert.equal(many.observationStatus, 'signed_up');

  for (const s of sc.few) {
    const l = await listOf(s);
    assert.equal(l.candidates.length, s.eligibleCount, `${s.eligibleCount} eligible -> all ${s.eligibleCount} shown`);
    assert.deepEqual(l.candidates.map((c) => c.observerEmail).sort(), [...eligibleSet(s)].sort());
  }

  const none = await listOf(sc.none[0]);
  assert.equal(none.candidates.length, 0);
  assert.equal(none.observationStatus, 'unmatched');
  const alert = await AC().get(`/api/cycles/${enc(TERM)}/insufficient-observers`);
  assert.ok(alert.body.signups.some((x) => x.observeeEmail === sc.none[0].observee.email), 'AC alert lists the unmatched professor');
  const stuck = await client.as(sc.none[0].observee.email).post('/api/observation-requests', { sectionId: sectionKey(sc.none[0].section), observerEmails: ['x@utdallas.edu'] });
  assert.equal(stuck.status, 409);
  assert.equal(stuck.body.code, 'NOT_OPEN');

  // the list is random: regenerating gives a (usually) different five, always from the pool
  const seen = new Set([many.candidates.map((c) => c.observerEmail).sort().join()]);
  for (let i = 0; i < 12; i += 1) {
    await AC().post(`/api/matching/generate/${enc(sectionKey(sc.many[0].section))}`);
    const l = await listOf(sc.many[0]);
    assert.equal(l.candidates.length, 5);
    assert.ok(l.candidates.every((c) => eligibleSet(sc.many[0]).has(c.observerEmail)));
    seen.add(l.candidates.map((c) => c.observerEmail).sort().join());
  }
  if (sc.many[0].eligibleCount > 5) assert.ok(seen.size > 1, 'regenerating varies the five when more than five qualify');

  const preview = await AC().get(`/api/matching/preview/${enc(sectionKey(sc.many[0].section))}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.mode, 'random');
  assert.equal(preview.body.eligibleCount, sc.many[0].eligibleCount);
  assert.ok(preview.body.evaluations.some((e) => !e.eligible && e.violation && e.detail), 'every rejection carries a reason');

  const ready = await AC().post(`/api/cycles/${enc(TERM)}/notify-observer-lists-ready`);
  assert.equal(ready.status, 200);
  assert.ok(ready.body.notified >= 3);
  assert.equal((await notificationsOf(sc.many[0].observee.email, 'OBSERVER_LIST_READY')).length, 1);
  assert.equal((await AC().post(`/api/cycles/${enc(TERM)}/notify-observer-lists-ready`)).body.notified, 0, 'each professor is told once');
});

let main; // shared state for the main happy path

test('send requests: 48-hour expiry stamped, notifications sent, bad picks rejected', async () => {
  const P = sc.many[0];
  const who = client.as(P.observee.email);
  const list = (await who.get(`/api/observations/${enc(sectionKey(P.section))}/candidates`)).body.candidates.map((c) => c.observerEmail);
  assert.equal(list.length, 5);

  const outsider = data.professors.find((p) => !list.includes(p.email) && p.email !== P.observee.email).email;
  const mixed = await who.post('/api/observation-requests', { sectionId: sectionKey(P.section), observerEmails: [...list, outsider, list[0]] });
  assert.equal(mixed.status, 201);
  assert.equal(mixed.body.requested.length, 5, 'duplicates collapsed');
  assert.deepEqual(mixed.body.rejected.map((r) => r.reason), ['NOT_IN_CANDIDATE_LIST']);
  assert.equal(new Date(mixed.body.requested[0].expiresAt).getTime() - now().getTime(), 48 * HOUR);

  const rows = await ObserverMatch.find(tripleOf(P.section)).lean();
  assert.ok(rows.every((m) => m.status === 'requested' && m.requested_date && m.expires_at));
  for (const email of list) assert.equal((await notificationsOf(email, 'REQUEST_RECEIVED')).length, 1);

  const again = await who.post('/api/observation-requests', { sectionId: sectionKey(P.section), observerEmails: [list[0]] });
  assert.equal(again.status, 422);
  assert.equal(again.body.details.rejected[0].reason, 'ALREADY_REQUESTED');

  assert.equal((await client.as(list[0]).post('/api/observation-requests', { sectionId: sectionKey(P.section), observerEmails: [list[1]] })).status, 403, 'only the observee sends requests');

  const incoming = await client.as(list[0]).get('/api/observation-requests/incoming');
  const mine = incoming.body.requests.find((r) => r.sectionId === sectionKey(P.section));
  assert.equal(mine.status, 'requested');
  assert.equal(mine.hoursLeft, 48);
  assert.equal(mine.observee.email, P.observee.email);
  assert.equal(mine.section.courseCode, P.section.course_code);
  assert.equal(mine.section.days, meetingOf(P.section).days);
  assert.equal(mine.section.sectionId, sectionKey(P.section));
  main = { P, who, list, sectionId: sectionKey(P.section) };
});

test('a decline affects only that observer; the first CONFIRM wins and stands the others down', async () => {
  plusHours(47); // still inside the 48 hours
  const { who, list, sectionId, P } = main;

  const decline = await client.as(list[0]).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'DECLINE' });
  assert.equal(decline.status, 200);
  assert.deepEqual(await matchStatuses(sectionId), { [list[0]]: 'declined', [list[1]]: 'requested', [list[2]]: 'requested', [list[3]]: 'requested', [list[4]]: 'requested' });
  assert.equal((await client.as(list[0]).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' })).status, 409, 'cannot change a decline');
  assert.equal((await client.as(list[1]).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'MAYBE' })).status, 400);

  const confirm = await client.as(list[1]).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.deepEqual(confirm.body.autoCancelled.sort(), [list[2], list[3], list[4]].sort());
  assert.equal(confirm.body.observation.status, 'scheduled');
  assert.equal(confirm.body.observation.observerEmail, list[1]);
  assert.deepEqual(await matchStatuses(sectionId), { [list[0]]: 'declined', [list[1]]: 'confirmed', [list[2]]: 'cancelled', [list[3]]: 'cancelled', [list[4]]: 'cancelled' });

  for (const email of [list[2], list[3], list[4]]) assert.equal((await notificationsOf(email, 'REQUEST_DECLINED')).length, 1, 'stood-down observers are told');
  assert.equal((await notificationsOf(list[0], 'REQUEST_DECLINED')).length, 0, 'the decliner is not');
  assert.equal((await notificationsOf(P.observee.email, 'REQUEST_CONFIRMED')).length, 1);

  const late = await client.as(list[2]).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'NOT_PENDING');
  const cannotAsk = await who.post('/api/observation-requests', { sectionId, observerEmails: [list[2]] });
  assert.equal(cannotAsk.status, 409, 'once scheduled the observee cannot send more requests');
  assert.equal((await client.as(P.observee.email).get(`/api/observations/${enc(sectionId)}`)).body.observation.status, 'scheduled');
});

test('scheduling: must be a real future date, before the deadline, on a day the class meets', async () => {
  const { who, list, sectionId, P } = main;
  const sched = (user, observationDate) => user.patch(`/api/observations/${enc(sectionId)}/schedule`, { observationDate });
  assert.equal((await sched(who, undefined)).status, 400);
  assert.equal((await sched(who, '2026-13-45')).status, 400);
  assert.equal((await sched(who, '2026-10-01')).status, 400, 'past');
  assert.equal((await sched(who, '2026-11-20')).status, 400, 'after the observation deadline (2026-11-13)');
  const bad = await sched(who, nextNonClassDay(P.section, '2026-10-15'));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'NOT_A_CLASS_DAY');
  const stranger = data.professors.find((p) => ![P.observee.email, list[1]].includes(p.email) && !p.is_ac_member);
  assert.equal((await sched(client.as(stranger.email), nextClassDay(P.section, '2026-10-15'))).status, 403);

  const date = nextClassDay(P.section, '2026-10-15');
  const ok = await sched(who, date);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.observation.observationDate.slice(0, 10), date);
  assert.equal(ok.body.observation.status, 'scheduled');
  assert.equal((await notificationsOf(list[1], 'OBSERVATION_SCHEDULED')).length, 1, 'the other person is told');
  // the observer may move it too
  const later = nextClassDay(P.section, '2026-10-19');
  assert.equal((await sched(client.as(list[1]), later)).status, 200);
  main.date = later;
});

test('the observation record: only the observer, one copy, validated values, snapshot of the template version', async () => {
  const { who, list, sectionId } = main;
  const observer = client.as(list[1]);
  assert.equal((await who.post(`/api/observations/${enc(sectionId)}/record`)).status, 403, 'the observee does not fill the form');
  assert.equal((await observer.put(`/api/observations/${enc(sectionId)}/record`, { values: { organization: 4 } })).status, 404, 'no record yet');

  const created = await observer.post(`/api/observations/${enc(sectionId)}/record`);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const rec = created.body.observation.record;
  assert.equal(rec.formVersion, 1);
  assert.equal(rec.criteria.length, 6);
  assert.equal(rec.lockedAt, null);
  assert.equal((await observer.post(`/api/observations/${enc(sectionId)}/record`)).status, 409, 'a second copy is refused');

  assert.equal((await observer.put(`/api/observations/${enc(sectionId)}/record`, { values: { organization: 9 } })).status, 400);
  assert.equal((await observer.put(`/api/observations/${enc(sectionId)}/record`, { values: { whatever: 1 } })).status, 400);
  assert.equal((await observer.put(`/api/observations/${enc(sectionId)}/record`, {})).status, 400);
  assert.equal((await who.put(`/api/observations/${enc(sectionId)}/record`, { values: { organization: 4 } })).status, 403);

  const saved = await observer.put(`/api/observations/${enc(sectionId)}/record`, { values: { organization: 4, studentEngagement: 5, comments: 'Strong discussion.' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.observation.ratings, { organization: 4, studentEngagement: 5 }, 'mirrored into the team\'s `ratings` field');
  assert.equal(saved.body.observation.record.criteria.find((c) => c.key === 'comments').value, 'Strong discussion.');
  assert.equal(saved.body.observation.summary.ratedCount, 2);
});

test('AC edits the template -> version 2; the copy already in progress keeps version 1', async () => {
  const { sectionId, list } = main;
  const edit = {
    title: 'Peer Teaching Observation (revised)',
    fields: [
      { key: 'organization', label: 'Organization', type: 'rating', min: 1, max: 5, weight: 2, required: true },
      { key: 'rapport', label: 'Rapport with students', type: 'rating', min: 1, max: 10, required: true },
      { key: 'comments', label: 'Comments', type: 'text', required: false },
    ],
  };
  assert.equal((await client.as(NON_AC).put('/api/forms/observation', edit)).status, 403);
  assert.equal((await AC().put('/api/forms/observation', { fields: [{ key: 'bad key', label: 'x', type: 'text' }] })).status, 400);
  assert.equal((await AC().put('/api/forms/observation', {})).status, 400);
  const ok = await AC().put('/api/forms/observation', edit);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.form.version, 2);
  assert.equal((await client.as(list[1]).get('/api/forms/observation')).body.form.version, 2, 'anyone logged in can read the current template');

  const view = await client.as(list[1]).get(`/api/observations/${enc(sectionId)}`);
  assert.equal(view.body.observation.record.formVersion, 1, 'the observation in progress keeps its version');
  assert.equal(view.body.observation.record.criteria.length, 6);
  assert.equal(view.body.observation.record.criteria.find((c) => c.key === 'organization').weight, 1, 'old weight preserved too');
});

test('signing: not before the date, required fields enforced, first signature locks, second completes', async () => {
  const { who, list, sectionId, P } = main;
  const observer = client.as(list[1]);
  const sign = (user) => user.post(`/api/observations/${enc(sectionId)}/sign`);

  const early = await sign(observer);
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'TOO_EARLY');

  setClock(`${main.date}T16:00:00Z`); // the day of the observation
  const missing = await sign(observer);
  assert.equal(missing.status, 422);
  assert.equal(missing.body.code, 'REQUIRED_MISSING');
  assert.deepEqual(missing.body.details.missing.sort(), ['classroomEnvironment', 'clarityOfInstruction', 'useOfMaterials'].sort());

  const filled = await observer.put(`/api/observations/${enc(sectionId)}/record`, { values: { clarityOfInstruction: 4, useOfMaterials: 3, classroomEnvironment: 5 } });
  assert.equal(filled.status, 200);
  const outsider = data.professors.find((p) => ![P.observee.email, list[1]].includes(p.email)).email;
  assert.equal((await client.as(outsider).post(`/api/observations/${enc(sectionId)}/sign`)).status, 403, 'a non-participant cannot sign');

  const first = await sign(observer);
  assert.equal(first.status, 200);
  assert.equal(first.body.completed, false);
  assert.ok(first.body.observation.observerSignedDate);
  assert.ok(first.body.observation.record.lockedAt, 'first signature locks the record');
  assert.equal((await notificationsOf(P.observee.email, 'SIGNATURE_NEEDED')).length, 1);

  const edit = await observer.put(`/api/observations/${enc(sectionId)}/record`, { values: { organization: 1 } });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.code, 'RECORD_LOCKED');
  assert.equal((await sign(observer)).status, 409, 'cannot sign twice');
  assert.equal((await observer.post(`/api/observations/${enc(sectionId)}/record`)).status, 409, 'no second copy');
  assert.equal((await observer.patch(`/api/observations/${enc(sectionId)}/schedule`, { observationDate: nextClassDay(P.section, '2026-11-02') })).status, 409, 'cannot move a signed observation');

  const second = await sign(who);
  assert.equal(second.status, 200);
  assert.equal(second.body.completed, true);
  assert.equal(second.body.observation.status, 'completed');
  assert.deepEqual(second.body.observation.ratings, { organization: 4, studentEngagement: 5, clarityOfInstruction: 4, useOfMaterials: 3, classroomEnvironment: 5 });
  assert.equal((await sign(who)).status, 409, 'completed observations cannot be signed again');

  const prof = await Professor.findOne({ email: P.observee.email }).lean();
  assert.equal(prof.last_observed.toISOString().slice(0, 10), main.date, 'professor.lastObserved moves forward');
  for (const email of [P.observee.email, list[1]]) assert.equal((await notificationsOf(email, 'OBSERVATION_COMPLETED')).length, 1);
  const history = (await Observation.findOne(parseSectionKey(sectionId)).lean()).status_history.map((h) => h.to);
  assert.equal(history.length, 7, 'signup, confirm, date set, date moved, two signatures, completion');
  assert.deepEqual([history[0], history[1], history.at(-1)], ['signed_up', 'scheduled', 'completed'], 'audit trail recorded');

  const due = await client.as(P.observee.email).get(`/api/professors/${enc(P.observee.email)}/due-status`);
  assert.equal(due.status, 200, 'due status is judged from the last evaluation before this term, not the one just completed');
  assert.notEqual(due.body.baselineTerm, 'Fall 2026');
});

test('survey: after completion only, template-checked, once per term, anonymous', async () => {
  const { who, P } = main;
  const body = { term: TERM, process_ok: true, difficulties: 'Reminders came late.', improvements: 'Easy to follow.' };
  assert.equal((await client.as('math.solo@utdallas.edu').post('/api/surveys', body)).status, 409, 'a professor with no completed observation this term cannot answer');
  assert.equal((await who.post('/api/surveys', { ...body, process_ok: 'maybe' })).status, 400);
  assert.equal((await who.post('/api/surveys', { term: TERM, difficulties: 'x' })).status, 400, 'the required question must be answered');
  assert.equal((await who.post('/api/surveys', { ...body, difficulties: 42 })).status, 400);
  assert.equal((await who.post('/api/surveys', { ...body, term: 'Fall 2031' })).status, 404);
  assert.equal((await who.post('/api/surveys', { ...body, term: 'nonsense' })).status, 400);
  const ok = await who.post('/api/surveys', body);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.survey.submitted, true);
  assert.ok(!JSON.stringify(ok.body).includes(P.observee.email), 'the reply does not carry the identity back');
  const dup = await who.post('/api/surveys', body);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'ALREADY_SUBMITTED');
  const all = await AC().get(`/api/surveys?term=${enc(TERM)}`);
  assert.equal(all.status, 200);
  assert.ok(all.body.submittedCount >= 1);
  assert.ok(!JSON.stringify(all.body).includes(P.observee.email), 'the committee never sees who answered');
  assert.equal((await who.get('/api/surveys/mine')).body.surveys.filter((x) => x.term === TERM).length, 1, 'older terms\' seeded surveys are separate');
});

test('48 hours: a late answer is refused (410) and flips to expired; the sweep expires the rest; expired requests can be re-sent', async () => {
  const P = sc.many[1];
  const { who, sectionId, candidates } = await (async () => {
    const o = await client.as(P.observee.email).get(`/api/observations/${enc(sectionKey(P.section))}/candidates`);
    return { who: client.as(P.observee.email), sectionId: sectionKey(P.section), candidates: o.body.candidates.map((c) => c.observerEmail) };
  })();
  const [a, b, c, d] = candidates;
  const sent = await who.post('/api/observation-requests', { sectionId, observerEmails: [a, b, c] });
  assert.equal(sent.status, 201);

  plusHours(49);
  const late = await client.as(a).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' });
  assert.equal(late.status, 410);
  assert.equal(late.body.code, 'REQUEST_EXPIRED');
  assert.equal((await matchStatuses(sectionId))[a], 'expired', 'flipped on the spot');
  assert.equal((await Observation.findOne(tripleOf(P.section)).lean()).status, 'signed_up', 'nothing was scheduled');

  const sweep = await AC().post('/api/admin/jobs/expire-requests');
  assert.equal(sweep.status, 200);
  assert.ok(sweep.body.expiredCount >= 2, 'the two nobody answered');
  const statuses = await matchStatuses(sectionId);
  assert.equal(statuses[b], 'expired'); assert.equal(statuses[c], 'expired'); assert.equal(statuses[d], 'suggested', 'never-asked suggestions are untouched');
  for (const email of [b, c]) assert.equal((await notificationsOf(email, 'REQUEST_EXPIRED')).length, 1);
  assert.equal((await AC().post('/api/admin/jobs/expire-requests')).body.expiredCount, 0, 'running the sweep again changes nothing');
  assert.equal((await notificationsOf(b, 'REQUEST_EXPIRED')).length, 1, '...and does not re-notify');

  const stale = await client.as(b).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' });
  assert.equal(stale.status, 409);

  const resend = await who.post('/api/observation-requests', { sectionId, observerEmails: [a, d] });
  assert.equal(resend.status, 201, JSON.stringify(resend.body));
  assert.equal(new Date(resend.body.requested[0].expiresAt).getTime() - now().getTime(), 48 * HOUR, 'fresh 48 hours');
  const ok = await client.as(a).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.autoCancelled, [d]);
});

test('a stale candidate list is caught at request time and logged as a violation', async () => {
  const P = sc.few[0];
  const who = client.as(P.observee.email);
  const sectionId = sectionKey(P.section);
  const [victim] = (await who.get(`/api/observations/${enc(sectionId)}/candidates`)).body.candidates.map((c) => c.observerEmail);
  // after the list was built the candidate picks up a class at the same time as the observee's
  const clash = { course_code: `${P.section.course_code.split(' ')[0]} 9999`, section_number: '001', term: TERM, timing: P.section.timing, instructor_email: victim };
  await CourseSection.create(clash);
  const r = await who.post('/api/observation-requests', { sectionId, observerEmails: [victim] });
  assert.equal(r.status, 422);
  assert.equal(r.body.details.rejected[0].reason, 'SCHEDULE_CONFLICT');
  assert.match(r.body.details.rejected[0].detail, /overlapping/);
  const dash = await AC().get('/api/admin/dashboard-stats');
  assert.equal(dash.body.eligibility.requestsRejectedForViolations, 1);
});

test('missed observations: date passes unsigned -> missed; can be rescheduled while the period is open', async () => {
  const P = sc.few[1];
  const who = client.as(P.observee.email);
  const sectionId = sectionKey(P.section);
  setClock('2026-10-14T15:00:00Z');
  const cands = (await who.get(`/api/observations/${enc(sectionId)}/candidates`)).body.candidates.map((c) => c.observerEmail);
  assert.equal((await who.post('/api/observation-requests', { sectionId, observerEmails: cands })).status, 201);
  const observerEmail = cands[0];
  assert.equal((await client.as(observerEmail).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' })).status, 200);
  const date = nextClassDay(P.section, '2026-10-15');
  assert.equal((await who.patch(`/api/observations/${enc(sectionId)}/schedule`, { observationDate: date })).status, 200);

  setClock(`${date}T20:00:00Z`);
  const onTheDay = await AC().post('/api/admin/jobs/mark-missed');
  assert.ok(!onTheDay.body.missed.some((m) => m.sectionId === sectionId), 'the day itself is not missed yet');
  assert.equal((await Observation.findOne(tripleOf(P.section)).lean()).status, 'scheduled');
  setClock('2026-11-03T15:00:00Z'); // days later, nothing signed
  const missed = await AC().post('/api/admin/jobs/mark-missed');
  assert.ok(missed.body.missed.some((m) => m.sectionId === sectionId));
  assert.equal((await Observation.findOne(tripleOf(P.section)).lean()).status, 'missed');
  for (const email of [P.observee.email, observerEmail]) assert.equal((await notificationsOf(email, 'OBSERVATION_MISSED')).length, 1);
  assert.equal((await AC().post('/api/admin/jobs/mark-missed')).body.missedCount, 0, 'only once');

  const again = nextClassDay(P.section, '2026-11-04');
  const re = await who.patch(`/api/observations/${enc(sectionId)}/schedule`, { observationDate: again });
  assert.equal(re.status, 200);
  assert.equal(re.body.observation.status, 'scheduled', 'a missed observation can be put back on the calendar');
});

test('races: two observers confirm at once -> exactly one wins; a double signup -> exactly one signup', async () => {
  const P = sc.many[2];
  const who = client.as(P.observee.email);
  const sectionId = sectionKey(P.section);
  setClock('2026-10-14T15:00:00Z');
  const [r1, r2] = await Promise.all([
    who.post('/api/signups', { sectionId }),
    who.post('/api/signups', { sectionId }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 409], 'the unique index lets only one signup through');
  await AC().post(`/api/matching/generate/${enc(sectionId)}`);
  const cands = (await who.get(`/api/observations/${enc(sectionId)}/candidates`)).body.candidates.map((c) => c.observerEmail);
  assert.equal((await who.post('/api/observation-requests', { sectionId, observerEmails: cands.slice(0, 3) })).status, 201);
  const [x, y] = await Promise.all([
    client.as(cands[0]).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' }),
    client.as(cands[1]).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' }),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const obs = await Observation.findOne(tripleOf(P.section)).lean();
  const winner = x.status === 200 ? cands[0] : cands[1];
  assert.equal(obs.observer_email, winner);
  const statuses = await matchStatuses(sectionId);
  assert.equal(Object.values(statuses).filter((s) => s === 'confirmed').length, 1, 'never two confirmed observers');
});

test('notifications: list, unread count, mark read; you only see your own', async () => {
  const { list } = main;
  const mine = await client.as(list[2]).get('/api/notifications?unread=true');
  assert.equal(mine.status, 200);
  assert.ok(mine.body.unreadCount >= 2);
  const first = mine.body.notifications[0];
  assert.equal((await client.as(list[2]).post(`/api/notifications/${first._id}/read`)).status, 200);
  assert.equal((await client.as(list[3]).post(`/api/notifications/${first._id}/read`)).status, 404, 'not yours');
  assert.equal((await client.as(list[2]).get('/api/notifications')).body.unreadCount, mine.body.unreadCount - 1);
  assert.equal((await client.as(list[2]).post('/api/notifications/read-all')).status, 200);
  assert.equal((await client.as(list[2]).get('/api/notifications?unread=true')).body.unreadCount, 0);
});

test('forms: AC can create another form; duplicate refused; version conflicts detected', async () => {
  const f = { formId: 'peer-survey', title: 'Peer survey', fields: [{ key: 'q1', label: 'Q1', type: 'rating', min: 1, max: 5 }] };
  assert.equal((await AC().post('/api/forms', f)).status, 201);
  assert.equal((await AC().post('/api/forms', f)).status, 409);
  assert.equal((await AC().post('/api/forms', { ...f, formId: 'bad id' })).status, 400);
  assert.equal((await client.as(NON_AC).post('/api/forms', { ...f, formId: 'other' })).status, 403);
  assert.equal((await AC().put('/api/forms/peer-survey', { title: 'Renamed' })).body.form.version, 2);
  assert.equal((await AC().get('/api/forms/nope')).status, 404);
  assert.ok((await EvaluationForm.find({}).lean()).length >= 2);
});

test('dashboard after all that: consistent, AC-only', async () => {
  setClock('2026-11-05T15:00:00Z');
  const d = (await AC().get('/api/admin/dashboard-stats')).body;
  const signups = (await AC().get(`/api/cycles/${enc(TERM)}/signups`)).body;
  assert.equal(d.participation.signups, signups.count);
  assert.ok(d.outstandingObservations.missingObservationCount >= 7, 'the seed\'s 7 missed + ours');
  assert.ok(d.surveyCompletion.surveyed >= 1);
  assert.ok(d.participation.assessmentParticipationRate > 0);
  // the selection run re-evaluated the 4 seeded 'unmatched' rows (26+ colleagues qualify for them), leaving only the lone MATH professor
  assert.deepEqual(d.unmatchedFaculty.noOrInsufficientObservers.map((x) => x.email), ['math.solo@utdallas.edu']);
  for (const sub of ['faculty-due-for-evaluation', 'overdue-evaluations', 'eligibility-violations', 'unmatched-faculty', 'outstanding-observations', 'participation', 'survey-completion']) {
    assert.equal((await AC().get(`/api/admin/dashboard-stats/${sub}`)).status, 200, sub);
  }
  assert.equal((await client.as(NON_AC).get('/api/admin/dashboard-stats')).status, 403);
  assert.equal((await AC().get('/api/admin/dashboard-stats?term=Spring%202027')).status, 404, 'no such cycle');
});
