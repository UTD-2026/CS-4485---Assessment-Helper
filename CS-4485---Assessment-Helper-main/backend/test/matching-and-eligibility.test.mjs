// Faculty eligibility (who is due and why), observer flags, the two confirmation modes, the paging convention, 12-hour times.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { env } from '../config/env.js';
import models from '../models/index.js';
import { describeMeeting, meetingOf, normalizeClock, schedulesConflict, toMinutes } from '../services/eligibility.js';
import { parsePaging, paginate } from '../services/paging.js';
import { setClock } from '../services/clock.js';
import { candidateFlag } from '../services/matching.js';
import { sectionKey } from '../services/lookup.js';
import { RULE_VERSION } from '../config/rules.js';
import { nextClassDay } from './support/scenarios.js';
import {
  SEED_TODAY, boot, enc, toScheduled, TERM,
} from './helpers.mjs';

const { Notification, ObserverMatch, Observation } = models;
const tripleOf = (d) => ({ course_code: d.course_code, section_number: d.section_number, term: d.term });
let world;
before(async () => { world = await boot({ many: 6, few: 2, none: 1, small: true }); });

// ---- times -----------------------------------------------------------------------------------------------------------------
test('class times: 24-hour and 12-hour text both read, so the frontend\'s "MW 8:30 AM" and the seed\'s "MW 08:30-09:45" agree', () => {
  assert.deepEqual(meetingOf({ timing: 'MW 8:30 AM' }), { days: 'MW', startTime: '08:30', endTime: null });
  assert.deepEqual(meetingOf({ timing: 'TR 1:00PM - 2:15PM' }), { days: 'TR', startTime: '13:00', endTime: '14:15' });
  assert.deepEqual(meetingOf({ timing: 'F 12:30 PM' }), { days: 'F', startTime: '12:30', endTime: null });
  assert.deepEqual(meetingOf({ timing: 'MW 12:05 AM' }), { days: 'MW', startTime: '00:05', endTime: null });
  assert.deepEqual(meetingOf({ timing: 'TT 08:30-09:45' }), { days: 'TR', startTime: '08:30', endTime: '09:45' });
  assert.deepEqual(meetingOf({ timing: 'MW 13:00' }), { days: 'MW', startTime: '13:00', endTime: null });
  for (const bad of ['MW 25:00', 'MW 13:00 PM', 'MW 0:30 AM', 'MW 9:75 AM', 'MW', 'sometime', '']) {
    assert.deepEqual(meetingOf({ timing: bad }), { days: '', startTime: null, endTime: null }, bad);
  }
  assert.equal(toMinutes('8:30 am'), 510);
  assert.equal(toMinutes('11:59 PM'), 23 * 60 + 59);
  assert.equal(normalizeClock('9:05'), '09:05');
  assert.equal(normalizeClock('nope'), null);
  assert.equal(describeMeeting({ timing: 'MW 8:30 AM' }), 'MW 08:30');
  assert.equal(describeMeeting({ timing: 'MW 08:30-09:45' }), 'MW 08:30-09:45');
  // a class with only a start time never "proves" a clash
  assert.equal(schedulesConflict({ timing: 'MW 8:30 AM' }, { timing: 'MW 08:30-09:45' }), false);
  assert.equal(schedulesConflict({ timing: 'MW 08:30-09:45' }, { timing: 'MW 09:00-10:15' }), true);
});

