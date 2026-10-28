// Who may read the observation report, in which order people sign, "Did Not Happen", and the class-time rule.
// The committee's rule: the observer always; the observee after the observer signs; the committee after both sign.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import models from '../models/index.js';
import { meetingOf } from '../services/eligibility.js';
import { setClock } from '../services/clock.js';
import { sectionKey } from '../services/lookup.js';
import {
  VALUES, arrive, boot, enc, pdf, resetClock, toScheduled,
} from './helpers.mjs';

const { Observation } = models;
let world;
const tripleOf = (d) => ({ course_code: d.course_code, section_number: d.section_number, term: d.term });

before(async () => { world = await boot(); });

test('report visibility: observer always, observee after the observer signs, committee after both sign', async () => {
  const { client, AC, ac, data } = world;
  const run = await toScheduled(world, world.sc[0]);
  const { sectionId, who, obsApi, observer } = run;
  const url = `/api/observations/${enc(sectionId)}`;
  const committee = AC();
  const bystander = data.professors.find((p) => ![run.c.observee.email, observer, ac.email].includes(p.email) && !p.is_ac_member).email;
  arrive(run);

  // the observer starts and fills in the form
  assert.equal((await obsApi.post(`${url}/record`)).status, 201);
  assert.equal((await obsApi.put(`${url}/record`, { values: VALUES })).status, 200);

  const asObserver = (await obsApi.get(url)).body.observation;
  assert.equal(asObserver.report.canView, true);
  assert.ok(asObserver.record && asObserver.summary && asObserver.ratings, 'the observer sees their own draft, scores included');

  const asObservee = (await who.get(url)).body.observation;
  assert.equal(asObservee.report.canView, false);
  assert.equal(asObservee.report.reason, 'AWAITING_OBSERVER_SIGNATURE');
  assert.equal(asObservee.report.started, true, 'they can tell a form exists, not what is in it');
  for (const key of ['record', 'ratings', 'summary']) assert.ok(!(key in asObservee), `observee sees no ${key} yet`);
  assert.ok(!JSON.stringify(asObservee).includes('Clear and well paced'), 'no comment text leaks anywhere');

  const asCommittee = (await committee.get(url)).body.observation;
  assert.equal(asCommittee.report.reason, 'AWAITING_BOTH_SIGNATURES');
  for (const key of ['record', 'ratings', 'summary']) assert.ok(!(key in asCommittee), `the committee sees no ${key} yet`);
  assert.equal(asCommittee.status, 'scheduled', 'but the workflow status is visible to the committee');

  assert.equal((await client.as(bystander).get(url)).status, 403, 'a non-participant gets nothing at all');

  // the same hiding in the list the frontend uses
  const mine = (await who.get(`/api/observations/mine?term=${enc('Fall 2026')}`)).body.asObservee.find((x) => x.observation.sectionId === sectionId);
  assert.ok(!('record' in mine.observation) && mine.observation.report.canView === false);

  // the observee cannot sign first
  const tooSoon = await who.post(`${url}/sign`);
  assert.equal(tooSoon.status, 409);
  assert.equal(tooSoon.body.code, 'OBSERVER_MUST_SIGN_FIRST');

  // a signed PDF follows the same rule
  assert.equal((await obsApi.send('PUT', `${url}/files/signed-template`, { raw: pdf(), headers: { 'Content-Type': 'application/pdf' } })).status, 201);
  assert.equal((await who.get(`${url}/files/signed-template`)).status, 403);

  // the observer signs: now the observee may read it
  const signed = await obsApi.post(`${url}/sign`);
  assert.equal(signed.status, 200);
  assert.equal(signed.body.completed, false);
  const nowObservee = (await who.get(url)).body.observation;
  assert.equal(nowObservee.report.canView, true);
  assert.equal(nowObservee.record.criteria.find((c) => c.key === 'organization').value, 5);
  assert.ok(nowObservee.summary);
  assert.equal((await who.get(`${url}/files/signed-template`)).status, 200, 'and the signed form');

  const stillHidden = (await committee.get(url)).body.observation;
  assert.equal(stillHidden.report.canView, false, 'the committee still waits for the second signature');
  assert.equal((await committee.get(`${url}/files/signed-template`)).status, 403);
  const csvEarly = await committee.get(`/api/reports/observations?term=${enc('Fall 2026')}`);
  const row = csvEarly.text.split('\n').find((line) => line.includes(run.c.observee.email));
  assert.ok(row, 'the observation is listed');
  assert.ok(!row.includes(',5,4,5,4,5'), 'but its scores are not in the committee export yet');

  // the observee signs: completed, and now the committee may read it
  const done = await who.post(`${url}/sign`);
  assert.equal(done.status, 200);
  assert.equal(done.body.completed, true);
  const finalView = (await committee.get(url)).body.observation;
  assert.equal(finalView.report.canView, true);
  assert.ok(finalView.record && finalView.ratings.organization === 5);
  assert.equal((await committee.get(`${url}/files/signed-template`)).status, 200);
  const csvDone = await committee.get(`/api/reports/observations?term=${enc('Fall 2026')}`);
  assert.ok(csvDone.text.split('\n').find((line) => line.includes(run.c.observee.email)).includes(',5,4,5,4,5'), 'completed: the scores are in the export');
  resetClock();
});

