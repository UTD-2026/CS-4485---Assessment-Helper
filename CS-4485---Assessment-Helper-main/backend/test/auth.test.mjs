import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { createApp } from '../app.js';
import { hashPassword, verifyPassword } from '../middleware/auth.js';
import { DEV_PASSWORD, loadSeedWorld, makeClient } from './support/world.js';
import { request } from './support/fakeExpress.js';

let app; let client; let ac; let regular;

before(async () => {
  const data = await loadSeedWorld();
  app = createApp();
  client = makeClient(app);
  ac = data.professors.find((p) => p.is_ac_member);
  regular = data.professors.find((p) => !p.is_ac_member);
});

test('the seed script\'s scrypt hashes verify, wrong passwords do not', async () => {
  const data = await loadSeedWorld();
  assert.equal(verifyPassword(DEV_PASSWORD, data.professors[0].password_hash), true);
  assert.equal(verifyPassword('nope', data.professors[0].password_hash), false);
  assert.equal(verifyPassword(DEV_PASSWORD, 'garbage'), false);
  assert.equal(verifyPassword(DEV_PASSWORD, undefined), false);
  const mine = hashPassword('secret!');
  assert.match(mine, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/, 'same format the seed uses');
  assert.equal(verifyPassword('secret!', mine), true);
});

test('login: success, wrong password, unknown email, missing fields', async () => {
  const ok = await client.anonymous.post('/api/auth/login', { email: regular.email.toUpperCase(), password: DEV_PASSWORD });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token.split('.').length === 3);
  assert.equal(ok.body.professor.email, regular.email);
  assert.equal('passwordHash' in ok.body.professor, false, 'never leaks the hash');

  assert.equal((await client.anonymous.post('/api/auth/login', { email: regular.email, password: 'wrong' })).status, 401);
  assert.equal((await client.anonymous.post('/api/auth/login', { email: 'nobody@utdallas.edu', password: DEV_PASSWORD })).status, 401);
  assert.equal((await client.anonymous.post('/api/auth/login', { email: regular.email })).status, 400);
  assert.equal((await client.anonymous.post('/api/auth/login', {})).status, 400);
});

test('every protected route rejects missing / garbage / tampered tokens', async () => {
  for (const url of ['/api/cycles', '/api/professors', '/api/signups/mine', '/api/notifications', '/api/admin/dashboard-stats']) {
    assert.equal((await client.anonymous.get(url)).status, 401, url);
  }
  const bad = await request(app, 'GET', '/api/cycles', { headers: { Authorization: 'Bearer not.a.jwt' } });
  assert.equal(bad.status, 401);
  const { token } = await client.login(regular.email);
  const [h, p, s] = token.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: ac.email, ac: true })).toString('base64url')}.${s}`;
  assert.equal((await request(app, 'GET', '/api/admin/dashboard-stats', { headers: { Authorization: `Bearer ${forged}` } })).status, 401, 'forged payload fails the signature check');
  assert.equal((await request(app, 'GET', '/api/cycles', { headers: { Authorization: `Basic ${token}` } })).status, 401);
});

test('AC-only routes: AC allowed, everyone else 403', async () => {
  for (const url of ['/api/admin/dashboard-stats', '/api/professors', `/api/cycles/${encodeURIComponent('Fall 2026')}/due-report`]) {
    assert.equal((await client.as(ac.email).get(url)).status, 200, `AC ${url}`);
    assert.equal((await client.as(regular.email).get(url)).status, 403, `non-AC ${url}`);
  }
  assert.equal((await client.as(regular.email).post('/api/cycles', { term: 'Spring 2027' })).status, 403);
  assert.equal((await client.as(regular.email).put('/api/forms/observation', { title: 'x' })).status, 403);
  assert.equal((await client.as(regular.email).post('/api/admin/jobs/run')).status, 403);
});

test('professors: you may read yourself, not others (AC may read anyone); no password hash ever', async () => {
  const other = (await loadSeedWorld()).professors.find((p) => p.email !== regular.email && !p.is_ac_member);
  const me = await client.as(regular.email).get(`/api/professors/${encodeURIComponent(regular.email)}`);
  assert.equal(me.status, 200);
  assert.equal(JSON.stringify(me.body).includes('passwordHash') || JSON.stringify(me.body).includes('password_hash'), false);
  assert.equal((await client.as(regular.email).get(`/api/professors/${encodeURIComponent(other.email)}`)).status, 403);
  assert.equal((await client.as(ac.email).get(`/api/professors/${encodeURIComponent(other.email)}`)).status, 200);
  const list = await client.as(ac.email).get('/api/professors');
  assert.equal(list.body.count, 100);
  assert.equal(JSON.stringify(list.body).includes('passwordHash') || JSON.stringify(list.body).includes('password_hash'), false);
  assert.equal(JSON.stringify(list.body).includes('scrypt'), false);
});

test('unknown routes 404 as JSON; bad JSON body would be a 400', async () => {
  const r = await client.as(regular.email).get('/api/nope');
  assert.equal(r.status, 404);
  assert.ok(r.body.error);
  assert.equal((await client.anonymous.get('/health')).body.ok, true);
});