// ---- paging --------------------------------------------------------------------------------------------------------------------
test('paging convention: page and pageSize, defaults, limits, and opt-in for the lists that already existed', async () => {
  assert.deepEqual(parsePaging({}), { page: 1, pageSize: 25, skip: 0, requested: false });
  assert.deepEqual(parsePaging({ page: '3', pageSize: '10' }), { page: 3, pageSize: 10, skip: 20, requested: true });
  assert.equal(parsePaging({ limit: '5' }).pageSize, 5, 'limit is accepted as pageSize');
  for (const bad of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'x' }, { pageSize: '0' }, { pageSize: '101' }, { page: '9999999999' }]) assert.throws(() => parsePaging(bad), /must be|at most/, JSON.stringify(bad));
  const p = paginate([1, 2, 3, 4, 5], parsePaging({ page: '2', pageSize: '2' }));
  assert.deepEqual(p, { items: [3, 4], pagination: { page: 2, pageSize: 2, total: 5, totalPages: 3, hasNext: true } });
  assert.deepEqual(paginate([], parsePaging({})).pagination, { page: 1, pageSize: 25, total: 0, totalPages: 1, hasNext: false });

  const { client, ac, nonAc } = world;
  const unpaged = (await client.as(ac.email).get(`/api/professors?term=${enc(TERM)}`)).body;
  assert.equal(unpaged.pagination, undefined, 'unchanged for the current frontend');
  assert.equal(unpaged.professors.length, unpaged.count);
  const paged = (await client.as(ac.email).get(`/api/professors?term=${enc(TERM)}&page=2&pageSize=30`)).body;
  assert.equal(paged.professors.length, 30);
  assert.equal(paged.pagination.total, unpaged.count);
  assert.deepEqual(paged.professors.map((x) => x.email), unpaged.professors.slice(30, 60).map((x) => x.email));
  const sections = (await client.as(nonAc.email).get(`/api/sections?term=${enc(TERM)}&page=1&pageSize=1`)).body;
  assert.equal(sections.sections.length, 1);
  assert.ok(sections.pagination.total >= 1);
  const notes = (await client.as(nonAc.email).get('/api/notifications?page=1&pageSize=5')).body;
  assert.ok(notes.pagination && notes.notifications.length <= 5);
  assert.equal((await client.as(nonAc.email).get('/api/notifications?page=0')).status, 400);
});

// ---- eligible faculty ------------------------------------------------------------------------------------------------------------
test('eligible faculty: who is due or overdue, in words, with signup blockers and the rule version (committee only, paged)', async () => {
  const { client, ac, nonAc } = world;
  const url = `/api/cycles/${enc(TERM)}/eligible-faculty`;
  assert.equal((await client.as(nonAc.email).get(url)).status, 403);
  assert.equal((await client.as(ac.email).get(`/api/cycles/${enc('Fall 2031')}/eligible-faculty`)).status, 404);
  assert.equal((await client.as(ac.email).get(`${url}?status=late`)).status, 400);
  assert.equal((await client.as(ac.email).get(`${url}?signedUp=maybe`)).status, 400);

  const dueReport = (await client.as(ac.email).get(`/api/cycles/${enc(TERM)}/due-report`)).body;
  const body = (await client.as(ac.email).get(`${url}?pageSize=100`)).body;
  assert.equal(body.ruleVersion, RULE_VERSION);
  assert.equal(body.pagination.total, dueReport.count, 'the same people as the due report');
  assert.ok(body.faculty.length > 0);
  for (const f of body.faculty) {
    assert.ok(['due', 'overdue'].includes(f.status) && f.eligibleForCycle === true);
    assert.equal(f.ruleVersion, RULE_VERSION);
    assert.match(f.reason, new RegExp(`^${f.hireLevelLabel} professor: observed every (year|2 years)\\.`));
    assert.ok(Array.isArray(f.blockers) && f.canSignUp === (f.blockers.length === 0));
  }
  const overdueNever = body.faculty.find((f) => f.status === 'overdue' && f.baselineTerm === null);
  if (overdueNever) assert.match(overdueNever.reason, /No completed observation is on record/);
  const withHistory = body.faculty.find((f) => f.baselineTerm);
  assert.match(withHistory.reason, new RegExp(withHistory.baselineTerm));

  const all = (await client.as(ac.email).get(`${url}?status=due,overdue,not_due&pageSize=100`)).body;
  assert.equal(all.pagination.total, (await client.as(ac.email).get(`/api/professors?term=${enc(TERM)}`)).body.count);
  const notDue = all.faculty.find((f) => f.status === 'not_due');
  assert.equal(notDue.eligibleForCycle, false);
  assert.match(notDue.reason, /next due /);

  const assistants = (await client.as(ac.email).get(`${url}?hireLevel=assistant&pageSize=100`)).body.faculty;
  assert.ok(assistants.length > 0 && assistants.every((f) => f.hireLevel === 'assistant' && f.hireLevelLabel === 'Assistant'));
  const first = (await client.as(ac.email).get(`${url}?pageSize=5&page=1`)).body;
  const second = (await client.as(ac.email).get(`${url}?pageSize=5&page=2`)).body;
  assert.equal(first.faculty.length, 5);
  assert.notEqual(first.faculty[0].email, second.faculty[0].email);
  const needle = body.faculty[0].name.split(' ')[1];
  assert.ok((await client.as(ac.email).get(`${url}?q=${enc(needle)}`)).body.faculty.some((f) => f.email === body.faculty[0].email));
});

