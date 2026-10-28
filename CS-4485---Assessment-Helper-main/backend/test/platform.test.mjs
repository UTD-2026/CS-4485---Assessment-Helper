// The pieces that replace npm packages (JWT, CORS), the snake_case -> camelCase response layer, the section key,
// and the contract with the team's seed script (collection names).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { before, test } from 'node:test';
import { createApp } from '../app.js';
import { corsMiddleware } from '../middleware/cors.js';
import { camelKey, present } from '../middleware/present.js';
import models from '../models/index.js';
import { parseDuration, sign, verify } from '../services/jwt.js';
import { parseSectionKey, requireSectionKey, sectionKey } from '../services/lookup.js';
import { COLLECTIONS, loadSeedWorld, makeClient } from './support/world.js';

const SECRET = 'test-secret';
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const forge = (header, payload, secret = SECRET) => {
  const data = `${b64(header)}.${b64(payload)}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
};
const nameOf = (fn) => { try { fn(); } catch (e) { return e.name; } return null; };

// ---- JWT ----------------------------------------------------------------------------------------------------------
test('jwt: round trip, subject, expiry, custom claims', () => {
  const t = sign({ ac: true }, SECRET, { subject: 'a@utdallas.edu', expiresIn: '8h' });
  const p = verify(t, SECRET);
  assert.equal(p.sub, 'a@utdallas.edu');
  assert.equal(p.ac, true);
  assert.equal(p.exp - p.iat, 8 * 3600);
  assert.equal(parseDuration('30m'), 1800);
  assert.equal(parseDuration('7d'), 604800);
  assert.equal(parseDuration(90), 90);
  assert.equal(parseDuration('45'), 45);
  for (const bad of ['', 'abc', '-5', '0', '1w', null]) assert.throws(() => parseDuration(bad), /lifetime/, String(bad));
  assert.throws(() => sign({}, ''), /secret/);
});

test('jwt: wrong secret, tampering, alg none / other algs, malformed tokens are all refused', () => {
  const t = sign({ ac: false }, SECRET, { subject: 'a@utdallas.edu', expiresIn: '1h' });
  assert.equal(nameOf(() => verify(t, 'other-secret')), 'JsonWebTokenError');
  const [h, p, s] = t.split('.');
  const evil = b64({ ...JSON.parse(Buffer.from(p, 'base64url')), ac: true });
  assert.equal(nameOf(() => verify(`${h}.${evil}.${s}`, SECRET)), 'JsonWebTokenError', 'payload changed, signature kept');
  assert.equal(nameOf(() => verify(`${b64({ alg: 'none', typ: 'JWT' })}.${p}.`, SECRET)), 'JsonWebTokenError', 'alg none, empty signature');
  assert.equal(nameOf(() => verify(`${b64({ alg: 'none', typ: 'JWT' })}.${p}.${s}`, SECRET)), 'JsonWebTokenError', 'alg none with a signature');
  assert.equal(nameOf(() => verify(forge({ alg: 'HS512', typ: 'JWT' }, { sub: 'x' }), SECRET)), 'JsonWebTokenError', 'only HS256');
  for (const junk of ['', 'a', 'a.b', 'a.b.c.d', '...', 'not a token', `${h}.${p}.${s}.`, 'x'.repeat(5000), null, undefined, 42, {}, ['a', 'b', 'c']]) {
    assert.equal(nameOf(() => verify(junk, SECRET)), 'JsonWebTokenError', JSON.stringify(junk)?.slice(0, 30));
  }
  // base64url has spare bits: a second spelling of the same signature must not verify
  const last = s[s.length - 1];
  const sibling = s.slice(0, -1) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('').find((c) => c !== last && Buffer.from(s.slice(0, -1) + c, 'base64url').equals(Buffer.from(s, 'base64url')));
  assert.ok(sibling !== undefined, 'a second spelling of the signature exists for this token');
  assert.equal(nameOf(() => verify(`${h}.${p}.${sibling}`, SECRET)), 'JsonWebTokenError', 'non-canonical signature');
  assert.equal(nameOf(() => verify(forge({ alg: 'HS256' }, 'a string, not an object'), SECRET)), 'JsonWebTokenError');
  assert.equal(nameOf(() => verify(forge({ alg: 'HS256' }, ['array']), SECRET)), 'JsonWebTokenError');
});

test('jwt: exp and nbf are honoured', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(nameOf(() => verify(forge({ alg: 'HS256' }, { sub: 'x', exp: now - 1 }), SECRET)), 'TokenExpiredError');
  assert.equal(nameOf(() => verify(forge({ alg: 'HS256' }, { sub: 'x', exp: now + 60 }), SECRET)), null);
  assert.equal(nameOf(() => verify(forge({ alg: 'HS256' }, { sub: 'x', nbf: now + 600 }), SECRET)), 'JsonWebTokenError');
  assert.equal(nameOf(() => verify(forge({ alg: 'HS256' }, { sub: 'x', exp: 'soon' }), SECRET)), 'JsonWebTokenError');
});

// ---- CORS ---------------------------------------------------------------------------------------------------------
function run(mw, { method = 'GET', headers = {} } = {}) {
  const out = { headers: {}, status: null, ended: false, nextCalled: false };
  const res = {
    set(k, v) { out.headers[k.toLowerCase()] = v; return res; },
    append(k, v) { const key = k.toLowerCase(); out.headers[key] = out.headers[key] ? `${out.headers[key]}, ${v}` : v; return res; },
    status(c) { out.status = c; return res; },
    end() { out.ended = true; return res; },
  };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  mw({ method, headers: lower }, res, () => { out.nextCalled = true; });
  return out;
}

test('cors: allowed origin, disallowed origin, no Origin, trailing slash, wildcard', () => {
  const mw = corsMiddleware({ origins: ['http://localhost:5173', 'https://app.utdallas.edu/'], exposedHeaders: ['Content-Disposition'] });
  const ok = run(mw, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(ok.headers['access-control-expose-headers'], 'Content-Disposition');
  assert.match(ok.headers.vary, /Origin/);
  assert.equal(ok.nextCalled, true);
  assert.equal(run(mw, { headers: { Origin: 'https://app.utdallas.edu' } }).headers['access-control-allow-origin'], 'https://app.utdallas.edu', 'trailing slash in the config is ignored');
  const bad = run(mw, { headers: { Origin: 'http://evil.example' } });
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
  assert.equal(bad.nextCalled, true, 'the request still runs; the browser just may not read the answer');
  assert.equal(run(mw, { headers: { Origin: 'http://localhost:5173.evil.example' } }).headers['access-control-allow-origin'], undefined, 'prefix match is not a match');
  const none = run(mw);
  assert.equal(none.headers['access-control-allow-origin'], undefined);
  assert.equal(none.nextCalled, true);
  assert.equal(run(corsMiddleware({ origins: ['*'] }), { headers: { Origin: 'http://anything.example' } }).headers['access-control-allow-origin'], '*');
  assert.equal(run(corsMiddleware({ origins: [] }), { headers: { Origin: 'http://localhost:5173' } }).headers['access-control-allow-origin'], undefined, 'no origins configured = nobody allowed');
});

test('cors: preflight is answered with 204 and never reaches the routes; a disallowed preflight gets no permission', () => {
  const mw = corsMiddleware({ origins: ['http://localhost:5173'] });
  const pre = run(mw, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.ended, true);
  assert.equal(pre.nextCalled, false);
  assert.match(pre.headers['access-control-allow-methods'], /PUT/);
  assert.equal(pre.headers['access-control-allow-headers'], 'authorization,content-type');
  assert.ok(Number(pre.headers['access-control-max-age']) > 0);
  const denied = run(mw, { method: 'OPTIONS', headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(denied.status, 204);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  assert.equal(denied.headers['access-control-allow-methods'], undefined);
  // a plain OPTIONS (no Access-Control-Request-Method) is not a preflight
  assert.equal(run(mw, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }).nextCalled, true);
});

// ---- the response layer -------------------------------------------------------------------------------------------
test('present: snake_case keys become camelCase, user-defined keys are left alone, derived fields are added', () => {
  assert.equal(camelKey('course_code'), 'courseCode');
  assert.equal(camelKey('data_base64'), 'dataBase64');
  assert.equal(camelKey('_id'), '_id');
  assert.equal(camelKey('already'), 'already');
  assert.equal(camelKey('is_ac_member'), 'isAcMember');

  const section = { course_code: 'CS 2117', section_number: '001', term: 'Fall 2025', timing: 'TT 08:30-09:45', instructor_email: 'a@utdallas.edu' };
  const out = present({ section, observation: { course_code: 'CS 2117', section_number: '001', term: 'Fall 2025', observer_email: 'b@utdallas.edu', ratings: { clarity_of_instruction: 4 } }, when: new Date('2026-01-01T00:00:00Z'), list: [{ hire_level: 'full' }], none: null });
  assert.equal(out.section.sectionId, 'CS 2117~001~Fall 2025');
  assert.deepEqual([out.section.days, out.section.startTime, out.section.endTime, out.section.courseLevel], ['TR', '08:30', '09:45', 2]);
  assert.equal(out.section.instructorEmail, 'a@utdallas.edu');
  assert.equal(out.observation.sectionId, 'CS 2117~001~Fall 2025');
  assert.equal(out.observation.days, undefined, 'only sections get the derived meeting fields');
  assert.deepEqual(out.observation.ratings, { clarity_of_instruction: 4 }, 'rating keys are the committee\'s data');
  assert.ok(out.when instanceof Date);
  assert.equal(out.list[0].hireLevel, 'full');
  assert.equal(out.none, null);
  assert.equal(present('text'), 'text');
  assert.equal(present(5), 5);
  assert.deepEqual(present({ fields: [{ some_key: 1 }] }), { fields: [{ some_key: 1 }] });
});

// ---- the section key ----------------------------------------------------------------------------------------------
test('section key: round trip and strict parsing (only three plain strings can reach a database filter)', () => {
  const doc = { course_code: 'CS 3345', section_number: '002', term: 'Spring 2027' };
  assert.equal(sectionKey(doc), 'CS 3345~002~Spring 2027');
  assert.deepEqual(parseSectionKey('CS 3345~002~Spring 2027'), doc);
  for (const bad of ['', 'CS 3345', 'CS 3345~002', 'a~b~c~d', '~002~Fall 2026', 'CS 3345~~Fall 2026', ' CS 3345~002~Fall 2026', 'CS 3345~002~Fall 2026 ', 'CS\n3345~002~Fall 2026', 'x'.repeat(61) + '~1~Fall 2026', null, undefined, 5, { $ne: null }, ['a', 'b', 'c'], { course_code: 'CS 1', section_number: '1', term: 'Fall 2026' }]) {
    assert.equal(parseSectionKey(bad), null, JSON.stringify(bad)?.slice(0, 40));
    assert.throws(() => requireSectionKey(bad), (e) => e.status === 400 || e.statusCode === 400, 'requireSectionKey gives a 400');
  }
});

// ---- the API end of it --------------------------------------------------------------------------------------------
let client; let data; let ac;
before(async () => {
  data = await loadSeedWorld();
  client = makeClient(createApp());
  ac = data.professors.find((p) => p.is_ac_member);
});

test('API: responses are camelCase and carry a sectionId; hostile section ids are 400 (never reach the database)', async () => {
  const me = await client.as(ac.email).get('/api/sections');
  assert.equal(me.status, 200);
  const sec = me.body.sections[0];
  assert.ok(sec, 'the committee member teaches something this term');
  assert.match(sec.sectionId, /^[A-Z]+ \d{4}~\d{3}~Fall 2026$/);
  assert.ok('courseCode' in sec && 'instructorEmail' in sec && 'startTime' in sec);
  assert.ok(!('course_code' in sec) && !('instructor_email' in sec), 'no snake_case leaks into the API');
  const text = JSON.stringify((await client.as(ac.email).get('/api/professors')).body);
  assert.ok(!/"[a-z]+_[a-z_]+":/.test(text), 'no snake_case keys anywhere in the professor list');

  const enc = encodeURIComponent;
  for (const bad of ['x', 'CS 1~2', '{"$ne":null}', '%24ne', 'a~b~c~d']) {
    const r = await client.as(ac.email).get(`/api/observations/${enc(bad)}`);
    assert.equal(r.status, 400, bad);
  }
  assert.equal((await client.as(ac.email).post('/api/signups', { sectionId: { $ne: null } })).status, 400, 'an object where a string belongs');
  assert.equal((await client.as(ac.email).post('/api/signups', { sectionId: ['a', 'b', 'c'] })).status, 400);
});

test('API: CORS headers come from CORS_ORIGINS and preflights never need a login', async () => {
  const pre = await client.anonymous.send('OPTIONS', '/api/cycles', { headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], 'http://localhost:5173', 'the Vite dev server is allowed by default');
  const evil = await client.anonymous.send('GET', '/health', { headers: { Origin: 'http://evil.example' } });
  assert.equal(evil.status, 200);
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
});

// ---- the contract with the team's setup and seed scripts ----------------------------------------------------------
test('models: collection names are the ones seed.mjs writes to, and the extra models do not disturb the team\'s six', () => {
  const byKey = { professors: 'Professor', courseSections: 'CourseSection', evaluationCycles: 'EvaluationCycle', observations: 'Observation', observerMatches: 'ObserverMatch', surveys: 'Survey' };
  for (const [seedKey, modelName] of Object.entries(byKey)) {
    assert.equal(models[modelName].collection.name, COLLECTIONS[seedKey], `${modelName} reads the collection ${COLLECTIONS[seedKey]}`);
  }
  assert.deepEqual(Object.keys(models).sort(), ['AuditLog', 'CourseSection', 'EligibilityViolation', 'EvaluationCycle', 'EvaluationForm', 'Notification', 'Observation', 'ObservationFile', 'ObserverMatch', 'Professor', 'Survey', 'SurveyResponse', 'SurveyTemplate']);
  const names = Object.values(models).map((m) => m.collection.name);
  assert.equal(new Set(names).size, names.length, 'every model has its own collection');
});

test('seed: the team\'s own seed rows are valid under the models (enums, required fields, types)', async () => {
  const { Professor, CourseSection, EvaluationCycle, Observation, ObserverMatch, Survey } = models;
  const lists = [[Professor, data.professors], [CourseSection, data.courseSections], [EvaluationCycle, data.evaluationCycles], [Observation, data.observations], [ObserverMatch, data.observerMatches], [Survey, data.surveys]];
  for (const [Model, rows] of lists) {
    const stored = await Model.find({}).lean();
    assert.equal(stored.length, rows.length, `${Model.modelName} rows are all readable`);
  }
  // build every row through the model's own validation by inserting it into an emptied collection
  for (const [Model, rows] of lists) {
    await Model.deleteMany({});
    for (const row of rows) await Model.create(row);
    assert.equal(await Model.countDocuments({}), rows.length, `${Model.modelName}: every seed row passes validation`);
  }
});
