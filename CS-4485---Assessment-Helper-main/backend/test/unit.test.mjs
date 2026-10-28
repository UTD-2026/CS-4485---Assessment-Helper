// Pure-logic tests: eligibility rules, due/overdue math, observer selection, form records, terms and dates.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculateDueStatus, dueStatusFor, baselineBefore } from '../services/dueStatus.js';
import {
  departmentOf, evaluateEligibility, levelsMatch, levelOf, meetingOf, parseDays, schedulesConflict, toMinutes,
} from '../services/eligibility.js';
import { pickCandidates, shuffled } from '../services/matching.js';
import {
  applyValues, missingRequired, ratingsFromCriteria, snapshotCriteria, summarize, validateValues,
} from '../services/observationRecords.js';
import { DEFAULT_OBSERVATION_FORM, validateFields } from '../services/forms.js';
import { parseIsoDay, weekdayLetter, toIsoDay } from '../services/dates.js';
import { formatTerm, normalizeTerm, parseTerm, termFromDate, termOrdinal } from '../services/terms.js';

// A tiny deterministic random source so the "random 5" tests do not flake.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('terms: parse / normalise / order', () => {
  assert.deepEqual(parseTerm('Fall 2026'), { season: 'Fall', year: 2026 });
  assert.equal(normalizeTerm('fall-2026'), 'Fall 2026');
  assert.equal(normalizeTerm('SPRING_2027'), 'Spring 2027');
  assert.equal(normalizeTerm('Summer 2026'), null, 'Summer is not enabled by default');
  assert.equal(normalizeTerm('Winter 2026'), null);
  assert.equal(normalizeTerm('Fall 26'), null);
  assert.ok(termOrdinal('Spring 2026') < termOrdinal('Fall 2026'));
  assert.ok(termOrdinal('Fall 2026') < termOrdinal('Spring 2027'));
  assert.equal(termOrdinal('Spring 2027') - termOrdinal('Spring 2025'), 4, 'two calendar years = 4 terms');
  assert.equal(formatTerm(termFromDate(new Date('2025-11-06T00:00:00Z'))), 'Fall 2025');
  assert.equal(formatTerm(termFromDate(new Date('2026-03-02T00:00:00Z'))), 'Spring 2026');
});

test('dates: real calendar days only, UTC weekday letters', () => {
  assert.equal(parseIsoDay('2026-02-31'), null);
  assert.equal(parseIsoDay('26-02-03'), null);
  assert.equal(toIsoDay(parseIsoDay('2026-10-12')), '2026-10-12');
  assert.equal(weekdayLetter(parseIsoDay('2026-10-12')), 'M'); // a Monday
  assert.equal(weekdayLetter(parseIsoDay('2026-10-15')), 'R'); // Thursday = R
  assert.equal(weekdayLetter(parseIsoDay('2026-10-17')), 'S');
});

test('eligibility: day parsing handles the seed format (TR = Tue/Thu) and the long forms', () => {
  assert.deepEqual(parseDays('MW'), ['M', 'W']);
  assert.deepEqual(parseDays('TR'), ['T', 'R']);
  assert.deepEqual(parseDays('TT'), ['T', 'R'], "the team's seed writes Tue/Thu as 'TT'");
  assert.deepEqual(parseDays('F'), ['F']);
  assert.deepEqual(parseDays('MWF'), ['M', 'W', 'F']);
  assert.deepEqual(parseDays('TuTh'), ['T', 'R']);
  assert.deepEqual(parseDays(''), []);
  assert.deepEqual(parseDays(null), []);
  assert.equal(toMinutes('08:30'), 510);
  assert.equal(toMinutes('13:00:00'), 780);
  assert.equal(toMinutes('25:00'), null);
});

