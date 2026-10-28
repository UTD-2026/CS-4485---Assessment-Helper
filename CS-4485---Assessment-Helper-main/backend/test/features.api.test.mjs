// The frontend-facing additions, through the real routes: NetID login, next-step overview, signed PDF upload/download,
// CSV exports, calendar files, workload analytics.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, test } from 'node:test';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import models from '../models/index.js';
import { meetingOf } from '../services/eligibility.js';
import { sectionKey } from '../services/lookup.js';
import { setClock } from '../services/clock.js';
import { loadSeedWorld, makeClient, DEV_PASSWORD } from './support/world.js';
import { nextClassDay, pickScenarios } from './support/scenarios.js';

const {
  CourseSection, Notification, Observation, ObservationFile, ObserverMatch, Professor,
} = models;
const TERM = 'Fall 2026';
const slug = (key) => key.replace(/[^A-Za-z0-9]+/g, '-');
const tripleOf = (d) => ({ course_code: d.course_code, section_number: d.section_number, term: d.term });
const SEED_TODAY = '2026-10-12T15:00:00Z';
const enc = encodeURIComponent;
let client; let data; let ac; let nonAc; let sc;
const AC = () => client.as(ac.email);

const pdf = (text = 'hello', pad = 0) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`), Buffer.alloc(pad, 0x20)]);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PDF_HEADERS = { 'Content-Type': 'application/pdf' };
const put = (who, id, body, { qs = '', headers = PDF_HEADERS, method = 'PUT' } = {}) =>
  client.as(who).send(method, `/api/observations/${enc(id)}/files/signed-template${qs}`, { raw: body, headers });

/** signup -> list -> ask two -> the first confirms -> (optionally) a date. Returns the people and ids. */
async function scheduled(c, { date = true } = {}) {
  const sectionId = sectionKey(c.section);
  const who = client.as(c.observee.email);
  assert.equal((await who.post('/api/signups', { sectionId })).status, 201);
  assert.equal((await AC().post(`/api/matching/generate/${enc(sectionId)}`)).status, 200);
  const list = (await who.get(`/api/observations/${enc(sectionId)}/candidates`)).body.candidates.map((x) => x.observerEmail);
  assert.equal((await who.post('/api/observation-requests', { sectionId, observerEmails: list.slice(0, 2) })).status, 201);
  const observer = list[0];
  assert.equal((await client.as(observer).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' })).status, 200);
  let day = null;
  if (date) {
    day = nextClassDay(c.section, '2026-10-14');
    assert.equal((await who.patch(`/api/observations/${enc(sectionId)}/schedule`, { observationDate: day })).status, 200);
  }
  return { c, sectionId, who, observer, standDown: list[1], day, obsApi: client.as(observer) };
}

before(async () => {
  data = await loadSeedWorld();
  client = makeClient(createApp());
  ac = data.professors.find((p) => p.is_ac_member);
  nonAc = data.professors.find((p) => !p.is_ac_member);
  sc = (await pickScenarios(TERM, { many: 8, few: 0, none: 0 })).many;
  assert.ok(sc.length >= 6, 'the seed has enough professors with five or more eligible observers');
});

// ----------------------------------------------------------------------------------------------------------------
test('login: a NetID works like an email (the frontend sign-in box says "username")', async () => {
  const netId = nonAc.email.split('@')[0];
  const login = (body) => client.anonymous.post('/api/auth/login', { password: DEV_PASSWORD, ...body });

  for (const body of [{ username: netId }, { username: netId.toUpperCase() }, { netId }, { identifier: netId }, { username: ` ${netId} ` }, { username: nonAc.email }, { email: nonAc.email }]) {
    const r = await login(body);
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(r.body.professor.email, nonAc.email);
    assert.equal(r.body.professor.netId, netId);
    assert.ok(!JSON.stringify(r.body).includes('passwordHash') && !JSON.stringify(r.body).includes('password_hash'));
  }
  const me = await client.anonymous.get('/api/auth/me');
  assert.equal(me.status, 401);

  const wrongPassword = await login({ username: netId, password: 'nope' });
  const unknown = await login({ username: 'nobody123' });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.body.error, unknown.body.error, 'does not reveal which accounts exist');

  // Things that must NOT log anyone in
  for (const username of [netId.slice(0, 4), '.*', `${netId}@`, '^', 'a b', 'x'.repeat(300), `${netId}@other.edu`, '%']) {
    const r = await login({ username });
    assert.equal(r.status, 401, `"${username.slice(0, 20)}"`);
  }
  assert.equal((await login({ username: 12345 })).status, 400, 'a number is not a username');
  assert.equal((await client.anonymous.post('/api/auth/login', { username: netId })).status, 400, 'password is required');
  assert.equal((await client.anonymous.post('/api/auth/login', null)).status, 400);

  // Two accounts with the same NetID at different domains: a bare NetID is ambiguous, the full email still works.
  await Professor.create({ ...JSON.parse(JSON.stringify(nonAc)), _id: undefined, email: `${netId}@other.edu` });
  assert.equal((await login({ username: netId })).status, 401, 'ambiguous NetID is refused');
  assert.equal((await login({ username: nonAc.email })).status, 200);
  await Professor.deleteMany({ email: `${netId}@other.edu` });
  assert.equal((await login({ username: netId })).status, 200, 'unique again');
});

// ----------------------------------------------------------------------------------------------------------------
test('overview: the next step is right at every stage, for both the professor and the observer', async () => {
  const c = sc[0];
  const sectionId = sectionKey(c.section);
  const who = client.as(c.observee.email);
  const next = async (email = c.observee.email) => (await client.as(email).get(`/api/overview?term=${enc(TERM)}`)).body;
  const unauth = await client.anonymous.get('/api/overview');
  assert.equal(unauth.status, 401);

  // signup is closed in the seed's "today" (2026-10-12): the deadline was 2026-09-18
  let o = await next();
  assert.equal(o.cycle.phase, 'OBSERVATION');
  assert.equal(o.asObservee.nextAction.code, 'SIGNUP_CLOSED');
  assert.deepEqual(o.asObservee.mySections.map((s) => s.sectionId).includes(sectionId), true);

  await AC().put(`/api/cycles/${enc(TERM)}`, { signupDeadline: '2026-10-20' });
  o = await next();
  assert.equal(o.cycle.phase, 'SIGNUP');
  assert.equal(o.cycle.phaseEndsOn, '2026-10-20');
  assert.equal(o.cycle.daysLeftInPhase, 9, '8 days 9 hours left rounds up to 9');
  assert.equal(o.asObservee.nextAction.code, 'SIGN_UP');
  assert.equal(o.asObservee.nextAction.required, ['due', 'overdue'].includes(o.evaluation.status));
  assert.ok(['not_due', 'due', 'overdue'].includes(o.evaluation.status));
  assert.equal(o.asObservee.observation, null);

  await who.post('/api/signups', { sectionId });
  assert.equal((await next()).asObservee.nextAction.code, 'WAIT_FOR_LIST');
  await AC().post(`/api/matching/generate/${enc(sectionId)}`);
  o = await next();
  assert.equal(o.asObservee.nextAction.code, 'CHOOSE_OBSERVERS');
  assert.equal(o.asObservee.requests.suggested, 5);

  const list = (await who.get(`/api/observations/${enc(sectionId)}/candidates`)).body.candidates.map((x) => x.observerEmail);
  const [first, second] = list;
  await who.post('/api/observation-requests', { sectionId, observerEmails: [first, second] });
  o = await next();
  assert.equal(o.asObservee.nextAction.code, 'WAIT_FOR_REPLIES');
  assert.equal(o.asObservee.nextAction.canAskMore, true);

  // the team's seed data may already give this person other duties this term, so look at THIS section's entry
  const pending = (res) => res.asObserver.pendingRequests.find((r) => r.sectionId === sectionId);
  const duty = (res) => res.asObserver.duties.find((d) => d.sectionId === sectionId);
  let ob = await next(first);
  assert.ok(pending(ob));
  assert.equal(pending(ob).observeeName, c.observee.name);
  assert.equal(pending(ob).hoursLeft, 48);
  assert.equal(pending(ob).expired, false);
  assert.ok(ob.asObserver.counts.pendingRequests >= 1);
  assert.ok(ob.unreadNotifications >= 1, 'the REQUEST_RECEIVED notice');
  const needingBefore = ob.asObserver.counts.needingAction;

  await client.as(first).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' });
  o = await next();
  assert.equal(o.asObservee.nextAction.code, 'SET_DATE');
  assert.equal(o.asObservee.observation.observer.email, first);
  ob = await next(first);
  assert.equal(pending(ob), undefined, 'answered, so no longer waiting');
  assert.equal(duty(ob).nextAction.code, 'SET_DATE');
  const stoodDown = await next(second);
  assert.equal(duty(stoodDown), undefined, 'the stood-down observer has no duty for this section');
  assert.equal(pending(stoodDown), undefined);

  const day = nextClassDay(c.section, '2026-10-14');
  await who.patch(`/api/observations/${enc(sectionId)}/schedule`, { observationDate: day });
  assert.equal((await next()).asObservee.nextAction.code, 'OBSERVATION_COMING');
  assert.equal(duty(await next(first)).nextAction.code, 'OBSERVATION_COMING');
  assert.equal(duty(await next(first)).nextAction.uploadSignedTemplate, false);

  setClock(`${day}T16:00:00Z`);
  assert.equal((await next()).asObservee.nextAction.code, 'WAIT_FOR_OBSERVER_FORM');
  ob = await next(first);
  assert.equal(duty(ob).nextAction.code, 'START_FORM');
  assert.equal(ob.asObserver.counts.needingAction, needingBefore + 1);
  const observer = client.as(first);
  await observer.post(`/api/observations/${enc(sectionId)}/record`);
  ob = await next(first);
  assert.equal(duty(ob).nextAction.code, 'FILL_FORM');
  assert.deepEqual(duty(ob).nextAction.missing.sort(), ['clarityOfInstruction', 'classroomEnvironment', 'organization', 'studentEngagement', 'useOfMaterials']);
  assert.equal((await next()).asObservee.nextAction.code, 'WAIT_FOR_OBSERVER_FORM');
  await observer.put(`/api/observations/${enc(sectionId)}/record`, { values: { organization: 5, clarityOfInstruction: 4, studentEngagement: 5, useOfMaterials: 4, classroomEnvironment: 5 } });
  assert.equal(duty(await next(first)).nextAction.code, 'SIGN');
  assert.equal((await next()).asObservee.nextAction.code, 'WAIT_FOR_OBSERVER_FORM', 'the professor is asked to sign only after the observer has');

  await observer.post(`/api/observations/${enc(sectionId)}/sign`);
  assert.equal(duty(await next(first)).nextAction.code, 'WAIT_FOR_OBSERVEE_SIGNATURE');
  assert.equal((await next()).asObservee.nextAction.code, 'SIGN');
  await who.post(`/api/observations/${enc(sectionId)}/sign`);
  o = await next();
  assert.equal(o.asObservee.nextAction.code, 'TAKE_SURVEY');
  assert.equal(o.asObservee.observation.status, 'completed');
  assert.equal(o.asObservee.observation.record.locked, true);
  ob = await next(first);
  assert.equal(duty(ob).nextAction.code, 'DONE');
  assert.equal(duty(ob).nextAction.uploadSignedTemplate, true, 'the signed PDF is still owed');
  const owing = ob.asObserver.counts.needingAction;

  assert.equal((await put(first, sectionId, pdf('signed'))).status, 201);
  ob = await next(first);
  assert.equal(duty(ob).nextAction.uploadSignedTemplate, false);
  assert.equal(duty(ob).signedTemplate.size, pdf('signed').length);
  assert.equal(ob.asObserver.counts.needingAction, owing - 1);
  assert.equal((await next()).asObservee.observation.signedTemplate.filename, `signed-observation-${slug(sectionId)}.pdf`);

  await who.post('/api/surveys', { term: TERM, process_ok: true, difficulties: 'none', improvements: 'ok' });
  assert.equal((await next()).asObservee.nextAction.code, 'DONE');
  setClock(SEED_TODAY);
});

test('overview: a missed observation, a request that is about to expire, an invalid term', async () => {
  const c = sc[1];
  const run = await scheduled(c);
  // the date passes with nobody signing
  setClock(`${run.day}T00:00:00Z`);
  setClock(new Date(new Date(`${run.day}T00:00:00Z`).getTime() + 36 * 3600e3).toISOString());
  await AC().post('/api/admin/jobs/mark-missed');
  const o = (await client.as(c.observee.email).get(`/api/overview?term=${enc(TERM)}`)).body;
  assert.equal(o.asObservee.nextAction.code, 'RESCHEDULE');
  const theirs = (await client.as(run.observer).get(`/api/overview?term=${enc(TERM)}`)).body.asObserver.duties.find((d) => d.sectionId === run.sectionId);
  assert.equal(theirs.nextAction.code, 'RESCHEDULE');
  setClock(SEED_TODAY);

  assert.equal((await client.as(c.observee.email).get('/api/overview?term=Winter 2026')).status, 400);
  assert.equal((await client.as(c.observee.email).get('/api/overview?term=Fall 2031')).status, 404);
  // no ?term= means the current cycle
  assert.equal((await client.as(c.observee.email).get('/api/overview')).body.term, TERM);
});

test('overview: a request past its expiry is flagged so the frontend can hide it', async () => {
  const c = sc[2];
  const sectionId = sectionKey(c.section);
  const who = client.as(c.observee.email);
  await who.post('/api/signups', { sectionId });
  await AC().post(`/api/matching/generate/${enc(sectionId)}`);
  const [first] = (await who.get(`/api/observations/${enc(sectionId)}/candidates`)).body.candidates.map((x) => x.observerEmail);
  await who.post('/api/observation-requests', { sectionId, observerEmails: [first] });
  setClock('2026-10-15T00:00:00Z'); // 57 hours later; the sweep has not run
  const ob = (await client.as(first).get(`/api/overview?term=${enc(TERM)}`)).body;
  const mine = ob.asObserver.pendingRequests.find((r) => r.sectionId === sectionId);
  assert.equal(mine.expired, true);
  assert.equal(mine.hoursLeft, 0);
  assert.equal(ob.asObserver.counts.pendingRequests, ob.asObserver.pendingRequests.filter((r) => !r.expired).length, 'expired requests are not counted as waiting');
  setClock(SEED_TODAY);
});

// ----------------------------------------------------------------------------------------------------------------
test('signed PDF: who may upload, what is accepted, replacing, downloading', async () => {
  const c = sc[3];
  const run = await scheduled(c);
  const { sectionId, observer } = run;
  const base = `/api/observations/${enc(sectionId)}/files/signed-template`;

  assert.equal((await client.as(observer).get(base)).status, 404, 'nothing uploaded yet');
  const early = await client.as(c.observee.email).get(base);
  assert.equal(early.status, 403, 'the professor is not shown the report before the observer signed');
  assert.equal(early.body.code, 'REPORT_NOT_AVAILABLE');
  assert.deepEqual((await run.who.get(`/api/observations/${enc(sectionId)}/files`)).body.files, []);

  // wrong people
  assert.equal((await put(c.observee.email, sectionId, pdf())).status, 403, 'the professor cannot upload for their observer');
  assert.equal((await put(ac.email === observer ? nonAc.email : ac.email, sectionId, pdf())).status, 403, 'the committee cannot either');
  const stranger = data.professors.find((p) => ![c.observee.email, observer, ac.email].includes(p.email)).email;
  assert.equal((await put(stranger, sectionId, pdf())).status, 403);
  assert.equal((await client.anonymous.post(`/api/observations/${enc(sectionId)}/files/signed-template`)).status, 401);

  // wrong bodies
  const json = await client.as(observer).send('PUT', base, { body: { hello: 'world' } });
  assert.equal(json.status, 415);
  assert.equal(json.body.code, 'NOT_A_PDF_BODY');
  assert.equal((await put(observer, sectionId, pdf(), { headers: { 'Content-Type': 'text/plain' } })).status, 415, 'a PDF sent as text/plain is not read');
  const empty = await put(observer, sectionId, Buffer.alloc(0));
  assert.equal(empty.status, 400);
  const notPdf = await put(observer, sectionId, Buffer.from('This is a Word document, honest.'));
  assert.equal(notPdf.status, 400);
  assert.equal(notPdf.body.code, 'NOT_A_PDF');
  assert.equal(await ObservationFile.countDocuments(tripleOf(c.section)), 0, 'nothing was stored by the failed attempts');

  // size limit: exactly the limit is fine, one byte more is refused
  const saved = env.uploadMaxMb;
  env.uploadMaxMb = 1;
  const limit = 1024 * 1024;
  const tooBig = await put(observer, sectionId, pdf('big', limit - pdf('big').length + 1));
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.body.code, 'PAYLOAD_TOO_LARGE');
  assert.match(tooBig.body.error, /1 MB/);
  const exact = await put(observer, sectionId, pdf('exact', limit - pdf('exact').length));
  assert.equal(exact.status, 201, JSON.stringify(exact.body));
  assert.equal(exact.body.file.size, limit);
  env.uploadMaxMb = saved;

  // a normal upload, with a hostile file name; replacing it
  const first = pdf('first copy');
  const up = await put(observer, sectionId, first, { qs: `?filename=${enc('../../My "Signed" Form.pdf')}` });
  assert.equal(up.status, 201);
  assert.deepEqual([up.body.file.filename, up.body.file.size, up.body.file.sha256, up.body.file.version, up.body.file.uploadedBy], ['My _Signed_ Form.pdf', first.length, sha(first), 2, observer]);
  assert.ok(!('dataBase64' in up.body.file), 'the bytes are never part of a JSON answer');
  const second = pdf('second copy, a bit longer', 50);
  const again = await put(observer, sectionId, second, { method: 'POST', qs: '?filename=final.pdf' });
  assert.equal(again.status, 201);
  assert.equal(again.body.file.version, 3);
  assert.equal(await ObservationFile.countDocuments(tripleOf(c.section)), 1, 'one file per observation: replaced, not added');
  const viaHeader = await put(observer, sectionId, second, { headers: { ...PDF_HEADERS, 'X-Filename': 'from-header.pdf' } });
  assert.equal(viaHeader.body.file.filename, 'from-header.pdf');
  await put(observer, sectionId, second, { qs: '?filename=final.pdf' });

  // downloads
  // The signed form is part of the report: the observer sees it at once; the professor and the committee only after signatures
  // (the visibility rule is tested end to end in platform/visibility tests).
  for (const who of [c.observee.email, ac.email]) assert.equal((await client.as(who).get(base)).status, 403, `${who} waits for the signatures`);
  for (const who of [observer]) {
    const dl = await client.as(who).get(base);
    assert.equal(dl.status, 200, who);
    assert.equal(dl.headers['content-type'], 'application/pdf');
    assert.equal(dl.headers['content-disposition'], 'attachment; filename="final.pdf"');
    assert.equal(dl.headers['x-content-type-options'], 'nosniff');
    assert.match(dl.headers['cache-control'], /no-store/);
    assert.ok(Buffer.isBuffer(dl.raw) && dl.raw.equals(second), 'the downloaded bytes are exactly what was uploaded');
  }
  assert.equal((await client.as(stranger).get(base)).status, 403);
  assert.equal((await client.as(stranger).get(`/api/observations/${enc(sectionId)}/files`)).status, 403);

  const listed = (await run.who.get(`/api/observations/${enc(sectionId)}/files`)).body.files;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].sha256, sha(second));
  assert.ok(!JSON.stringify(listed).includes('JVBER'), 'no base64 PDF text in the listing');

  // it shows up on the views the frontend already uses
  const mine = (await client.as(observer).get(`/api/observations/mine?term=${enc(TERM)}`)).body;
  assert.equal(mine.asObserver.find((x) => String(x.observation.sectionId) === sectionId).signedTemplate.filename, 'final.pdf');
  const detail = (await run.who.get(`/api/observations/${enc(sectionId)}`)).body;
  assert.equal(detail.signedTemplate.size, second.length);
  const notices = await Notification.find({ recipient_email: c.observee.email, type: 'SIGNED_TEMPLATE_UPLOADED' }).lean();
  assert.equal(notices.length, 5, 'the professor is told after every upload (exact-limit, first, replace, header, final)');
});

test('signed PDF: not before the observation is scheduled, not after it was missed, and two uploads at once are safe', async () => {
  // a signup that nobody confirmed: there is no observer to upload
  const c = sc[4];
  const sectionId = sectionKey(c.section);
  await client.as(c.observee.email).post('/api/signups', { sectionId });
  const stranger = data.professors.find((p) => p.email !== c.observee.email && !p.is_ac_member).email;
  assert.equal((await put(stranger, sectionId, pdf())).status, 403);
  assert.equal((await client.as(c.observee.email).get(`/api/observations/${enc(sectionId)}/calendar.ics`)).status, 409);

  // a seeded observation that was missed: its observer cannot upload
  const missed = (await Observation.find({ status: 'missed' }).lean())[0];
  const r = await put(missed.observer_email, sectionKey(missed), pdf());
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'BAD_STATUS');

  // two uploads racing for the very first copy
  const race = await scheduled(sc[5]);
  const results = await Promise.all([put(race.observer, race.sectionId, pdf('A')), put(race.observer, race.sectionId, pdf('B', 9))]);
  assert.deepEqual(results.map((x) => x.status), [201, 201]);
  assert.deepEqual(results.map((x) => x.body.file.version).sort(), [1, 2]);
  assert.equal(await ObservationFile.countDocuments(tripleOf(sc[5].section)), 1);
});

test('seeded completed observations (no in-app record, no PDF) are still readable through the new views', async () => {
  const done = (await Observation.find({ status: 'completed' }).lean())[0];
  const observee = data.professors.find((p) => data.courseSections.find((s) => sectionKey(s) === sectionKey(done))?.instructor_email === p.email);
  const doneId = enc(sectionKey(done));
  const view = await client.as(observee.email).get(`/api/observations/${doneId}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.signedTemplate, null);
  assert.equal((await client.as(observee.email).get(`/api/observations/${doneId}/calendar.ics`)).status, 200, 'completed with a date: a calendar file is fine');
});