test('one professor\'s eligibility: yourself or the committee; what blocks signing up', async () => {
  const { client, ac, nonAc, sc } = world;
  const target = sc[0].observee;
  const url = `/api/professors/${enc(target.email)}/eligibility?term=${enc(TERM)}`;
  assert.equal((await client.as(nonAc.email === target.email ? sc[1].observee.email : nonAc.email).get(url)).status, 403, 'not for someone else\'s record');
  assert.equal((await client.as(target.email).get(url)).status, 200);
  assert.equal((await client.as(ac.email).get(`/api/professors/nobody%40utdallas.edu/eligibility`)).status, 404);

  let e = (await client.as(ac.email).get(url)).body;
  assert.deepEqual([e.ruleVersion, e.phase], [RULE_VERSION, 'SIGNUP']);
  assert.equal(e.eligibility.canSignUp, true);
  assert.deepEqual(e.eligibility.blockers, []);
  assert.ok(e.eligibility.sectionsThisTerm >= 1);

  assert.equal((await client.as(target.email).post('/api/signups', { sectionId: sectionKey(sc[0].section) })).status, 201);
  e = (await client.as(ac.email).get(url)).body;
  assert.deepEqual([e.eligibility.canSignUp, e.eligibility.blockers, e.eligibility.signedUp], [false, ['ALREADY_SIGNED_UP'], true]);

  setClock('2026-11-02T15:00:00Z'); // after the (extended) signup deadline
  const other = (await client.as(ac.email).get(`/api/professors/${enc(sc[1].observee.email)}/eligibility?term=${enc(TERM)}`)).body;
  assert.equal(other.phase, 'OBSERVATION');
  assert.deepEqual(other.eligibility.blockers, ['SIGNUP_CLOSED']);
  setClock(SEED_TODAY);

  // a professor with no classes this term
  const idle = (await client.as(ac.email).get(`/api/professors/math.solo%40utdallas.edu/eligibility?term=${enc('Spring 2026')}`)).body;
  assert.ok(idle.eligibility.blockers.includes('NO_SECTIONS_THIS_TERM'));
});