test('eligibility: meetingOf reads the seed timing text; levelOf reads the course number', () => {
  assert.deepEqual(meetingOf({ timing: 'TT 08:30-09:45' }), { days: 'TR', startTime: '08:30', endTime: '09:45' });
  assert.deepEqual(meetingOf({ timing: 'MW 14:00-15:15' }), { days: 'MW', startTime: '14:00', endTime: '15:15' });
  assert.deepEqual(meetingOf({ timing: 'sometime' }), { days: '', startTime: null, endTime: null });
  assert.deepEqual(meetingOf({}), { days: '', startTime: null, endTime: null });
  assert.equal(levelOf({ course_code: 'CS 3345' }), 3);
  assert.equal(levelOf({ course_code: 'CS 5343' }), 5);
  assert.equal(levelOf({ course_code: 'nope' }), null);
  assert.equal(schedulesConflict({ timing: 'TT 08:30-09:45' }, { timing: 'TT 09:00-10:00' }), true);
  assert.equal(schedulesConflict({ timing: 'TT 08:30-09:45' }, { timing: 'MW 09:00-10:00' }), false);
  assert.equal(schedulesConflict({ timing: 'bad' }, { timing: 'MW 09:00-10:00' }), false, 'unreadable timing never proves a conflict');
});

test('eligibility: schedule conflicts need a shared day AND overlapping times', () => {
  const a = { days: 'MW', startTime: '10:00', endTime: '11:15' };
  assert.equal(schedulesConflict(a, { days: 'MW', startTime: '11:00', endTime: '12:15' }), true, 'overlap');
  assert.equal(schedulesConflict(a, { days: 'MW', startTime: '11:15', endTime: '12:30' }), false, 'back-to-back is fine');
  assert.equal(schedulesConflict(a, { days: 'TR', startTime: '10:00', endTime: '11:15' }), false, 'different days');
  assert.equal(schedulesConflict(a, { days: 'W', startTime: '10:30', endTime: '10:45' }), true, 'one shared day is enough');
  assert.equal(schedulesConflict(a, { days: 'MW', startTime: 'bad', endTime: '12:00' }), false, 'unreadable time never proves a conflict');
});

test('eligibility: the four rules, reported in order', () => {
  const observee = { email: 'o@utdallas.edu', department: 'CS' };
  const section = { course_code: 'CS 3345', days: 'MW', startTime: '10:00', endTime: '11:15' };
  const cand = (over = {}) => ({ email: 'c@utdallas.edu', department: 'CS', ...over });
  const teaches = (over = {}) => ({ course_code: 'CS 3354', days: 'TR', startTime: '10:00', endTime: '11:15', ...over });
  const check = (candidate, candidateSections) => evaluateEligibility({ observee, candidate, section, candidateSections });

  assert.equal(departmentOf(section), 'CS');
  assert.deepEqual(check(cand(), [teaches()]).eligible, true);
  assert.equal(check(observee, [teaches()]).violation, 'SAME_PROFESSOR');
  assert.equal(check(cand({ department: 'SE' }), [teaches()]).violation, 'DIFFERENT_DEPARTMENT');
  assert.equal(check(cand(), [teaches({ course_code: 'CS 4390' })]).violation, 'DIFFERENT_LEVEL');
  assert.equal(check(cand(), []).violation, 'DIFFERENT_LEVEL', 'teaching nothing this term is not eligible');
  assert.equal(check(cand(), [teaches({ days: 'MW', startTime: '10:30', endTime: '11:45' })]).violation, 'SCHEDULE_CONFLICT');
  // a conflict on ANY of their sections counts, even one at another level
  assert.equal(check(cand(), [teaches(), teaches({ course_code: 'CS 1337', days: 'MW', startTime: '09:30', endTime: '10:30' })]).violation, 'SCHEDULE_CONFLICT');
  // first failing rule wins: wrong department AND conflicting time reports the department
  assert.equal(check(cand({ department: 'SE' }), [teaches({ days: 'MW', startTime: '10:00' })]).violation, 'DIFFERENT_DEPARTMENT');
});

