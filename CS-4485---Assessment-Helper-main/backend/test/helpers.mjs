// Shared by the newer test files: a seeded world, a client, and "walk one signup through the workflow".
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { sectionKey } from '../services/lookup.js';
import { setClock } from '../services/clock.js';
import { loadSeedWorld, makeClient } from './support/world.js';
import { addSmallDepartments, nextClassDay, pickScenarios } from './support/scenarios.js';

export const TERM = 'Fall 2026';
export const SEED_TODAY = '2026-10-12T15:00:00Z';
export const enc = encodeURIComponent;
export const VALUES = { organization: 5, clarityOfInstruction: 4, studentEngagement: 5, useOfMaterials: 4, classroomEnvironment: 5, comments: 'Clear and well paced.' };
export const pdf = (text = 'hello') => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

export async function boot({ many = 8, few = 0, none = 0, small = false } = {}) {
  const data = await loadSeedWorld();
  if (small) await addSmallDepartments(TERM); // MATH / STAT / SE: the "nobody" and "a couple" situations the big CS seed lacks
  const client = makeClient(createApp());
  const ac = data.professors.find((p) => p.is_ac_member);
  const nonAc = data.professors.find((p) => !p.is_ac_member);
  const scenarios = await pickScenarios(TERM, { many, few, none });
  const sc = scenarios.many;
  const AC = () => client.as(ac.email);
  // The seed's signup deadline (2026-09-18) is already past on the seed's "today"; the committee extends it, as it would in real life.
  assert.equal((await AC().put(`/api/cycles/${enc(TERM)}`, { signupDeadline: '2026-10-20' })).status, 200);
  return {
    data, client, ac, nonAc, sc, scenarios, AC,
  };
}

/** signup -> list -> ask two -> the first confirms -> (optionally) a date. */
export async function toScheduled(world, c, { date = true, time } = {}) {
  const { client, AC } = world;
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
    const res = await who.patch(`/api/observations/${enc(sectionId)}/schedule`, { observationDate: day, ...(time ? { observationTime: time } : {}) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  return {
    c, sectionId, who, observer, obsApi: client.as(observer), standDown: list[1], day, list,
  };
}

export const arrive = (run) => setClock(`${run.day}T16:00:00Z`);
export const resetClock = () => setClock(SEED_TODAY);

/** Observer fills in and signs, then the observee signs: a completed observation. */
export async function finish(run) {
  const url = `/api/observations/${enc(run.sectionId)}`;
  arrive(run);
  assert.equal((await run.obsApi.post(`${url}/record`)).status, 201);
  assert.equal((await run.obsApi.put(`${url}/record`, { values: VALUES })).status, 200);
  assert.equal((await run.obsApi.post(`${url}/sign`)).status, 200);
  const done = await run.who.post(`${url}/sign`);
  assert.equal(done.status, 200);
  assert.equal(done.body.completed, true);
  return done.body.observation;
}