// ----------------------------------------------------------------------------------------------------------------
test('calendar file: only once there is a date; right day and time; the sequence grows when it moves', async () => {
  const c = sc[6];
  const run = await scheduled(c, { date: false });
  const url = `/api/observations/${enc(run.sectionId)}/calendar.ics`;
  const none = await run.who.get(url);
  assert.equal(none.status, 409);
  assert.equal(none.body.code, 'NOT_SCHEDULED');

  const day = nextClassDay(c.section, '2026-10-14');
  await run.who.patch(`/api/observations/${enc(run.sectionId)}/schedule`, { observationDate: day });
  const compact = day.replace(/-/g, '');
  const hhmm = (t) => `${t.replace(':', '')}00`;
  const ics = await run.who.get(url);
  assert.equal(ics.status, 200);
  assert.equal(ics.headers['content-type'], 'text/calendar; charset=utf-8');
  assert.match(ics.headers['content-disposition'], /^attachment; filename="observation-[A-Za-z0-9-]+-\d{4}-\d{2}-\d{2}\.ics"$/);
  assert.ok(ics.text.includes(`DTSTART:${compact}T${hhmm(meetingOf(c.section).startTime)}\r\n`), ics.text);
  assert.ok(ics.text.includes(`DTEND:${compact}T${hhmm(meetingOf(c.section).endTime)}\r\n`));
  assert.ok(ics.text.includes(`UID:observation-${slug(run.sectionId)}@assessment-helper\r\n`));
  assert.match(ics.text, /SEQUENCE:1\r\n/);
  assert.ok(ics.text.includes(c.observee.name.replace(/,/g, '\\,')));

  const other = nextClassDay(c.section, new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10));
  await run.who.patch(`/api/observations/${enc(run.sectionId)}/schedule`, { observationDate: other });
  const moved = (await run.obsApi.get(url)).text;
  assert.match(moved, /SEQUENCE:2\r\n/);
  assert.ok(moved.includes(`DTSTART:${other.replace(/-/g, '')}T`));
  assert.equal((await AC().get(url)).status, 200);
  const stranger = data.professors.find((p) => ![c.observee.email, run.observer, ac.email].includes(p.email)).email;
  assert.equal((await client.as(stranger).get(url)).status, 403);
});

