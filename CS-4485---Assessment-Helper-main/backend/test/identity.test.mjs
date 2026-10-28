// Who am I (/me), what may I do, the mock NetID sign-in, the Course Book adapter, and the audit log.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { assertProductionSafe, env } from '../config/env.js';
import jwt from '../services/jwt.js';
import * as courseBook from '../services/courseBook.js';
import { setClock } from '../services/clock.js';
import { sectionKey } from '../services/lookup.js';
import { SEED_TODAY, boot, enc, finish, toScheduled, TERM } from './helpers.mjs';
import { request } from './support/fakeExpress.js';
import { createApp } from '../app.js';

let world; let app;
before(async () => { world = await boot(); app = createApp(); });

// ---- /me ---------------------------------------------------------------------------------------------------------------
test('GET /api/me and /api/me/permissions: the resolved user, roles, and what each role may do', async () => {
  const { client, ac, nonAc } = world;
  assert.equal((await client.anonymous.get('/api/me')).status, 401);
  assert.equal((await client.anonymous.get('/api/me/permissions')).status, 401);

  const me = (await client.as(nonAc.email).get('/api/me')).body;
  assert.equal(me.user.email, nonAc.email);
  assert.equal(me.user.netId, nonAc.email.split('@')[0]);
  assert.match(me.user.hireLevelLabel, /^(Assistant|Associate|Full)$/, 'the capitalised name the screens show');
  assert.ok(!JSON.stringify(me).includes('password'));
  assert.deepEqual(me.roles, ['professor']);
  assert.equal(me.currentTerm, TERM);
  assert.ok(['SIGNUP', 'OBSERVATION', 'FEEDBACK', 'CLOSED'].includes(me.phase));

  const prof = (await client.as(nonAc.email).get('/api/me/permissions')).body;
  assert.deepEqual(prof.roles, ['professor']);
  assert.equal(prof.capabilities.canSignUp, true);
  for (const k of ['canManageCycles', 'canEditTemplate', 'canRunObserverSelection', 'canSeeAllFaculty', 'canSeeDashboard', 'canExportReports', 'canSeeSurveyResults', 'canSeeAuditLog']) {
    assert.equal(prof.capabilities[k], false, `${k} is committee-only`);
  }
  assert.equal(prof.scope.viewsAllDepartments, false);
  assert.ok(!prof.permissions.includes('cycles:write'));

  const comm = (await client.as(ac.email).get('/api/me/permissions')).body;
  assert.deepEqual(comm.roles, ['professor', 'committee']);
  assert.ok(Object.values(comm.capabilities).every(Boolean));
  assert.ok(comm.permissions.includes('cycles:write') && comm.permissions.includes('signup:create-own'));
  assert.equal(comm.scope.viewsAllDepartments, true);

  // what it says matches what the server enforces
  assert.equal((await client.as(nonAc.email).get('/api/surveys')).status, 403);
  assert.equal((await client.as(ac.email).get('/api/surveys')).status, 200);
});

// ---- mock NetID ----------------------------------------------------------------------------------------------------------
test('NetID sign-in (mock identity provider): ticket -> callback -> the same session token; one use only', async () => {
  const { client, nonAc } = world;
  const netId = nonAc.email.split('@')[0];
  const providers = (await client.anonymous.get('/api/auth/providers')).body.providers;
  assert.deepEqual(providers.map((p) => [p.id, p.enabled, p.mock]), [['password', true, false], ['netid', true, true]]);

  const issued = await client.anonymous.post('/api/auth/netid/mock/ticket', { netId });
  assert.equal(issued.status, 201);
  assert.equal(issued.body.mock, true);
  const callback = await client.anonymous.post('/api/auth/netid/callback', { ticket: issued.body.ticket });
  assert.equal(callback.status, 200);
  assert.equal(callback.body.provider, 'netid-mock');
  assert.equal(callback.body.professor.email, nonAc.email);
  const token = callback.body.token;
  const me = await request(app, 'GET', '/api/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, nonAc.email);

  const replay = await client.anonymous.post('/api/auth/netid/callback', { ticket: issued.body.ticket });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'TICKET_USED');
});