test('eligibility: exact level by default, bands on request', () => {
  assert.equal(levelsMatch(3, 3, 'exact'), true);
  assert.equal(levelsMatch(3, 4, 'exact'), false);
  assert.equal(levelsMatch(3, 4, 'band'), true);
  assert.equal(levelsMatch(2, 3, 'band'), false);
  assert.equal(levelsMatch(5, 6, 'band'), true);
  assert.equal(levelsMatch(null, 3, 'exact'), false);
});

test('due status: the committee spec examples (Spring/Fall years)', () => {
  const assistantAfterSpring25 = (current) => calculateDueStatus({ lastTerm: parseTerm('Spring 2025'), yearsBetween: 1, dueWindowTerms: 'year', currentTerm: parseTerm(current) });
  assert.equal(assistantAfterSpring25('Fall 2025').status, 'not_due');
  assert.equal(assistantAfterSpring25('Spring 2026').status, 'due');
  assert.equal(assistantAfterSpring25('Fall 2026').status, 'due', '"Spring 2026 or Fall 2026" are both fine');
  assert.equal(assistantAfterSpring25('Spring 2027').status, 'overdue');
  assert.deepEqual(assistantAfterSpring25('Spring 2026').dueWindow, ['Spring 2026', 'Fall 2026']);

  const associateAfterSpring25 = (current) => calculateDueStatus({ lastTerm: parseTerm('Spring 2025'), yearsBetween: 2, dueWindowTerms: 1, currentTerm: parseTerm(current) });
  assert.equal(associateAfterSpring25('Fall 2026').status, 'not_due');
  assert.equal(associateAfterSpring25('Spring 2027').status, 'due', 'due exactly in Spring 2027');
  assert.equal(associateAfterSpring25('Fall 2027').status, 'overdue', 'overdue from Fall 2027');
  assert.equal(associateAfterSpring25('Spring 2027').anniversary, 'Spring 2027');
});

test('due status: from a professor and a baseline date; never observed = overdue', () => {
  const assistant = { hire_level: 'assistant' };
  const full = { hire_level: 'full' };
  assert.equal(dueStatusFor(assistant, null, 'Fall 2026').status, 'overdue');
  assert.equal(dueStatusFor(assistant, new Date('2025-11-06T00:00:00Z'), 'Fall 2026').status, 'due'); // last Fall 2025
  assert.equal(dueStatusFor(full, new Date('2025-11-06T00:00:00Z'), 'Fall 2026').status, 'not_due');
  assert.equal(dueStatusFor(full, new Date('2024-10-02T00:00:00Z'), 'Fall 2026').status, 'due'); // last Fall 2024 -> due Fall 2026
  assert.equal(dueStatusFor(full, new Date('2024-03-02T00:00:00Z'), 'Fall 2026').status, 'overdue'); // last Spring 2024 -> due Spring 2026
  assert.throws(() => dueStatusFor({ hire_level: 'dean' }, null, 'Fall 2026'));
  assert.throws(() => calculateDueStatus({ lastTerm: parseTerm('Fall 2025'), yearsBetween: 0, dueWindowTerms: 1, currentTerm: parseTerm('Fall 2026') }));
});

test('due status: the baseline ignores observations from the term being judged', () => {
  const prof = { hire_level: 'associate', last_observed: new Date('2026-10-02T00:00:00Z') }; // moved forward when Fall 2026 completed
  const history = [new Date('2024-10-02T00:00:00Z'), new Date('2026-10-02T00:00:00Z')];
  const baseline = baselineBefore(prof, history, 'Fall 2026');
  assert.equal(baseline.toISOString().slice(0, 10), '2024-10-02');
  assert.equal(dueStatusFor(prof, baseline, 'Fall 2026').status, 'due');
});