// ----------------------------------------------------------------------------------------------------------------
function parseCsv(text) {
  assert.ok(text.startsWith('﻿'));
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const src = text.slice(1);
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) { if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch; } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; } else cell += ch;
  }
  assert.equal(row.length + cell.length, 0);
  return rows;
}
const asObjects = (rows) => rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])));

test('csv exports: committee only, spreadsheet-safe, and they agree with the JSON endpoints', async () => {
  for (const kind of ['due', 'signups', 'observations', 'workload', 'kpis']) {
    assert.equal((await client.as(nonAc.email).get(`/api/reports/${kind}`)).status, 403, kind);
    assert.equal((await client.anonymous.get(`/api/reports/${kind}`)).status, 401, kind);
    const r = await AC().get(`/api/reports/${kind}?term=${enc(TERM)}`);
    assert.equal(r.status, 200, kind);
    assert.equal(r.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(r.headers['content-disposition'], `attachment; filename="${kind === 'workload' ? 'observer-workload' : kind === 'due' ? 'due-report' : kind}-Fall-2026.csv"`);
    assert.ok(r.text.endsWith('\r\n'));
    const widths = new Set(parseCsv(r.text).map((x) => x.length));
    assert.equal(widths.size, 1, `${kind}: every row has the same number of cells`);
  }
  assert.equal((await AC().get('/api/reports/due?term=Winter 2026')).status, 400);
  assert.equal((await AC().get('/api/reports/due?term=Fall 2031')).status, 404);
  assert.equal((await AC().get('/api/reports/due')).status, 200, 'default term = current cycle');

  // due
  const dueJson = (await AC().get(`/api/cycles/${enc(TERM)}/due-report`)).body.professors;
  const due = asObjects(parseCsv((await AC().get(`/api/reports/due?term=${enc(TERM)}`)).text));
  assert.equal(due.length, dueJson.length);
  assert.deepEqual(due.map((r) => r.Email).sort(), dueJson.map((p) => p.email).sort());
  const sample = dueJson[0];
  const row = due.find((r) => r.Email === sample.email);
  assert.deepEqual([row.Status, row['Hire level'], row['Signed up']], [sample.status, sample.hireLevel, sample.signedUp ? 'yes' : 'no']);

  // signups
  const signupsJson = (await AC().get(`/api/cycles/${enc(TERM)}/signups`)).body;
  const signups = asObjects(parseCsv((await AC().get(`/api/reports/signups?term=${enc(TERM)}`)).text));
  assert.equal(signups.length, signupsJson.count);
  assert.ok(signups.every((r) => r.Course && r.Email));

  // observations: one row per observation; ratings columns; average is the mean of the ratings
  const obsCsv = parseCsv((await AC().get(`/api/reports/observations?term=${enc(TERM)}`)).text);
  const obs = asObjects(obsCsv);
  assert.equal(obs.length, signupsJson.count);
  for (const k of ['organization', 'clarityOfInstruction', 'studentEngagement', 'useOfMaterials', 'classroomEnvironment', 'Average rating', 'Signed PDF on file']) assert.ok(obsCsv[0].includes(k), k);
  const rated = obs.find((r) => r.organization !== '');
  const nums = ['organization', 'clarityOfInstruction', 'studentEngagement', 'useOfMaterials', 'classroomEnvironment'].filter((k) => rated[k] !== '').map((k) => Number(rated[k]));
  assert.equal(Number(rated['Average rating']), Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)));
  assert.ok(obs.some((r) => r['Signed PDF on file'] === 'yes'), 'the observations that got a PDF earlier are marked');
  assert.ok(obs.some((r) => r['Signed PDF on file'] === 'no'));

  // workload + kpis
  const wl = (await AC().get(`/api/admin/analytics/observer-workload?term=${enc(TERM)}`)).body;
  assert.equal(asObjects(parseCsv((await AC().get(`/api/reports/workload?term=${enc(TERM)}`)).text)).length, wl.professors.length);
  const dash = (await AC().get(`/api/admin/dashboard-stats?term=${enc(TERM)}`)).body;
  const kpis = asObjects(parseCsv((await AC().get(`/api/reports/kpis?term=${enc(TERM)}`)).text));
  assert.equal(Number(kpis.find((r) => r.Section === 'Eligibility' && r.Metric === 'accuracy').Value), dash.eligibility.evaluationEligibilityAccuracy);
  assert.equal(Number(kpis.find((r) => r.Section === 'Participation' && r.Metric === 'signups').Value), dash.participation.signups);

  // a hostile name cannot turn into a spreadsheet formula
  const victim = dueJson[0];
  await Professor.updateOne({ email: victim.email }, { $set: { name: '=HYPERLINK("http://evil.example","click")' } });
  const text = (await AC().get(`/api/reports/due?term=${enc(TERM)}`)).text;
  assert.ok(text.includes(`"'=HYPERLINK(""http://evil.example"",""click"")"`), 'text starting with = is stored with a leading apostrophe');
  const parsed = asObjects(parseCsv(text)).find((r) => r.Email === victim.email);
  assert.equal(parsed.Name[0], "'");
  await Professor.updateOne({ email: victim.email }, { $set: { name: victim.name } });
});