// ---- candidate flags ----------------------------------------------------------------------------------------------------------------
test('observer list flags: OK / INSUFFICIENT_OBSERVERS / NO_ELIGIBLE_OBSERVER on candidates, previews and the committee alert', async () => {
  assert.equal(candidateFlag(0), 'NO_ELIGIBLE_OBSERVER');
  assert.equal(candidateFlag(1), 'INSUFFICIENT_OBSERVERS');
  assert.equal(candidateFlag(4), 'INSUFFICIENT_OBSERVERS');
  assert.equal(candidateFlag(5), 'OK');
  assert.equal(candidateFlag(30), 'OK');

  const { client, ac, scenarios } = world;
  const AC = () => client.as(ac.email);
  const [many, few, none] = [scenarios.many[3], scenarios.few[0], scenarios.none[0]];
  for (const s of [many, few, none]) assert.equal((await client.as(s.observee.email).post('/api/signups', { sectionId: sectionKey(s.section) })).status, 201);

  const previews = {};
  for (const [name, s] of Object.entries({ many, few, none })) previews[name] = (await AC().get(`/api/matching/preview/${enc(sectionKey(s.section))}`)).body;
  assert.deepEqual([previews.many.flag, previews.few.flag, previews.none.flag], ['OK', 'INSUFFICIENT_OBSERVERS', 'NO_ELIGIBLE_OBSERVER']);

  const run = (await AC().post(`/api/cycles/${enc(TERM)}/run-observer-selection`, { force: true })).body;
  assert.ok(run.insufficient >= 1 && run.unmatched >= 1);
  const candidatesOf = async (s) => (await client.as(s.observee.email).get(`/api/observations/${enc(sectionKey(s.section))}/candidates`)).body;
  const [cMany, cFew, cNone] = [await candidatesOf(many), await candidatesOf(few), await candidatesOf(none)];
  assert.deepEqual([cMany.flag, cFew.flag, cNone.flag], ['OK', 'INSUFFICIENT_OBSERVERS', 'NO_ELIGIBLE_OBSERVER']);
  assert.equal(cFew.eligibleCount, previews.few.eligibleCount);
  assert.equal(cNone.candidates.length, 0);

  const alerts = (await AC().get(`/api/cycles/${enc(TERM)}/insufficient-observers`)).body;
  assert.ok(alerts.signups.every((a) => a.flag === 'NO_ELIGIBLE_OBSERVER'));
  assert.ok(alerts.signups.some((a) => a.observeeEmail === none.observee.email));
  assert.ok(!alerts.signups.some((a) => a.observeeEmail === few.observee.email), 'the old alert is unchanged: nobody-eligible only');
  const wider = (await AC().get(`/api/cycles/${enc(TERM)}/insufficient-observers?includeFew=true`)).body;
  const fewRow = wider.signups.find((a) => a.observeeEmail === few.observee.email);
  assert.equal(fewRow.flag, 'INSUFFICIENT_OBSERVERS');
  assert.equal(fewRow.eligibleCount, previews.few.eligibleCount);
  assert.ok(!wider.signups.some((a) => a.observeeEmail === many.observee.email));
  const generated = (await AC().post(`/api/matching/generate/${enc(sectionKey(few.section))}`)).body;
  assert.equal(generated.flag, 'INSUFFICIENT_OBSERVERS');
});

