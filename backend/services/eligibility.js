// Observer eligibility rules (pure functions, no database).
// Adapted from the feature_api branch (services/eligibility.js); the same four rules are
// used by the front end's KPI audit (frontend/src/utils/kpis.js) and add-backend's eligibilityService.
//
// A candidate may observe an observee's section only if ALL hold:
//   1. not the observee                                       (SAME_PROFESSOR)
//   2. same department as the observee                        (DIFFERENT_DEPARTMENT)
//   3. teaches a course of the same level (first digit) this term (DIFFERENT_LEVEL)
//   4. none of their sections overlaps the observee's class time (SCHEDULE_CONFLICT)

/** 'MW' -> ['M','W'];  'TR' -> ['T','R'];  the seed's 'TT' means Tuesday + Thursday. */
function parseDays(text) {
  const s = String(text || "").trim();
  if (s.toUpperCase() === "TT") return ["T", "R"];
  return [...new Set(s.toUpperCase().split("").filter((c) => "MTWRFSU".includes(c)))];
}

/** "08:30" / "8:30 AM" / "1:15pm" -> minutes after midnight (or null). */
function toMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec(String(time || "").trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const clockText = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const CLOCK = "\\d{1,2}:\\d{2}(?:\\s*[AaPp][Mm])?";
const TIMING = new RegExp(`^\\s*([A-Za-z]+)\\s+(${CLOCK})(?:\\s*-\\s*(${CLOCK}))?\\s*$`);

/** "MW 08:30-09:45" -> { days:['M','W'], start: 510, end: 585 } */
function meetingOf(timing) {
  const m = TIMING.exec(String(timing || ""));
  if (!m) return { days: [], start: null, end: null };
  const start = toMinutes(m[2]);
  const end = m[3] ? toMinutes(m[3]) : start === null ? null : start + 75;
  return { days: parseDays(m[1]), start, end };
}

/** True when two class timings share a weekday AND their time ranges overlap. */
function schedulesConflict(a, b) {
  const ma = meetingOf(a);
  const mb = meetingOf(b);
  if (!ma.days.some((d) => mb.days.includes(d))) return false;
  if ([ma.start, ma.end, mb.start, mb.end].some((v) => v === null)) return false;
  return ma.start < mb.end && mb.start < ma.end;
}

const departmentOf = (courseCode) => (/^\s*([A-Za-z]+)/.exec(courseCode || "") || [])[1]?.toUpperCase() || null;
const levelOf = (courseCode) => {
  const m = /(\d)\d{3}/.exec(courseCode || "");
  return m ? Number(m[1]) : null;
};

/**
 * @param observee   { email, department }
 * @param candidate  { email, department }
 * @param section    { course_code, timing }  the observee's section
 * @param candidateSections  the candidate's sections this term
 */
function evaluateEligibility({ observee, candidate, section, candidateSections }) {
  if (candidate.email === observee.email) return { eligible: false, violation: "SAME_PROFESSOR" };
  if (candidate.department !== observee.department) return { eligible: false, violation: "DIFFERENT_DEPARTMENT" };
  const level = levelOf(section.course_code);
  if (!candidateSections.some((s) => levelOf(s.course_code) === level)) return { eligible: false, violation: "DIFFERENT_LEVEL" };
  if (candidateSections.some((s) => schedulesConflict(section.timing, s.timing))) return { eligible: false, violation: "SCHEDULE_CONFLICT" };
  return { eligible: true, violation: null };
}

/** Is `dateStr` (YYYY-MM-DD) one of the class meeting days for `timing`? */
function isMeetingDay(dateStr, timing) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const code = ["U", "M", "T", "W", "R", "F", "S"][d.getUTCDay()];
  return meetingOf(timing).days.includes(code);
}

/** "13:00" -> "1:00 PM" */
function to12h(hhmm) {
  const minutes = toMinutes(hhmm);
  if (minutes === null) return hhmm || "";
  const h = Math.floor(minutes / 60);
  return `${((h + 11) % 12) + 1}:${String(minutes % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "TT 13:00-14:15" -> "TR 1:00 PM - 2:15 PM" (for messages people read) */
function formatTiming(timing) {
  const m = TIMING.exec(String(timing || ""));
  if (!m) return timing || "";
  const days = m[1].toUpperCase() === "TT" ? "TR" : m[1].toUpperCase();
  return `${days} ${to12h(m[2])}${m[3] ? ` - ${to12h(m[3])}` : ""}`;
}

module.exports = {
  to12h,
  formatTiming,
  parseDays,
  toMinutes,
  clockText,
  meetingOf,
  schedulesConflict,
  departmentOf,
  levelOf,
  evaluateEligibility,
  isMeetingDay,
};
