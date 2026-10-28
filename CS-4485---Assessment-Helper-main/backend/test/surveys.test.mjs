// The anonymous survey: the committee learns THAT people answered and WHAT was said, never WHO said it.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { env } from '../config/env.js';
import models from '../models/index.js';
import { loadSeedWorld } from './support/world.js';
import { boot, enc, finish, toScheduled, TERM } from './helpers.mjs';

const { Survey, SurveyResponse, SurveyTemplate } = models;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let world; const people = []; const answered = []; let baseline = 0;

before(async () => {
  world = await boot();
  baseline = await Survey.countDocuments({ term: TERM }); // the seed already has some answers for this term
  for (const c of world.sc.slice(0, 3)) people.push(await finish(await toScheduled(world, c)).then(() => c));
});

test('survey templates: versioned questions the frontend renders; the active one is served', async () => {
  const { client, nonAc } = world;
  const who = client.as(nonAc.email);
  const active = (await who.get('/api/surveys/templates/active')).body.template;
  assert.equal(active.templateId, 'end-of-process');
  assert.equal(active.version, 1);
  assert.deepEqual(active.questions.map((q) => [q.key, q.type, q.required]), [['process_ok', 'yes_no', true], ['difficulties', 'text', false], ['improvements', 'text', false]]);
  const all = (await who.get('/api/surveys/templates')).body.templates;
  assert.ok(all.some((t) => t.templateId === 'end-of-process'));
  assert.equal((await who.get('/api/surveys/templates/end-of-process')).body.template.version, 1);
  assert.equal((await who.get('/api/surveys/templates/nope')).status, 404);
  assert.equal(await SurveyTemplate.countDocuments({ template_id: 'end-of-process' }), 1, 'created once, however often it is asked for');
});

test('survey status: who may answer, and nothing about answers', async () => {
  const { client, data } = world;
  const observed = new Set(data.courseSections.filter((x) => x.term === TERM && data.observations.some((o) => o.status === 'completed' && o.course_code === x.course_code && o.section_number === x.section_number && o.term === TERM)).map((x) => x.instructor_email));
  const nonAc = data.professors.find((p) => !p.is_ac_member && !observed.has(p.email) && !people.some((c) => c.observee.email === p.email));
  const outsider = (await client.as(nonAc.email).get(`/api/surveys/status?term=${enc(TERM)}`)).body;
  assert.equal(outsider.eligible, false);
  assert.equal(outsider.canSubmit, false);
  const observee = (await client.as(people[0].observee.email).get(`/api/surveys/status?term=${enc(TERM)}`)).body;
  assert.deepEqual([observee.eligible, observee.submitted, observee.closed, observee.canSubmit], [true, false, false, true]);
  assert.equal((await client.as(nonAc.email).get('/api/surveys/status?term=nonsense')).status, 400);
  assert.equal((await client.as(nonAc.email).post('/api/surveys', { term: TERM, process_ok: true })).status, 409, 'and the server refuses them too');
});

test('survey anonymity: answers carry no identity and no timestamp; the ledger carries no answers; small groups are withheld', async () => {
  const { client, AC, nonAc } = world;
  const bodyFor = (i) => ({ term: TERM, process_ok: i !== 1, difficulties: `difficulty ${i}`, improvements: `idea ${i}`, has_attachment: i === 2 });

  for (const [i, c] of people.entries()) {
    const res = await client.as(c.observee.email).post('/api/surveys', bodyFor(i));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body.survey).sort(), ['submitted', 'submittedDate', 'term']);
    answered.push(c.observee.email);

    const results = (await AC().get(`/api/surveys?term=${enc(TERM)}`)).body;
    if (i < 2) {
      assert.equal(results.detailsWithheld, true, `${i + 1} answer(s): too few to show without exposing someone`);
      assert.deepEqual(results.responses, []);
      assert.equal(results.summary, null);
    } else {
      assert.equal(results.detailsWithheld, false);
    }
    assert.equal(results.submittedCount, baseline + i + 1, 'the count of people who finished is always shown');
  }

  // what is actually in the database
  const rows = await SurveyResponse.find({ term: TERM }).lean();
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.match(row._id, UUID, 'a random id, not an ObjectId (which would carry the creation time)');
    assert.deepEqual(Object.keys(row).sort(), ['_id', 'answers', 'has_attachment', 'template_id', 'template_version', 'term']);
  }
  const dump = JSON.stringify(rows);
  for (const email of answered) assert.ok(!dump.includes(email) && !dump.includes(email.split('@')[0]), `${email} is nowhere in the answers`);
  const ledger = (await Survey.find({ term: TERM }).lean()).filter((e) => answered.includes(e.professor_email));
  assert.equal(ledger.length, 3);
  for (const entry of ledger) {
    assert.deepEqual([entry.process_rating, entry.positive_feedback, entry.negative_feedback, entry.uploaded_file], [null, '', '', null], 'the ledger holds no answers');
    assert.equal(new Date(entry.submitted_date).getUTCHours(), 0, 'and only the day, not the time');
  }

  // what the committee gets
  const results = (await AC().get(`/api/surveys?term=${enc(TERM)}`)).body;
  assert.deepEqual([results.submittedCount, results.expectedCount >= 3, results.detailsWithheld, results.responseCount], [baseline + 3, true, false, 3]);
  assert.deepEqual(results.summary, { processOk: 2, processNotOk: 1 });
  assert.equal(results.responses.length, 3);
  assert.deepEqual(Object.keys(results.responses[0]).sort(), ['answers', 'hasAttachment', 'responseId', 'templateId', 'templateVersion']);
  const ids = results.responses.map((r) => r.responseId);
  assert.deepEqual(ids, [...ids].sort(), 'always in the order of the random ids, so order cannot hint at who answered when');
  assert.equal(results.responses.filter((r) => r.hasAttachment).length, 1);
  const wire = JSON.stringify(results);
  for (const email of answered) assert.ok(!wire.includes(email), 'no identity in the committee view');
  assert.ok(results.responses.some((r) => r.answers.difficulties === 'difficulty 1'), 'but the answers themselves are there');

  // paging
  const page = (await AC().get(`/api/surveys?term=${enc(TERM)}&page=2&pageSize=2`)).body;
  assert.deepEqual([page.responses.length, page.pagination.total, page.pagination.page, page.pagination.hasNext], [1, 3, 2, false]);

  // the threshold is a setting
  env.surveyMinResponses = 4;
  assert.equal((await AC().get(`/api/surveys?term=${enc(TERM)}`)).body.detailsWithheld, true);
  env.surveyMinResponses = 3;

  // only the committee; the respondent sees only that they finished
  assert.equal((await client.as(nonAc.email).get('/api/surveys')).status, 403);
  const mine = (await client.as(answered[0]).get('/api/surveys/mine')).body.surveys.find((s) => s.term === TERM);
  assert.deepEqual(Object.keys(mine).sort(), ['submittedDate', 'term']);
  const status = (await client.as(answered[0]).get(`/api/surveys/status?term=${enc(TERM)}`)).body;
  assert.deepEqual([status.submitted, status.canSubmit], [true, false]);
});