test('NetID sign-in: bad tickets, unknown NetIDs, tickets are not sessions, and it can be switched off', async () => {
  const { client, nonAc } = world;
  const netId = nonAc.email.split('@')[0];
  assert.equal((await client.anonymous.post('/api/auth/netid/mock/ticket', { netId: 'nobody999' })).body.code, 'UNKNOWN_NETID');
  assert.equal((await client.anonymous.post('/api/auth/netid/mock/ticket', { netId: 'a b!' })).status, 400);
  assert.equal((await client.anonymous.post('/api/auth/netid/mock/ticket', {})).status, 400);
  assert.equal((await client.anonymous.post('/api/auth/netid/callback', {})).status, 400);
  assert.equal((await client.anonymous.post('/api/auth/netid/callback', { ticket: 'garbage' })).status, 401);

  // a ticket signed with the wrong secret, and a session token offered as a ticket
  const forged = jwt.sign({ typ: 'netid-ticket', net: netId, jti: 'x' }, 'not-the-secret', { expiresIn: 60 });
  assert.equal((await client.anonymous.post('/api/auth/netid/callback', { ticket: forged })).status, 401);
  const session = (await client.anonymous.post('/api/auth/login', { username: netId, password: 'Password123!' })).body.token;
  assert.equal((await client.anonymous.post('/api/auth/netid/callback', { ticket: session })).status, 401, 'a session token is not a ticket');

  // a ticket is not a session
  const ticket = (await client.anonymous.post('/api/auth/netid/mock/ticket', { netId })).body.ticket;
  const asBearer = await request(app, 'GET', '/api/me', { headers: { Authorization: `Bearer ${ticket}` } });
  assert.equal(asBearer.status, 401, 'a ticket cannot be used as a login token');

  // a NetID that exists as a login but is not a faculty member cannot be minted (there is no such account), and off means off
  env.netidMode = 'off';
  assert.equal((await client.anonymous.post('/api/auth/netid/mock/ticket', { netId })).status, 404);
  assert.equal((await client.anonymous.post('/api/auth/netid/callback', { ticket })).status, 404);
  assert.equal((await client.anonymous.get('/api/auth/providers')).body.providers.find((p) => p.id === 'netid').enabled, false);
  assert.equal((await client.anonymous.post('/api/auth/login', { username: netId, password: 'Password123!' })).status, 200, 'the password login is unaffected');
  env.netidMode = 'mock';
});

test('production refuses to start with the mock NetID unless that was asked for on purpose', () => {
  const saved = { ...env };
  try {
    Object.assign(env, { nodeEnv: 'production', jwtSecret: 'a-long-random-value', netidMode: 'mock', allowMockNetidInProduction: false });
    assert.throws(() => assertProductionSafe(), /NETID_MODE=mock/);
    env.allowMockNetidInProduction = true;
    assert.doesNotThrow(() => assertProductionSafe());
    Object.assign(env, { netidMode: 'off', allowMockNetidInProduction: false });
    assert.doesNotThrow(() => assertProductionSafe());
    env.jwtSecret = 'change-me';
    assert.throws(() => assertProductionSafe(), /JWT_SECRET/);
  } finally {
    Object.assign(env, saved);
  }
});

// ---- Course Book adapter -----------------------------------------------------------------------------------------------------
const row = (code, n, timing = 'MW 10:00-11:15', email = 'prof@utdallas.edu') => ({ course_code: code, section_number: n, term: TERM, timing, instructor_email: email });
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('Course Book: local data by default, with filters and paging', async () => {
  const { client, nonAc, data } = world;
  courseBook.reset();
  const who = client.as(nonAc.email);
  const all = data.courseSections.filter((s) => s.term === TERM);
  const page = (await who.get(`/api/course-offerings?term=${enc(TERM)}&pageSize=10`)).body;
  assert.equal(page.source, 'local');
  assert.equal(page.warning, null);
  assert.equal(page.offerings.length, 10);
  assert.equal(page.pagination.total, all.length);
  assert.equal(page.pagination.totalPages, Math.ceil(all.length / 10));
  assert.deepEqual(Object.keys(page.offerings[0]).sort(), ['courseCode', 'courseLevel', 'days', 'department', 'endTime', 'instructorEmail', 'sectionId', 'sectionNumber', 'source', 'startTime', 'term', 'timing']);

  const level3 = (await who.get(`/api/course-offerings?term=${enc(TERM)}&level=3&pageSize=100`)).body;
  assert.ok(level3.offerings.length > 0 && level3.offerings.every((o) => o.courseLevel === 3));
  const mine = (await who.get(`/api/course-offerings?term=${enc(TERM)}&instructorEmail=${enc(nonAc.email)}`)).body.offerings;
  assert.ok(mine.length > 0 && mine.every((o) => o.instructorEmail === nonAc.email));
  const oneCode = all[0].course_code;
  const q = (await who.get(`/api/course-offerings?term=${enc(TERM)}&q=${enc(oneCode)}&pageSize=100`)).body.offerings;
  assert.ok(q.length >= 1 && q.every((o) => o.courseCode.includes(oneCode)));
  assert.equal((await who.get('/api/course-offerings?level=12')).status, 400);
  assert.equal((await who.get('/api/course-offerings?page=0')).status, 400);
  assert.equal((await who.get('/api/course-offerings?pageSize=101')).status, 400);
  assert.equal((await who.get('/api/course-offerings?pageSize=abc')).status, 400);
  assert.equal((await client.anonymous.get('/api/course-offerings')).status, 401);
});