// ----------------------------------------------------------------------------------------------------------------
test('workload analytics: committee only, matches the database, and moves when requests are sent and answered', async () => {
  const url = `/api/admin/analytics/observer-workload?term=${enc(TERM)}`;
  assert.equal((await client.as(nonAc.email).get(url)).status, 403);
  assert.equal((await AC().get('/api/admin/analytics/observer-workload?term=Fall 2031')).status, 404);

  const w = (await AC().get(url)).body;
  const sectionIds = new Set((await CourseSection.find({ term: TERM }).lean()).map(sectionKey));
  const matches = (await ObserverMatch.find({}).lean()).filter((m) => sectionIds.has(sectionKey(m)) && m.status !== 'suggested' && m.requested_date);
  assert.equal(w.summary.requestsSent, matches.length, 'requests sent = the non-suggested rows that carry a request date');
  assert.equal(w.professors.reduce((n, p) => n + p.asked, 0), matches.length);
  const observations = (await Observation.find({}).lean()).filter((o) => sectionIds.has(sectionKey(o)) && o.observer_email && ['scheduled', 'completed', 'missed'].includes(o.status));
  assert.equal(w.summary.assignments, observations.length);
  assert.deepEqual(w.professors.map((p) => p.assigned), w.professors.map((p) => p.assigned).sort((a, b) => b - a), 'busiest first');
  assert.equal(w.summary.maxAssignments, w.professors[0].assigned);
  assert.equal(w.summary.busiest[0].assigned, w.summary.maxAssignments);
  assert.equal(w.byHireLevel.reduce((n, l) => n + l.assignments, 0), w.summary.assignments);
  assert.ok(w.professors.every((p) => p.confirmed + p.declined + p.expired + p.cancelled + p.pending === p.asked), 'every request is in exactly one outcome');

  // one more full request/answer cycle changes exactly the right counters
  const c = sc[7];
  const sectionId = sectionKey(c.section);
  const who = client.as(c.observee.email);
  await who.post('/api/signups', { sectionId });
  await AC().post(`/api/matching/generate/${enc(sectionId)}`);
  const [a, b] = (await who.get(`/api/observations/${enc(sectionId)}/candidates`)).body.candidates.map((x) => x.observerEmail);
  await who.post('/api/observation-requests', { sectionId, observerEmails: [a, b] });
  const mid = (await AC().get(url)).body;
  const row = (res, email) => res.professors.find((p) => p.email === email) || { asked: 0, confirmed: 0, cancelled: 0, pending: 0, assigned: 0 };
  assert.equal(row(mid, a).asked, row(w, a).asked + 1);
  assert.equal(row(mid, a).pending, row(w, a).pending + 1);
  await client.as(a).post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' });
  const after = (await AC().get(url)).body;
  assert.equal(row(after, a).confirmed, row(w, a).confirmed + 1);
  assert.equal(row(after, a).assigned, row(w, a).assigned + 1);
  assert.equal(row(after, a).pending, row(w, a).pending);
  assert.equal(row(after, b).cancelled, row(w, b).cancelled + 1, 'the other asked observer was stood down');
  assert.equal(row(after, b).assigned, row(w, b).assigned);
  assert.equal(after.summary.assignments, w.summary.assignments + 1);
  assert.equal(row(after, a).avgResponseHours, 0, 'answered in the same instant (the clock is pinned)');
});