test('survey rules: once per term, template-checked, and a failed save leaves nothing behind', async () => {
  const { client, sc } = world;
  const dup = await client.as(answered[0]).post('/api/surveys', { term: TERM, process_ok: true });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'ALREADY_SUBMITTED');

  // a fourth person, whose answers fail to save: the ledger must not claim they finished
  const run = await toScheduled(world, sc[4]);
  await finish(run);
  const who = client.as(run.c.observee.email);
  assert.equal((await who.post('/api/surveys', { term: TERM, difficulties: 'x' })).status, 400, 'required question missing');
  assert.equal((await who.post('/api/surveys', { term: TERM, process_ok: 'yes', difficulties: 'y'.repeat(2001) })).status, 400, 'too long');
  assert.equal((await who.post('/api/surveys', { term: TERM, process_ok: true, has_attachment: 'yes' })).status, 400);
  const original = SurveyResponse.create;
  SurveyResponse.create = async () => { throw new Error('disk full'); };
  const spy = console.error; console.error = () => {};
  const failed = await who.post('/api/surveys', { term: TERM, process_ok: true });
  console.error = spy;
  SurveyResponse.create = original;
  assert.equal(failed.status, 500);
  assert.equal(await Survey.countDocuments({ professor_email: run.c.observee.email, term: TERM }), 0, 'no "finished" record without answers');
  const retry = await who.post('/api/surveys', { term: TERM, process_ok: 'ok', improvements: 'camelCase also works' });
  assert.equal(retry.status, 201, 'so they can simply try again');
  const camel = await client.as(run.c.observee.email).get('/api/surveys/mine');
  assert.equal(camel.body.surveys.filter((s) => s.term === TERM).length, 1);
});

test('legacy surveys: answers stored next to a name are moved to anonymous responses and blanked from the ledger', async () => {
  const { client } = world;
  await loadSeedWorld();
  const AC = () => client.as(world.ac.email);
  const before = await Survey.find({}).lean();
  assert.equal(before.length, 90);
  assert.ok(before.every((s) => s.process_rating !== null), 'the seed stores a name and a rating together');
  const dashboardBefore = (await AC().get(`/api/admin/dashboard-stats/survey-completion?term=${enc('Fall 2025')}`)).body;

  const first = await AC().post('/api/admin/surveys/anonymize-legacy');
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.checked, first.body.moved], [90, 90]);
  assert.equal(await SurveyResponse.countDocuments({ template_id: 'legacy-v0' }), 90);
  const after = await Survey.find({}).lean();
  assert.equal(after.length, 90, 'the completion records stay');
  assert.ok(after.every((s) => s.process_rating === null && s.positive_feedback === '' && s.negative_feedback === ''));
  const dump = JSON.stringify(await SurveyResponse.find({}).lean());
  for (const s of before.slice(0, 20)) assert.ok(!dump.includes(s.professor_email), 'no email in any answer');

  const again = await AC().post('/api/admin/surveys/anonymize-legacy');
  assert.equal(again.body.moved, 0, 'safe to run twice');
  assert.equal(await SurveyResponse.countDocuments({}), 90);

  const dashboardAfter = (await AC().get(`/api/admin/dashboard-stats/survey-completion?term=${enc('Fall 2025')}`)).body;
  assert.deepEqual(dashboardAfter, dashboardBefore, 'the committee\'s completion numbers do not change');
  const results = (await AC().get(`/api/surveys?term=${enc('Fall 2025')}`)).body;
  assert.ok(results.responseCount > 0 && results.responses.every((r) => r.templateId === 'legacy-v0'));
  assert.ok(!JSON.stringify(results).includes('@'), 'not an email address anywhere in what the committee receives');
  assert.equal((await client.as(world.nonAc.email).post('/api/admin/surveys/anonymize-legacy')).status, 403);
});