test('Course Book: remote mode retries, times out, caches, serves stale data, and falls back to local data', async () => {
  const { client, nonAc } = world;
  const who = client.as(nonAc.email);
  const saved = {
    mode: env.courseBookMode, url: env.courseBookUrl, key: env.courseBookApiKey, retries: env.courseBookRetries, timeout: env.courseBookTimeoutMs, cache: env.courseBookCacheSeconds,
  };
  Object.assign(env, {
    courseBookMode: 'remote', courseBookUrl: 'https://coursebook.example/api/', courseBookApiKey: 'secret-key', courseBookRetries: 2, courseBookTimeoutMs: 50, courseBookCacheSeconds: 600,
  });
  const calls = []; const sleeps = [];
  const script = [];
  courseBook.reset();
  courseBook.configure({
    fetch: async (url, opts) => { calls.push({ url, opts }); const next = script.shift(); if (next instanceof Error) throw next; if (typeof next === 'function') return next(opts); return next; },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  const get = async () => (await who.get(`/api/course-offerings?term=${enc(TERM)}&pageSize=100`)).body;
  try {
    // 1. a 503, a network error, then success: three tries, doubling waits, the key sent, junk rows skipped
    script.push(reply(503, {}), new Error('ECONNRESET'), reply(200, { sections: [row('CS 1111', '001'), row('CS 2222', '002'), { nonsense: true }, row('CS 3333', '001', 'TBA')] }));
    let r = await get();
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [250, 500]);
    assert.equal(calls[0].url, `https://coursebook.example/api/sections?term=${enc(TERM)}`);
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer secret-key');
    assert.equal(r.source, 'coursebook');
    assert.deepEqual(r.offerings.map((o) => o.courseCode), ['CS 1111', 'CS 2222', 'CS 3333'], 'a class with no fixed time (TBA) is still a class');
    assert.deepEqual([r.offerings[2].days, r.offerings[2].startTime], ['', null]);
    assert.match(r.warning, /1 Course Book row\(s\) were unusable/);
    assert.equal(r.offerings[0].source, 'coursebook');

    // 2. within the cache time: no new call
    r = await get();
    assert.equal(r.source, 'cache');
    assert.equal(calls.length, 3);

    // 3. after the cache time, Course Book is down: the last good answer, marked stale
    setClock(new Date(new Date(SEED_TODAY).getTime() + 11 * 60 * 1000));
    script.push(reply(500, {}), reply(500, {}), reply(500, {}));
    r = await get();
    assert.equal(r.source, 'stale-cache');
    assert.match(r.warning, /unavailable \(Course Book answered HTTP 500\)/);
    assert.equal(r.offerings.length, 3);
    assert.equal(calls.length, 6);

    // 4. a wrong key (401) is not retried; nothing cached -> local data
    courseBook.clearCache();
    script.push(reply(401, {}));
    r = await get();
    assert.equal(calls.length, 7, 'one call, no retry for a 4xx');
    assert.equal(r.source, 'local-fallback');
    assert.match(r.warning, /HTTP 401/);
    assert.ok(r.offerings.length > 50 && r.offerings.every((o) => o.source === 'local'));

    // 5. it never hangs: a call that ignores the answer time is cut off at the timeout
    env.courseBookRetries = 0;
    script.push((opts) => new Promise((_, reject) => { opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }));
    const started = Date.now();
    r = await get();
    assert.ok(Date.now() - started < 1000);
    assert.equal(r.source, 'local-fallback');
    assert.match(r.warning, /did not answer within 50 ms/);

    // 6. answers in a shape nobody expects, and a body that is not JSON
    script.push(reply(200, { surprise: [] }));
    assert.match((await get()).warning, /shape this adapter does not know/);
    script.push({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    assert.match((await get()).warning, /did not answer with JSON/);

    // 7. the committee can see the state and clear the cache; nobody else can
    const status = (await client.as(world.ac.email).get('/api/admin/course-book/status')).body;
    assert.deepEqual([status.mode, status.configured, status.hasApiKey, status.retries], ['remote', true, true, 0]);
    assert.ok(status.lastError && !JSON.stringify(status).includes('secret-key'), 'the key is never shown');
    assert.equal((await who.get('/api/admin/course-book/status')).status, 403);
    script.push(reply(200, { sections: [row('CS 9999', '001')] }));
    await get();
    assert.deepEqual((await client.as(world.ac.email).get('/api/admin/course-book/status')).body.cachedTerms, [TERM]);
    const cleared = await client.as(world.ac.email).post('/api/admin/course-book/refresh', { term: TERM });
    assert.deepEqual(cleared.body.status.cachedTerms, []);
    assert.equal((await who.post('/api/admin/course-book/refresh', {})).status, 403);

    // 8. remote mode without an address is a configuration slip, not an outage
    env.courseBookUrl = '';
    r = await get();
    assert.equal(r.source, 'local');
    assert.match(r.warning, /COURSEBOOK_URL is empty/);
  } finally {
    Object.assign(env, {
      courseBookMode: saved.mode, courseBookUrl: saved.url, courseBookApiKey: saved.key, courseBookRetries: saved.retries, courseBookTimeoutMs: saved.timeout, courseBookCacheSeconds: saved.cache,
    });
    courseBook.reset();
    setClock(SEED_TODAY);
  }
});

// ---- audit log ----------------------------------------------------------------------------------------------------------------
test('audit log: workflow steps are recorded with who did them; filterable, paged, committee-only; surveys are not in it', async () => {
  const { client, ac, nonAc, sc } = world;
  const run = await toScheduled(world, sc[0]);
  await finish(run);
  const survey = await client.as(run.c.observee.email).post('/api/surveys', { term: TERM, process_ok: true });
  assert.equal(survey.status, 201);
  const log = (qs = '') => client.as(ac.email).get(`/api/admin/audit-log${qs}`);

  assert.equal((await client.as(nonAc.email).get('/api/admin/audit-log')).status, 403);
  const all = (await log('?pageSize=100')).body;
  const actions = new Set(all.entries.map((e) => e.action));
  for (const a of ['cycle.updated', 'signup.created', 'requests.sent', 'request.confirmed', 'observation.scheduled', 'record.started', 'observation.signed', 'auth.login']) {
    assert.ok(actions.has(a), `${a} is logged`);
  }
  assert.ok(![...actions].some((a) => a.startsWith('survey')), 'a survey is never tied to a name, so it is not logged');
  const times = all.entries.map((e) => new Date(e.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');

  const signed = (await log('?action=observation.signed&pageSize=100')).body.entries.filter((e) => e.targetId === run.sectionId);
  assert.equal(signed.length, 2);
  assert.deepEqual(signed.map((e) => e.detail.role).sort(), ['observee', 'observer']);
  assert.deepEqual(signed.map((e) => e.actorEmail).sort(), [run.c.observee.email, run.observer].sort());
  assert.equal(signed.find((e) => e.detail.role === 'observee').detail.completed, true);

  assert.ok((await log(`?actor=${enc(run.observer)}`)).body.entries.every((e) => e.actorEmail === run.observer));
  assert.ok((await log('?actionPrefix=observation.')).body.entries.every((e) => e.action.startsWith('observation.')));
  assert.ok((await log(`?targetId=${enc(run.sectionId)}`)).body.entries.length >= 6);
  assert.equal((await log(`?targetType=cycle&term=${enc(TERM)}`)).body.entries.every((e) => e.targetType === 'cycle'), true);
  assert.equal((await log('?from=2030-01-01')).body.entries.length, 0);
  assert.ok((await log('?from=2026-01-01&to=2026-12-31')).body.entries.length > 0);
  assert.equal((await log('?from=nonsense')).status, 400);
  assert.equal((await log('?term=nonsense')).status, 400);

  const p1 = (await log('?pageSize=3&page=1')).body;
  const p2 = (await log('?pageSize=3&page=2')).body;
  assert.equal(p1.entries.length, 3);
  assert.deepEqual([p1.pagination.page, p1.pagination.pageSize, p1.pagination.hasNext], [1, 3, true]);
  assert.ok(p1.pagination.total > 6);
  assert.notDeepEqual(p1.entries.map((e) => e._id), p2.entries.map((e) => e._id));

  // sections that failed (a refused sign) leave no entry
  const before = (await log('?action=observation.signed')).body.pagination.total;
  await run.who.post(`/api/observations/${enc(run.sectionId)}/sign`);
  assert.equal((await log('?action=observation.signed')).body.pagination.total, before, 'a refused action is not logged as done');
  setClock(SEED_TODAY);
});