// ---- the two confirmation modes ------------------------------------------------------------------------------------------------------
test('CONFIRMATION_MODE=observee_final: observers accept, the observee picks one, everyone else is released', async () => {
  const { client, ac } = world;
  env.confirmationMode = 'observee_final';
  try {
    const c = world.sc[4];
    const sectionId = sectionKey(c.section);
    const who = client.as(c.observee.email);
    const url = `/api/observations/${enc(sectionId)}`;
    await who.post('/api/signups', { sectionId });
    await client.as(ac.email).post(`/api/matching/generate/${enc(sectionId)}`);
    const list = (await who.get(`${url}/candidates`)).body.candidates.map((x) => x.observerEmail);
    const [a, b, d, cc] = list; // a, b accept; d declines; cc stays silent
    await who.post('/api/observation-requests', { sectionId, observerEmails: [a, b, d, cc] });
    const respond = (email, response) => client.as(email).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response });

    // two observers accept at the same moment: both are fine, nobody is turned away
    const both = await Promise.all([respond(a, 'CONFIRM'), respond(b, 'CONFIRM')]);
    assert.deepEqual(both.map((r) => r.status), [200, 200]);
    assert.equal(both[0].body.match.status, 'accepted');
    assert.equal(both[0].body.awaitingObserveeConfirmation, true);
    assert.equal(both[0].body.observation, null);
    assert.equal((await respond(d, 'DECLINE')).status, 200);

    let stored = await Observation.findOne(tripleOf(c.section)).lean();
    assert.deepEqual([stored.status, stored.observer_email], ['signed_up', null], 'a yes is not yet the observer');
    assert.equal((await Notification.find({ recipient_email: c.observee.email, type: 'REQUEST_ACCEPTED' }).lean()).length, 2);
    assert.equal((await who.get('/api/overview')).body.asObservee.nextAction.code, 'CHOOSE_FINAL_OBSERVER');
    assert.equal((await who.get('/api/overview')).body.asObservee.requests.accepted, 2);
    assert.equal((await who.patch(`${url}/schedule`, { observationDate: nextClassDay(c.section, '2026-10-14') })).status, 409, 'no date before an observer is chosen');
    assert.equal((await respond(a, 'CONFIRM')).body.code, 'NOT_PENDING', 'answering twice');

    // who may finalize, and whom
    const fin = (email, observerEmail) => client.as(email).post(`/api/observation-requests/${enc(sectionId)}/finalize`, { observerEmail });
    assert.equal((await fin(a, a)).status, 403, 'the observer cannot pick themselves');
    assert.equal((await fin(ac.email, a)).status, 403);
    assert.equal((await fin(c.observee.email, undefined)).status, 400);
    assert.equal((await fin(c.observee.email, d)).body.code, 'NOT_ACCEPTED', 'someone who declined');
    assert.equal((await fin(c.observee.email, cc)).body.code, 'NOT_ACCEPTED', 'someone who has not answered');
    assert.equal((await fin(c.observee.email, 'stranger@utdallas.edu')).status, 404);

    // two clicks at once: one wins
    const twice = await Promise.all([fin(c.observee.email, a), fin(c.observee.email, b)]);
    assert.deepEqual(twice.map((r) => r.status).sort(), [200, 409]);
    const winner = twice.find((r) => r.status === 200).body.observerEmail;
    const loser = winner === a ? b : a;
    stored = await Observation.findOne(tripleOf(c.section)).lean();
    assert.deepEqual([stored.status, stored.observer_email], ['scheduled', winner]);
    const rows = await ObserverMatch.find(tripleOf(c.section)).lean();
    const statusOf = (email) => rows.find((m) => m.observer_email === email).status;
    assert.equal(statusOf(winner), 'confirmed');
    assert.equal(statusOf(loser), 'cancelled', 'the other accepted observer is released');
    assert.equal(statusOf(d), 'declined', 'a decline stays a decline');
    assert.equal(statusOf(cc), 'cancelled', 'so is someone who never answered');
    assert.equal(await Notification.countDocuments({ recipient_email: loser, type: 'REQUEST_DECLINED' }), 1, 'told politely, once');
    assert.equal(await Notification.countDocuments({ recipient_email: cc, type: 'REQUEST_DECLINED' }), 1);
    assert.equal(await Notification.countDocuments({ recipient_email: d, type: 'REQUEST_DECLINED' }), 0);
    assert.equal(await Notification.countDocuments({ recipient_email: winner, type: 'REQUEST_CONFIRMED' }), 1);
    assert.equal((await respond(cc, 'CONFIRM')).body.code, 'NOT_PENDING', 'a late yes after the pick');
    assert.equal((await fin(c.observee.email, winner)).body.code, 'ALREADY_CONFIRMED');
    assert.equal((await who.patch(`${url}/schedule`, { observationDate: nextClassDay(c.section, '2026-10-14') })).status, 200, 'now the date can be chosen');

    // the committee views cope with the new status
    assert.equal((await client.as(ac.email).get('/api/admin/analytics/observer-workload')).status, 200);
    const audit = (await client.as(ac.email).get(`/api/admin/audit-log?targetId=${enc(sectionId)}&pageSize=100`)).body.entries.map((e) => e.action);
    assert.ok(audit.includes('request.accepted') && audit.includes('observer.finalized'));
  } finally {
    env.confirmationMode = 'first_wins';
  }
});

test('CONFIRMATION_MODE=first_wins (default): there is nothing to finalize, and a yes is final at once', async () => {
  const { client } = world;
  assert.equal(env.confirmationMode, 'first_wins');
  const run = await toScheduled(world, world.sc[5], { date: false });
  const res = await client.as(run.c.observee.email).post(`/api/observation-requests/${enc(run.sectionId)}/finalize`, { observerEmail: run.observer });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'WRONG_MODE');
  assert.equal((await Observation.findOne(tripleOf(run.c.section)).lean()).status, 'scheduled');
  assert.equal((await client.anonymous.get('/health')).body.confirmationMode, 'first_wins');
});
