// Pure-function tests for the frontend-facing additions: CSV, calendar files, upload checks, workload, next-step logic.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildObservationIcs, escapeText, foldLine } from '../services/calendar.js';
import { csvCell, toCsv } from '../services/csv.js';
import { cleanFilename, looksLikePdf } from '../services/files.js';
import { observeeNextAction, observerNextAction } from '../services/overview.js';
import { computeWorkload } from '../services/workload.js';

/** A small RFC 4180 reader, so the tests check what a spreadsheet would actually see. */
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; } else cell += c;
  }
  assert.equal(cell, ''); assert.equal(row.length, 0, 'file ends with a line break');
  return rows;
}

test('csv: quoting, quotes, line breaks, numbers, dates, booleans, empty cells', () => {
  const text = toCsv(
    [{ label: 'Name', key: 'n' }, { label: 'Note', key: 'note' }, { label: 'N', key: 'x' }, { label: 'D', key: 'd' }, { label: 'B', key: 'b' }, { label: 'Z', key: 'z' }],
    [{ n: 'Smith, Jane', note: 'said "hi"\nthen left', x: 4.5, d: new Date('2026-10-13T00:00:00Z'), b: true, z: null }]
  );
  assert.ok(text.startsWith('\uFEFF'), 'byte-order mark for Excel');
  assert.ok(text.endsWith('\r\n'));
  assert.deepEqual(parseCsv(text), [['Name', 'Note', 'N', 'D', 'B', 'Z'], ['Smith, Jane', 'said "hi"\nthen left', '4.5', '2026-10-13', 'true', '']]);
});

test('csv: spreadsheet formulas in text are defused, numbers are not', () => {
  for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x']) assert.equal(csvCell(evil)[0] === "'" || csvCell(evil)[1] === "'", true, evil);
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell(-3), '-3');
  assert.equal(csvCell('Anne-Marie'), 'Anne-Marie');
  assert.equal(csvCell(Number.NaN), '');
});

test('calendar: text escaping and 75-byte line folding (never inside a multi-byte character)', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne', 'semicolons are escaped too (RFC 5545)');
  const long = `SUMMARY:${'é'.repeat(80)}`;
  const folded = foldLine(long).split('\r\n');
  assert.ok(folded.length > 1);
  for (const [i, line] of folded.entries()) {
    assert.ok(Buffer.byteLength(line) <= 75, `line ${i} is ${Buffer.byteLength(line)} bytes`);
    if (i > 0) assert.equal(line[0], ' ');
  }
  assert.equal(folded.map((l, i) => (i ? l.slice(1) : l)).join(''), long, 'unfolding gives the original');
});

const section = { course_code: 'CS 2686', section_number: '003', term: 'Fall 2026', timing: 'MW 10:00-11:15' };
const people = { observee: { name: 'Ada Lovelace, PhD' }, observer: { name: 'Grace Hopper' } };

