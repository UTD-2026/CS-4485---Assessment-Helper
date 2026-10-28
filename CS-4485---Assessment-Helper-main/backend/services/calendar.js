// A calendar file (.ics, RFC 5545) for one scheduled observation, so either person can add it to Google / Apple / Outlook.
//
// Times are written as "floating" local times (DTSTART:20261014T100000, no Z): 10:00 means 10:00 on the wall clock of
// whoever opens the file. X-WR-TIMEZONE tells Google/Apple which zone the university is in. If the class has no usable
// start/end time the event is an all-day event instead.
const { env } = require('../config/env');
const { now } = require('./clock');
const { toIsoDay } = require('./dates');
const { meetingOf, toMinutes } = require('./eligibility');
const { sectionKey } = require('./lookup');

const CRLF = '\r\n';

/** TEXT values: escape backslash, semicolon, comma and newlines; drop other control characters. */
const escapeText = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** Lines may be at most 75 octets: longer ones are folded onto continuation lines that start with one space. */
function foldLine(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) { // iterates by code point, so a multi-byte character is never cut in half
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > 75) { out.push(current); current = ` ${ch}`; bytes = 1 + size; } else { current += ch; bytes += size; }
  }
  out.push(current);
  return out.join(CRLF);
}

const utcStamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const compactDay = (isoDay) => isoDay.replace(/-/g, '');
const hhmmss = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`;

/** How many times the date has been (re)set: calendar apps use SEQUENCE to replace an older copy of the same event. */
const sequenceOf = (observation) => (observation.status_history || []).filter((h) => /date set/i.test(h.note || '')).length;

function buildObservationIcs({ observation, section, observee, observer }) {
  const day = toIsoDay(observation.observation_date);
  const meeting = meetingOf(section);
  // The visit starts at the time chosen when the date was set (always the class start time); older rows have none, so the
  // class start is used. A class with no readable end time is shown as a 75-minute event.
  const classStart = toMinutes(meeting.startTime);
  const classEnd = toMinutes(meeting.endTime);
  const chosen = observation.observation_time ? toMinutes(observation.observation_time) : null;
  const classTimesBackwards = classStart !== null && classEnd !== null && classEnd <= classStart; // an end before the start is not trusted
  const start = chosen !== null ? chosen : (classTimesBackwards ? null : classStart);
  const duration = classStart !== null && classEnd !== null && classEnd > classStart ? classEnd - classStart : 75;
  const end = start === null ? null : Math.min(start + duration, 24 * 60 - 1);
  const timed = start !== null && end !== null && end > start;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Assessment Helper//Peer Teaching Observation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:${env.calendarTimezone}`,
    'BEGIN:VEVENT',
    `UID:observation-${sectionKey(section).replace(/[^A-Za-z0-9]+/g, '-')}@assessment-helper`,
    `DTSTAMP:${utcStamp(now())}`,
    `SEQUENCE:${sequenceOf(observation)}`,
  ];
  if (timed) {
    lines.push(`DTSTART:${compactDay(day)}T${hhmmss(start)}`, `DTEND:${compactDay(day)}T${hhmmss(end)}`);
  } else {
    const next = toIsoDay(new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000));
    lines.push(`DTSTART;VALUE=DATE:${compactDay(day)}`, `DTEND;VALUE=DATE:${compactDay(next)}`);
  }
  const description = [
    `Peer teaching observation of ${section.course_code} section ${section.section_number} (${section.term}).`,
    `Observee: ${observee.name}`,
    `Observer: ${observer ? observer.name : 'to be confirmed'}`,
    meeting.days || meeting.startTime ? `Class meets ${meeting.days} ${meeting.startTime}${meeting.endTime ? `-${meeting.endTime}` : ''}.` : 'Class meeting time: see the course schedule.',
  ].join('\n');
  lines.push(
    `SUMMARY:${escapeText(`Peer observation: ${section.course_code} sec ${section.section_number} (${observee.name})`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR'
  );
  return lines.map(foldLine).join(CRLF) + CRLF;
}

module.exports = {
  foldLine,
  buildObservationIcs,
  escapeText,
};
