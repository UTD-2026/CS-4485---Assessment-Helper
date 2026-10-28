// The API contract (docs/openapi.js) against the code: every route is documented, every documented route exists, the access
// rules it states are the rules the server enforces, and its examples have the shape the server really returns.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OPERATIONS, openApiDocument } from '../docs/openapi.js';
import { request } from './support/fakeExpress.js';
import { createApp } from '../app.js';
import { sectionKey } from '../services/lookup.js';
import { boot, TERM } from './helpers.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let world; let app;
before(async () => { world = await boot(); app = createApp(); });

/** Every `router.get('/x')` in routes/*.js with the prefix app.js mounts it at, and app.js's own routes, as "METHOD /api/x/{id}". */
function routesInCode() {
  const appSource = readFileSync(path.join(root, 'app.js'), 'utf8');
  const fileOf = Object.fromEntries([...appSource.matchAll(/const (\w+) = require\('\.\/routes\/([\w-]+)'\);/g)].map((m) => [m[1], m[2]]));
  const mounts = [...appSource.matchAll(/app\.use\('([^']+)',[^;]*?\b(\w+Router)\)/g)].map((m) => ({ prefix: m[1], file: fileOf[m[2]] })).filter((m) => m.file);
  const found = new Set();
  for (const file of readdirSync(path.join(root, 'routes'))) {
    const name = file.replace(/\.js$/, '');
    const prefixes = mounts.filter((m) => m.file === name).map((m) => m.prefix);
    assert.ok(prefixes.length, `routes/${file} is mounted in app.js`);
    const source = readFileSync(path.join(root, 'routes', file), 'utf8');
    for (const m of source.matchAll(/router\.(get|post|put|patch|delete)\('([^']*)'/g)) {
      for (const prefix of prefixes) found.add(`${m[1].toUpperCase()} ${(prefix + (m[2] === '/' ? '' : m[2])).replace(/:(\w+)/g, '{$1}')}`);
    }
  }
  for (const m of appSource.matchAll(/app\.(get|post)\('(\/[^']*)'/g)) found.add(`${m[1].toUpperCase()} ${m[2]}`);
  return found;
}

test('contract: every route in the code is documented and every documented route exists', () => {
  const inCode = routesInCode();
  const documented = new Set(OPERATIONS.map((o) => `${o.m.toUpperCase()} ${o.p}`));
  assert.equal(documented.size, OPERATIONS.length, 'no operation is listed twice');
  // /health and the OpenAPI document itself are infrastructure, deliberately left out of the contract
  const undocumented = [...inCode].filter((r) => !documented.has(r) && !['GET /health', 'GET /api/docs/openapi.json'].includes(r));
  assert.deepEqual(undocumented, [], 'routes missing from docs/openapi.js');
  const phantom = [...documented].filter((r) => !inCode.has(r));
  assert.deepEqual(phantom, [], 'documented routes that do not exist');
  assert.ok(inCode.size >= 70, `found ${inCode.size} routes`);
});

test('contract: the OpenAPI document is served, well-formed, and every $ref resolves', async () => {
  const res = await world.client.anonymous.get('/api/docs/openapi.json');
  assert.equal(res.status, 200);
  const doc = res.body;
  assert.equal(doc.openapi, '3.0.3');
  assert.deepEqual(doc, JSON.parse(JSON.stringify(openApiDocument())), 'served exactly as built (no key renaming)');
  const ids = new Set();
  let operations = 0;
  for (const [p, methods] of Object.entries(doc.paths)) {
    assert.ok(p.startsWith('/api/'));
    for (const [m, op] of Object.entries(methods)) {
      operations += 1;
      assert.ok(!ids.has(op.operationId), `operationId ${op.operationId} is unique`);
      ids.add(op.operationId);
      assert.ok(op.summary && op.tags.length === 1 && op.responses);
      assert.ok(['public', 'user', 'committee'].includes(op['x-access']));
      assert.equal(Boolean(op.security), op['x-access'] !== 'public', `${m} ${p}: bearer auth iff not public`);
      assert.ok(Object.keys(op.responses).some((c) => c.startsWith('2')), `${m} ${p} documents its success`);
      if (op['x-access'] !== 'public') assert.ok(op.responses['401'], `${m} ${p} documents 401`);
      if (op['x-access'] === 'committee') assert.ok(op.responses['403'], `${m} ${p} documents 403`);
      for (const r of Object.values(op.responses)) if (r.$ref) assert.ok(doc.components.responses[r.$ref.split('/').pop()], r.$ref);
      for (const param of op.parameters || []) {
        if (param.in === 'path') assert.ok(p.includes(`{${param.name}}`));
      }
    }
  }
  assert.equal(operations, OPERATIONS.length);
  assert.ok(doc.components.securitySchemes.bearerAuth);
  assert.match(doc.info.description, /sectionId/);
});

/** A real value for each {placeholder}. */
function fill(p, ctx) {
  return p.replace('{term}', encodeURIComponent(TERM)).replace('{sectionId}', encodeURIComponent(ctx.sectionId)).replace('{email}', encodeURIComponent(ctx.email))
    .replace('{formId}', 'observation').replace('{templateId}', 'end-of-process').replace('{id}', '0123456789abcdef01234567');
}

test('contract: the access level each operation states is what the server enforces', async () => {
  const { client, nonAc, data } = world;
  const completed = data.observations.find((o) => o.status === 'completed');
  const ctx = { sectionId: sectionKey(completed), email: nonAc.email };
  let checked = 0;
  for (const op of OPERATIONS) {
    const url = fill(op.p, ctx);
    const body = op.m === 'get' ? undefined : {};
    const anon = await request(app, op.m.toUpperCase(), url, { body });
    if (op.auth === 'public') {
      assert.notEqual(anon.status, 401, `${op.m} ${op.p} is public`);
      assert.notEqual(anon.status, 403, `${op.m} ${op.p} is public`);
    } else {
      assert.equal(anon.status, 401, `${op.m} ${op.p} needs a login`);
    }
    if (op.auth === 'committee') {
      const res = await client.as(nonAc.email).send(op.m.toUpperCase(), url, { body });
      assert.equal(res.status, 403, `${op.m} ${op.p} is committee-only`);
    }
    checked += 1;
  }
  assert.equal(checked, OPERATIONS.length);
});

/** Every key in `example` (to any depth; first element of an array) exists in `actual`. Returns the paths that do not. */
function missingPaths(example, actual, at = '') {
  if (actual === null || actual === undefined) return actual === null ? [] : [`${at || '.'}: missing`]; // documented as nullable where the example has a value
  if (Array.isArray(example)) {
    if (!Array.isArray(actual)) return [`${at || '.'}: expected a list`];
    if (!example.length || !actual.length) return [];
    // a path counts as missing only if NO element of the real list has it (rows can differ: some have optional parts)
    const perElement = actual.map((item) => missingPaths(example[0], item, `${at}[0]`));
    return perElement.reduce((common, gapsOfItem) => common.filter((g) => gapsOfItem.includes(g)));
  }
  if (example && typeof example === 'object') {
    if (typeof actual !== 'object') return [`${at || '.'}: expected an object`];
    return Object.keys(example).flatMap((k) => (k in actual ? missingPaths(example[k], actual[k], `${at}.${k}`) : [`${at}.${k}`]));
  }
  return [];
}

test('contract: the examples have the shape the server returns (every key in the example is really there)', async () => {
  const { client, ac, data } = world;
  const completed = data.observations.find((o) => o.status === 'completed');
  const ctx = { sectionId: sectionKey(completed), email: ac.email };
  const missingKeys = [];
  let compared = 0;
  for (const op of OPERATIONS.filter((o) => o.m === 'get' && o.response && !o.binary)) {
    const res = await client.as(ac.email).get(fill(op.p, ctx));
    if (res.status !== 200) { missingKeys.push(`${op.p}: answered ${res.status}`); continue; }
    for (const gap of missingPaths(op.response, res.body)) missingKeys.push(`GET ${op.p}: ${gap} is in the example but not in the answer`);
    compared += 1;
  }
  assert.deepEqual(missingKeys, [], 'fix the example in docs/openapi.js');
  assert.ok(compared >= 35, `compared ${compared} examples`);
});

test('contract: documented request bodies are accepted as written', async () => {
  const { client, data, AC } = world;
  const observed = new Set(data.courseSections.filter((x) => x.term === TERM && data.observations.some((o) => o.status === 'completed' && o.course_code === x.course_code && o.section_number === x.section_number && o.term === TERM)).map((x) => x.instructor_email));
  const nonAc = data.professors.find((q) => !q.is_ac_member && !observed.has(q.email));
  const login = OPERATIONS.find((o) => o.p === '/api/auth/login');
  const p = world.data.professors.find((x) => x.email.startsWith('ejg104485'));
  assert.equal((await client.anonymous.post('/api/auth/login', { ...login.body, username: p.email.split('@')[0] })).status, 200);
  const cycle = OPERATIONS.find((o) => o.m === 'post' && o.p === '/api/cycles');
  assert.equal((await AC().post('/api/cycles', cycle.body)).status, 201, 'the example cycle can be created');
  assert.equal((await AC().post('/api/cycles', cycle.body)).status, 409);
  const form = OPERATIONS.find((o) => o.m === 'post' && o.p === '/api/forms');
  assert.equal((await AC().post('/api/forms', form.body)).status, 201);
  const put = OPERATIONS.find((o) => o.m === 'put' && o.p === '/api/forms/{formId}');
  assert.equal((await AC().put('/api/forms/followup', put.body)).status, 200);
  const reminders = OPERATIONS.find((o) => o.p === '/api/cycles/{term}/send-due-reminders');
  assert.equal((await AC().post(`/api/cycles/${encodeURIComponent(TERM)}/send-due-reminders`, reminders.body)).status, 200);
  const survey = OPERATIONS.find((o) => o.m === 'post' && o.p === '/api/surveys');
  assert.equal((await client.as(nonAc.email).post('/api/surveys', survey.body)).status, 409, 'a valid body, refused only because nothing was completed');
  const respond = OPERATIONS.find((o) => o.p === '/api/observation-requests/{sectionId}/respond');
  assert.deepEqual(Object.keys(respond.body), ['response']);
  const schedule = OPERATIONS.find((o) => o.p === '/api/observations/{sectionId}/schedule');
  assert.deepEqual(Object.keys(schedule.body).sort(), ['observationDate', 'observationTime']);
});

test('contract: the examples of the write operations match what a real run returns', async () => {
  const { client, ac, AC, scenarios, data } = world;
  const op = (m, p) => OPERATIONS.find((o) => o.m === m && o.p === p);
  const gaps = [];
  const check = (m, p, res, expectedStatus = 200) => {
    assert.equal(res.status, expectedStatus, `${m} ${p}: ${JSON.stringify(res.body)}`);
    for (const gap of missingPaths(op(m, p).response, res.body)) gaps.push(`${m.toUpperCase()} ${p}: ${gap}`);
  };
  const c = scenarios.many[0];
  const sectionId = sectionKey(c.section);
  const enc = encodeURIComponent;
  const who = client.as(c.observee.email);
  const url = `/api/observations/${enc(sectionId)}`;

  check('post', '/api/signups', await who.post('/api/signups', { sectionId }), 201);
  check('post', '/api/matching/generate/{sectionId}', await AC().post(`/api/matching/generate/${enc(sectionId)}`));
  const list = (await who.get(`${url}/candidates`)).body.candidates.map((x) => x.observerEmail);
  check('post', '/api/observation-requests', await who.post('/api/observation-requests', { sectionId, observerEmails: list.slice(0, 2) }), 201);
  const observer = client.as(list[0]);
  check('post', '/api/observation-requests/{sectionId}/respond', await observer.post(`/api/observation-requests/${enc(sectionId)}/respond`, { response: 'CONFIRM' }));
  const { nextClassDay } = await import('./support/scenarios.js');
  const day = nextClassDay(c.section, '2026-10-14');
  check('patch', '/api/observations/{sectionId}/schedule', await who.patch(`${url}/schedule`, { observationDate: day }));
  check('post', '/api/observations/{sectionId}/record', await observer.post(`${url}/record`), 201);
  check('put', '/api/observations/{sectionId}/record', await observer.put(`${url}/record`, { values: { organization: 4, comments: 'ok' } }));
  const { setClock } = await import('../services/clock.js');
  setClock(`${day}T20:00:00Z`);
  await observer.put(`${url}/record`, { values: { clarityOfInstruction: 4, studentEngagement: 4, useOfMaterials: 4, classroomEnvironment: 4 } });
  check('put', '/api/observations/{sectionId}/files/signed-template', await observer.send('PUT', `${url}/files/signed-template`, { raw: Buffer.from('%PDF-1.4\n%%EOF\n'), headers: { 'Content-Type': 'application/pdf' } }), 201);
  check('post', '/api/observations/{sectionId}/sign', await observer.post(`${url}/sign`));
  check('post', '/api/observations/{sectionId}/sign', await who.post(`${url}/sign`));
  check('get', '/api/observations/{sectionId}/files', await who.get(`${url}/files`));

  // not held on another signup
  const c2 = scenarios.many[1];
  const id2 = sectionKey(c2.section);
  const who2 = client.as(c2.observee.email);
  await who2.post('/api/signups', { sectionId: id2 });
  await AC().post(`/api/matching/generate/${enc(id2)}`);
  const l2 = (await who2.get(`/api/observations/${enc(id2)}/candidates`)).body.candidates.map((x) => x.observerEmail);
  await who2.post('/api/observation-requests', { sectionId: id2, observerEmails: [l2[0]] });
  await client.as(l2[0]).post(`/api/observation-requests/${enc(id2)}/respond`, { response: 'CONFIRM' });
  const d2 = nextClassDay(c2.section, '2026-10-14');
  await who2.patch(`/api/observations/${enc(id2)}/schedule`, { observationDate: d2 });
  setClock(`${d2}T20:00:00Z`);
  check('post', '/api/observations/{sectionId}/report-not-held', await who2.post(`/api/observations/${enc(id2)}/report-not-held`, { reason: 'x' }));

  // survey (the first person is completed now)
  check('post', '/api/surveys', await who.post('/api/surveys', { term: TERM, process_ok: true }), 201);
  check('get', '/api/surveys/status', await who.get(`/api/surveys/status?term=${enc(TERM)}`));
  check('post', '/api/admin/jobs/run', await AC().post('/api/admin/jobs/run'));
  check('post', '/api/admin/surveys/anonymize-legacy', await AC().post('/api/admin/surveys/anonymize-legacy'));
  check('post', '/api/notifications/read-all', await who.post('/api/notifications/read-all'));
  check('get', '/api/notifications', await who.get('/api/notifications'));
  check('get', '/api/observations/mine', await who.get(`/api/observations/mine?term=${enc(TERM)}`));
  check('get', '/api/observation-requests/incoming', await client.as(l2[1]).get('/api/observation-requests/incoming'));
  check('get', '/api/professors', await AC().get('/api/professors'));
  check('get', '/api/sections', await who.get('/api/sections'));
  void ac; void data;
  setClock('2026-10-12T15:00:00Z');
  assert.deepEqual(gaps, [], 'fix the example in docs/openapi.js');
});

test('the committed docs/openapi.json is the current contract (run `npm run docs` if this fails)', () => {
  const committed = readFileSync(path.join(root, 'docs', 'openapi.json'), 'utf8');
  assert.equal(committed, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
});