test('calendar: a timed event, floating local time, stable UID, SEQUENCE grows when the date is moved', () => {
  const observation = {
    observation_date: new Date('2026-10-14T00:00:00Z'),
    status_history: [{ note: 'signup' }, { note: 'date set to 2026-10-14' }, { note: 'date set to 2026-10-19' }],
  };
  const ics = buildObservationIcs({ observation, section, ...people });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line break is CRLF');
  assert.match(ics, /UID:observation-CS-2686-003-Fall-2026@assessment-helper\r\n/);
  assert.match(ics, /DTSTART:20261014T100000\r\n/);
  assert.match(ics, /DTEND:20261014T111500\r\n/);
  assert.match(ics, /SEQUENCE:2\r\n/);
  assert.match(ics, /X-WR-TIMEZONE:America\/Chicago\r\n/);
  assert.match(ics, /SUMMARY:Peer observation: CS 2686 sec 003 \(Ada Lovelace\\, PhD\)\r\n/, 'comma in a name is escaped');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('calendar: no usable class time -> an all-day event', () => {
  const observation = { observation_date: new Date('2026-12-31T00:00:00Z'), status_history: [] };
  const ics = buildObservationIcs({ observation, section: { ...section, timing: 'MW TBA' }, ...people });
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20270101\r\n/, 'the end of an all-day event is the next day');
  const backwards = buildObservationIcs({ observation, section: { ...section, timing: 'MW 11:00-10:00' }, ...people });
  assert.match(backwards, /VALUE=DATE/, 'an end before the start is not trusted');
});

test('upload checks: file names are made safe; only PDFs pass', () => {
  const fb = 'signed-observation-X.pdf';
  assert.equal(cleanFilename('Signed Form.pdf', fb), 'Signed Form.pdf');
  assert.equal(cleanFilename('../../etc/passwd', fb), 'passwd.pdf');
  assert.equal(cleanFilename('C:\\Users\\me\\form.PDF', fb), 'form.pdf');
  assert.equal(cleanFilename('bad<>"|name?.pdf', fb), 'bad____name_.pdf');
  assert.equal(cleanFilename('.hidden', fb), 'hidden.pdf');
  assert.equal(cleanFilename('   ', fb), fb);
  assert.equal(cleanFilename(undefined, fb), fb);
  assert.equal(cleanFilename('???', fb), fb);
  assert.ok(cleanFilename(`${'a'.repeat(300)}.pdf`, fb).length <= 100);
  assert.ok(looksLikePdf(Buffer.from('%PDF-1.7\n1 0 obj\n')));
  assert.ok(looksLikePdf(Buffer.concat([Buffer.from('\n\n  '), Buffer.from('%PDF-1.4 more')])), 'the spec allows a little text before the header');
  assert.ok(!looksLikePdf(Buffer.from('<html>%PDF-</html>'.padStart(2000, ' '))), 'the header must be near the start');
  assert.ok(!looksLikePdf(Buffer.from('MZ\u0090\u0000 program')));
  assert.ok(!looksLikePdf(Buffer.alloc(0)));
  assert.ok(!looksLikePdf('%PDF-1.4 as a string'), 'only real bytes');
});

test('workload: counts only real requests; accept rate and answer time are computed as documented', () => {
  const professors = ['a', 'b', 'c'].map((n) => ({ email: `${n}@utdallas.edu`, name: n.toUpperCase(), department: 'CS', hire_level: 'full' }));
  const sec = (n, term = 'Fall 2026') => ({ course_code: `CS 300${n}`, section_number: '001', term });
  const sections = [sec(1), sec(2), sec(3, 'Spring 2026')];
  const h = (n) => new Date(Date.UTC(2026, 9, 1, n));
  const m = (n, observer_email, status, requested_date, responded_date) => ({ ...sec(n, n === 3 ? 'Spring 2026' : 'Fall 2026'), observer_email, status, requested_date, responded_date });
  const matches = [
    m(1, 'a@utdallas.edu', 'confirmed', h(0), h(10)),
    m(2, 'a@utdallas.edu', 'declined', h(0), h(4)),
    m(2, 'b@utdallas.edu', 'expired', h(0)),
    m(1, 'b@utdallas.edu', 'cancelled', h(0)),
    m(1, 'c@utdallas.edu', 'cancelled', null), // never asked: stood down quietly
    m(2, 'c@utdallas.edu', 'suggested', null),
    m(3, 'a@utdallas.edu', 'confirmed', h(0), h(1)), // another term
  ];
  const observations = [
    { ...sec(1), observer_email: 'a@utdallas.edu', status: 'completed' },
    { ...sec(2), observer_email: null, status: 'signed_up' },
  ];
  const w = computeWorkload({ term: 'Fall 2026', professors, sections, observations, matches });
  const a = w.professors.find((p) => p.email === 'a@utdallas.edu');
  assert.deepEqual([a.asked, a.confirmed, a.declined, a.assigned, a.completed], [2, 1, 1, 1, 1]);
  assert.equal(a.acceptRate, 0.5);
  assert.equal(a.avgResponseHours, 7, '(10h + 4h) / 2');
  const b = w.professors.find((p) => p.email === 'b@utdallas.edu');
  assert.deepEqual([b.asked, b.expired, b.cancelled, b.acceptRate], [2, 1, 1, 0]);
  assert.equal(w.professors.find((p) => p.email === 'c@utdallas.edu'), undefined, 'never asked, nothing assigned: not listed');
  assert.deepEqual([w.summary.observersWithAssignments, w.summary.assignments, w.summary.requestsSent, w.summary.professorsAsked], [1, 1, 4, 2]);
});

// ---- next-step logic -----------------------------------------------------------------------------
const cycle = { signup_deadline: new Date('2026-09-18T00:00:00Z'), observation_deadline: new Date('2026-11-13T00:00:00Z'), feedback_deadline: new Date('2026-11-30T00:00:00Z') };
const counts = (o = {}) => ({ total: 0, suggested: 0, requested: 0, confirmed: 0, declined: 0, expired: 0, cancelled: 0, ...o });
const base = {
  term: 'Fall 2026', phase: 'OBSERVATION', cycle, evaluation: { status: 'due' }, hasCourses: true, observation: null, counts: counts(), surveyDone: false,
  at: new Date('2026-10-14T15:00:00Z'),
};
const code = (extra) => observeeNextAction({ ...base, ...extra }).code;
const obs = (o) => ({ course_code: 'CS 3345', section_number: '001', term: 'Fall 2026', status: 'scheduled', ...o });
const fullRecord = { criteria: [{ key: 'a', required: true, value: 5 }] };
const emptyRecord = { criteria: [{ key: 'a', required: true, value: null }] };

test('next step for the professor being observed, at every stage', () => {
  assert.equal(code({ phase: 'SIGNUP' }), 'SIGN_UP');
  assert.equal(observeeNextAction({ ...base, phase: 'SIGNUP' }).required, true);
  assert.equal(observeeNextAction({ ...base, phase: 'SIGNUP', evaluation: { status: 'not_due' } }).required, false);
  assert.equal(code({ phase: 'OBSERVATION' }), 'SIGNUP_CLOSED');
  assert.equal(code({ hasCourses: false }), 'NO_COURSES');
  assert.equal(code({ observation: obs({ status: 'unmatched' }) }), 'NO_ELIGIBLE_OBSERVERS');
  assert.equal(code({ observation: obs({ status: 'signed_up' }) }), 'WAIT_FOR_LIST');
  assert.equal(code({ observation: obs({ status: 'signed_up' }), counts: counts({ total: 5, suggested: 5 }) }), 'CHOOSE_OBSERVERS');
  assert.equal(code({ observation: obs({ status: 'signed_up' }), counts: counts({ total: 5, suggested: 3, requested: 2 }) }), 'WAIT_FOR_REPLIES');
  assert.equal(code({ observation: obs({ status: 'signed_up' }), counts: counts({ total: 2, expired: 2 }) }), 'RE_REQUEST');
  assert.equal(code({ observation: obs({ status: 'signed_up' }), counts: counts({ total: 2, declined: 1, cancelled: 1 }) }), 'REQUESTS_EXHAUSTED');
  assert.equal(code({ observation: obs({ status: 'scheduled' }) }), 'SET_DATE');
  assert.equal(code({ observation: obs({ observation_date: new Date('2026-10-20T00:00:00Z') }) }), 'OBSERVATION_COMING');
  const today = { observation_date: new Date('2026-10-14T00:00:00Z') };
  assert.equal(code({ observation: obs(today) }), 'WAIT_FOR_OBSERVER_FORM', 'no form yet');
  assert.equal(code({ observation: obs({ ...today, record: emptyRecord }) }), 'WAIT_FOR_OBSERVER_FORM', 'form not finished');
  assert.equal(code({ observation: obs({ ...today, record: fullRecord }) }), 'WAIT_FOR_OBSERVER_FORM', 'the observer has not signed yet, so the professor is not asked to');
  assert.equal(code({ observation: obs({ ...today, record: fullRecord, observer_signed_date: new Date() }) }), 'SIGN');
  assert.equal(code({ observation: obs({ ...today, record: fullRecord, observer_signed_date: new Date(), observee_signed_date: new Date() }) }), 'WAIT_FOR_OBSERVER_SIGNATURE');
  assert.equal(code({ observation: obs({ status: 'missed' }) }), 'RESCHEDULE');
  assert.equal(code({ observation: obs({ status: 'completed' }), phase: 'FEEDBACK' }), 'TAKE_SURVEY');
  assert.equal(code({ observation: obs({ status: 'completed' }), phase: 'FEEDBACK', surveyDone: true }), 'DONE');
  assert.equal(code({ observation: obs({ status: 'completed' }), phase: 'CLOSED' }), 'DONE');
});

test('next step for an observer, at every stage; the PDF upload is asked for only once the observation happened', () => {
  const at = new Date('2026-10-14T15:00:00Z');
  const next = (o, fileUploaded = false) => observerNextAction({ observation: obs(o), fileUploaded, at });
  assert.equal(next({}).code, 'SET_DATE');
  assert.equal(next({ observation_date: new Date('2026-10-20T00:00:00Z') }).code, 'OBSERVATION_COMING');
  assert.equal(next({ observation_date: new Date('2026-10-20T00:00:00Z') }).uploadSignedTemplate, false, 'too early to ask');
  const today = { observation_date: new Date('2026-10-14T00:00:00Z') };
  assert.equal(next(today).code, 'START_FORM');
  const fill = next({ ...today, record: emptyRecord });
  assert.deepEqual([fill.code, fill.missing], ['FILL_FORM', ['a']]);
  assert.equal(next({ ...today, record: fullRecord }).code, 'SIGN');
  assert.equal(next({ ...today, record: fullRecord, observer_signed_date: new Date() }).code, 'WAIT_FOR_OBSERVEE_SIGNATURE');
  assert.equal(next(today).uploadSignedTemplate, true);
  assert.equal(next(today, true).uploadSignedTemplate, false);
  assert.deepEqual([next({ status: 'completed' }).code, next({ status: 'completed' }).uploadSignedTemplate], ['DONE', true]);
  assert.equal(next({ status: 'completed' }, true).uploadSignedTemplate, false);
  assert.equal(next({ status: 'missed' }).code, 'RESCHEDULE');
});
