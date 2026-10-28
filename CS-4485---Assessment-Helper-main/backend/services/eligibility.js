// Eligibility rules for the observer-matching engine (pure functions, no database).
//
// From the Assessment Committee:
//   "A 1000-level Prof of department ABC can only observe another 1000-level Prof in the same department."
//   "System should not show Prof A as a potential Observer for Prof A themself."
//   "System should show 5 Profs who are free at that time AND who teach [same]-level courses in the same department."
//
// A candidate may observe an observee's course section only if ALL hold:
//   1. candidate is not the observee                       (else SAME_PROFESSOR)
//   2. candidate's department is the section's department   (else DIFFERENT_DEPARTMENT)
//   3. candidate teaches at least one section at the same course level this term (else DIFFERENT_LEVEL)
//   4. none of the candidate's sections overlaps in time with the observee's section (else SCHEDULE_CONFLICT)
// The first rule that fails is the reported reason, in that order.
//
// Rule 3 compares course levels exactly by default (LEVEL_MATCHING=band groups 1-2 / 3-4 / 5+ instead).
//
// Data shape (the team's collections):  professor {email, department}
//   section {course_code:'CS 3345', timing:'MW 10:00-11:15'}      (level and meeting days/times are read from those two)

const { env } = require('../config/env');

/**
 * 'MW' -> ['M','W'];  'TR' -> ['T','R'];  'TuTh' -> ['T','R'];  'MWF' -> ['M','W','F'].  R = Thursday.
 * The team's seed data writes Tuesday/Thursday classes as 'TT', which a letter-by-letter reading would take as Tuesday
 * twice; the exact text 'TT' is therefore read as Tuesday + Thursday.
 */
function parseDays(daysString) {
  if (!daysString) return [];
  const s = String(daysString).trim();
  if (s === 'TT') return ['T', 'R'];
  const days = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    const next = s[i + 1];
    if (c === 'T' && next === 'u') { days.push('T'); i += 1; }
    else if (c === 'T' && next === 'h') { days.push('R'); i += 1; }
    else if (c === 'S' && next === 'u') { days.push('U'); i += 1; }
    else if (c === 'S' && next === 'a') { days.push('S'); i += 1; }
    else if ('MTWRFSU'.includes(c)) days.push(c);
    // anything else (spaces, junk) is ignored rather than crashing matching
  }
  return [...new Set(days)];
}

const CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/;

/**
 * "10:00" / "10:00:00" / "8:30 AM" / "1:15pm" -> minutes after midnight, or null if unreadable.
 * (The committee writes 24-hour times in the seed; the frontend's mock data and Course Book style 12-hour times. Both work.)
 */
function toMinutes(time) {
  if (!time) return null;
  const m = CLOCK.exec(String(time).trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

/** 510 -> "08:30" */
const clockText = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Any readable clock time ("8:30 AM", "08:30", "8:30") -> "HH:MM" (24h), or null. */
function normalizeClock(time) {
  const minutes = toMinutes(time);
  return minutes === null ? null : clockText(minutes);
}

const CLOCK_TEXT = '\\d{1,2}:\\d{2}(?:\\s*[AaPp][Mm])?';
const TIMING = new RegExp(`^\\s*([A-Za-z]+)\\s+(${CLOCK_TEXT})(?:\\s*-\\s*(${CLOCK_TEXT}))?\\s*$`);

/**
 * When does this section meet?  {days:'TR', startTime:'08:30', endTime:'09:45'} from  timing: 'TT 08:30-09:45'.
 * Times come back as 24-hour "HH:MM" whichever way they were written: 'MW 8:30 AM' gives startTime '08:30' and no endTime.
 * `days` is the normalised weekday letters (R = Thursday). A section whose timing cannot be read gets days '' and null
 * times, which never "proves" a clash and never blocks choosing an observation date.
 * (Plain objects that already have days / startTime / endTime are used as they are.)
 */
function meetingOf(section) {
  if (section && (section.days !== undefined || section.startTime !== undefined || section.endTime !== undefined) && typeof section.timing !== 'string') {
    return { days: section.days || '', startTime: section.startTime || null, endTime: section.endTime || null };
  }
  const m = TIMING.exec((section && section.timing) || '');
  if (!m) return { days: '', startTime: null, endTime: null };
  const start = normalizeClock(m[2]);
  const end = m[3] ? normalizeClock(m[3]) : null;
  if (start === null) return { days: '', startTime: null, endTime: null };
  return { days: parseDays(m[1]).join(''), startTime: start, endTime: end };
}

/** True when the two meetings share a weekday AND their time ranges overlap. Unreadable times never "prove" a conflict. */
function schedulesConflict(a, b) {
  const ma = meetingOf(a);
  const mb = meetingOf(b);
  const daysA = new Set(parseDays(ma.days));
  if (!parseDays(mb.days).some((d) => daysA.has(d))) return false;
  const [as, ae, bs, be] = [toMinutes(ma.startTime), toMinutes(ma.endTime), toMinutes(mb.startTime), toMinutes(mb.endTime)];
  if ([as, ae, bs, be].some((v) => v === null)) return false;
  return as < be && bs < ae;
}

const bandOf = (level) => (level <= 2 ? 'lower' : level <= 4 ? 'upper' : 'grad');
/** Do two course levels count as "the same level"? */
function levelsMatch(a, b, mode = env.levelMatching) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return mode === 'band' ? bandOf(a) === bandOf(b) : a === b;
}

const departmentOf = (section) => {
  const m = /^\s*([A-Za-z]+)/.exec(section.course_code || '');
  return m ? m[1].toUpperCase() : null;
};

/** The thousands digit of the course number: CS 3345 -> 3. */
function levelOf(section) {
  const m = /(\d)\d{3}/.exec(section.course_code || '');
  return m ? Number(m[1]) : null;
}

/** Describe a meeting for explanations: "MW 10:00-11:15". */
const describeMeeting = (s) => {
  const m = meetingOf(s);
  if (!m.days && !m.startTime) return 'at an unknown time';
  return `${m.days} ${m.startTime}${m.endTime ? `-${m.endTime}` : ''}`.trim();
};

/**
 * @returns {{eligible:boolean, violation:string|null, detail:string|null}}
 */
function evaluateEligibility({
  observee, candidate, section, candidateSections,
}) {
  if (candidate.email === observee.email) {
    return { eligible: false, violation: 'SAME_PROFESSOR', detail: 'A professor cannot observe themself.' };
  }
  const dept = departmentOf(section);
  if (candidate.department !== dept) {
    return { eligible: false, violation: 'DIFFERENT_DEPARTMENT', detail: `${candidate.department} is not ${dept}.` };
  }
  const level = levelOf(section);
  if (!candidateSections.some((s) => levelsMatch(levelOf(s), level))) {
    return { eligible: false, violation: 'DIFFERENT_LEVEL', detail: `Teaches no level-${level}000 course this term.` };
  }
  const clash = candidateSections.find((s) => schedulesConflict(section, s));
  if (clash) {
    return { eligible: false, violation: 'SCHEDULE_CONFLICT', detail: `Teaches ${clash.course_code} ${describeMeeting(clash)}, overlapping ${describeMeeting(section)}.` };
  }
  return { eligible: true, violation: null, detail: null };
}

module.exports = {
  parseDays,
  toMinutes,
  clockText,
  normalizeClock,
  meetingOf,
  schedulesConflict,
  levelsMatch,
  departmentOf,
  levelOf,
  describeMeeting,
  evaluateEligibility,
};