test('report visibility: the committee sees the seeded completed reports, and an unfinished one never shows scores', async () => {
  const { AC, data } = world;
  const completed = data.observations.find((o) => o.status === 'completed' && o.ratings);
  const id = sectionKey(completed);
  const seen = (await AC().get(`/api/observations/${enc(id)}`)).body.observation;
  assert.equal(seen.report.canView, true);
  assert.deepEqual(seen.ratings, completed.ratings);

  // force an unfinished row to carry scores (old data might): the committee still may not see them
  const open = data.observations.find((o) => o.status === 'scheduled');
  await Observation.updateOne(tripleOf(open), { $set: { ratings: { organization: 3 } } });
  const hidden = (await AC().get(`/api/observations/${enc(sectionKey(open))}`)).body.observation;
  assert.equal(hidden.report.canView, false);
  assert.ok(!('ratings' in hidden));
  await Observation.updateOne(tripleOf(open), { $set: { ratings: null } });
});

test('Did Not Happen: only after the day arrives, only by the two people, not after a signature, then reschedulable', async () => {
  const { client } = world;
  const run = await toScheduled(world, world.sc[1]);
  const url = `/api/observations/${enc(run.sectionId)}`;
  const stranger = world.data.professors.find((p) => ![run.c.observee.email, run.observer].includes(p.email)).email;

  const early = await run.obsApi.post(`${url}/report-not-held`, { reason: 'x' });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'TOO_EARLY', 'cannot say it did not happen before the day');
  arrive(run);
  assert.equal((await client.as(stranger).post(`${url}/report-not-held`, {})).status, 403);
  assert.equal((await run.obsApi.post(`${url}/report-not-held`, { reason: 'a'.repeat(501) })).status, 400);
  const res = await run.obsApi.post(`${url}/report-not-held`, { reason: '  Class was cancelled  ' });
  assert.equal(res.status, 200);
  assert.equal(res.body.observation.status, 'missed');
  assert.equal(res.body.observation.missedReportedBy, run.observer);
  assert.equal(res.body.observation.missedReason, 'Class was cancelled');
  const notice = await models.Notification.find({ recipient_email: run.c.observee.email, type: 'OBSERVATION_MISSED' }).lean();
  assert.equal(notice.length, 1);
  assert.equal((await run.obsApi.post(`${url}/report-not-held`, {})).status, 409, 'already missed');

  // reschedule: the missed marks are cleared
  const nextDay = new Date(`${run.day}T00:00:00Z`);
  let again = null;
  for (let i = 1; i < 10 && !again; i += 1) {
    const d = new Date(nextDay.getTime() + i * 86400000).toISOString().slice(0, 10);
    const r = await run.who.patch(`${url}/schedule`, { observationDate: d });
    if (r.status === 200) again = r.body.observation;
  }
  assert.ok(again && again.status === 'scheduled' && again.missedReportedBy === null && again.missedReason === null);

  // after a signature it is locked
  const run2 = await toScheduled(world, world.sc[2]);
  const url2 = `/api/observations/${enc(run2.sectionId)}`;
  arrive(run2);
  await run2.obsApi.post(`${url2}/record`);
  await run2.obsApi.put(`${url2}/record`, { values: VALUES });
  await run2.obsApi.post(`${url2}/sign`);
  const locked = await run2.who.post(`${url2}/report-not-held`, {});
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, 'LOCKED');
  resetClock();
});

test('observation time: optional, must be the class start, accepts 12-hour text, drives the calendar', async () => {
  const { client } = world;
  const c = world.sc[3];
  const meeting = meetingOf(c.section);
  const sectionId = sectionKey(c.section);
  const who = client.as(c.observee.email);
  const url = `/api/observations/${enc(sectionId)}`;
  await toScheduled(world, c, { date: false });
  const { nextClassDay } = await import('./support/scenarios.js');
  const day = nextClassDay(c.section, '2026-10-14');

  const wrong = await who.patch(`${url}/schedule`, { observationDate: day, observationTime: '23:59' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'NOT_CLASS_TIME');
  assert.equal((await who.patch(`${url}/schedule`, { observationDate: day, observationTime: 'noon-ish' })).status, 400);

  const [h, m] = meeting.startTime.split(':').map(Number);
  const twelveHour = `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  const ok = await who.patch(`${url}/schedule`, { observationDate: day, observationTime: twelveHour });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.observation.observationTime, meeting.startTime, `"${twelveHour}" is stored as ${meeting.startTime}`);

  const left = await who.patch(`${url}/schedule`, { observationDate: day });
  assert.equal(left.body.observation.observationTime, meeting.startTime, 'leaving it out means "at the class start"');

  const ics = await who.get(`${url}/calendar.ics`);
  assert.equal(ics.status, 200);
  assert.ok(ics.text.includes(`DTSTART:${day.replace(/-/g, '')}T${meeting.startTime.replace(':', '')}00`), ics.text);
  const stored = await Observation.findOne(tripleOf(c.section)).lean();
  assert.equal(stored.observation_time, meeting.startTime);
});