test('observer selection: none / all (<5) / random 5 (>=5)', () => {
  const pool = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  assert.deepEqual(pickCandidates([]), { chosen: [], mode: 'none' });
  for (const n of [1, 2, 4]) {
    const r = pickCandidates(pool(n), 5, seeded(7));
    assert.equal(r.mode, 'all'); assert.equal(r.chosen.length, n);
  }
  for (const n of [5, 6, 11]) {
    const r = pickCandidates(pool(n), 5, seeded(n));
    assert.equal(r.mode, 'random'); assert.equal(r.chosen.length, 5);
    assert.equal(new Set(r.chosen.map((x) => x.id)).size, 5, 'no duplicates');
    assert.ok(r.chosen.every((x) => x.id < n), 'only from the pool');
  }
  // randomness really varies (different seeds -> not always the same five out of 11)
  const picks = new Set(Array.from({ length: 20 }, (_, i) => pickCandidates(pool(11), 5, seeded(i + 100)).chosen.map((x) => x.id).sort().join(',')));
  assert.ok(picks.size > 3, 'different draws give different lists');
  const input = pool(8); const copy = JSON.stringify(input); shuffled(input, seeded(1));
  assert.equal(JSON.stringify(input), copy, 'shuffle does not mutate its input');
});

test('forms: field validation', () => {
  assert.equal(validateFields(DEFAULT_OBSERVATION_FORM.fields), null);
  assert.match(validateFields([]), /non-empty/);
  assert.match(validateFields([{ key: 'a b', label: 'x', type: 'text' }]), /identifier/);
  assert.match(validateFields([{ key: 'a', label: 'x', type: 'text' }, { key: 'a', label: 'y', type: 'text' }]), /Duplicate/);
  assert.match(validateFields([{ key: 'a', label: 'x', type: 'rating', min: 5, max: 1 }]), /min < max/);
  assert.match(validateFields([{ key: 'a', label: 'x', type: 'dropdown' }]), /rating|text/);
  assert.match(validateFields([{ key: 'a', label: '', type: 'text' }]), /label/);
  assert.match(validateFields([{ key: 'a', label: 'x', type: 'text', weight: -1 }]), /weight/);
  assert.match(validateFields([{ key: '$bad', label: 'x', type: 'text' }]), /identifier/, 'mongo-unsafe keys rejected');
});

test('records: snapshot, validation, required fields, mirrored ratings, score', () => {
  const criteria = snapshotCriteria(DEFAULT_OBSERVATION_FORM);
  assert.equal(criteria.length, 6);
  assert.ok(criteria.every((c) => c.value === null));
  assert.notEqual(criteria[0], DEFAULT_OBSERVATION_FORM.fields[0], 'a copy, not the live template');

  assert.deepEqual(validateValues(criteria, { organization: 4, comments: 'good' }).errors, []);
  assert.match(validateValues(criteria, { organization: 9 }).errors[0], /1 to 5/);
  assert.match(validateValues(criteria, { organization: 3.5 }).errors[0], /whole number/);
  assert.match(validateValues(criteria, { nope: 1 }).errors[0], /not a field/);
  assert.match(validateValues(criteria, { comments: 5 }).errors[0], /text/);
  assert.match(validateValues(criteria, []).errors[0], /object/);

  const partial = applyValues(criteria, { organization: 5, comments: 'x' });
  assert.deepEqual(missingRequired(partial).sort(), ['classroomEnvironment', 'clarityOfInstruction', 'studentEngagement', 'useOfMaterials'].sort());
  const full = applyValues(partial, { clarityOfInstruction: 4, studentEngagement: 3, useOfMaterials: 5, classroomEnvironment: 1 });
  assert.deepEqual(missingRequired(full), []);
  assert.deepEqual(ratingsFromCriteria(full), { organization: 5, clarityOfInstruction: 4, studentEngagement: 3, useOfMaterials: 5, classroomEnvironment: 1 });
  const s = summarize(full);
  assert.equal(s.ratedCount, 5);
  assert.equal(s.weightedPercent, Number(((4 + 3 + 2 + 4 + 0) / 4 / 5).toFixed(4)));
  assert.equal(missingRequired(applyValues(criteria, { comments: '   ' })).includes('comments'), false, 'optional text may stay empty');
});
