// Assessment Helper - mock data generator / MongoDB seeder (schema v3)
//
// Matches the team's latest ER diagram:
//   Professor (PK email), Course_Section, Evaluation_Cycle (PK term),
//   Observation (PK section_id), Observer_Match (PK section_id + observer_email),
//   Survey (PK professor_email + term)
//
// Setup:   npm i @faker-js/faker mongoose dotenv
// Usage:   node seed/seed.mjs --json   -> writes seed/seed-data.json (no DB needed)
//          node seed/seed.mjs          -> wipes + loads into MONGODB_URI (from .env)
//
// All data is FICTIONAL (FR5 / NFR4). Fixed faker seed => identical data for everyone.
// "Today" is pinned to 2026-10-12 so the current-cycle data is stable.

import "dotenv/config";
import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import { faker } from "@faker-js/faker";
import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";

faker.seed(4485);

// ---------- config ----------
const N_PROFESSORS = 100;
const CURRENT_TERM = "Fall 2026";
const TODAY = "2026-10-12";
const DEV_PASSWORD = "Password123!"; // dev only. Replace with real auth (NetID) later.
// Set to false to seed professors/history only, with no Fall 2026 signups/matches.
const SEED_CURRENT_CYCLE = true;

// Terms, newest first. Index = "terms ago" relative to CURRENT_TERM.
const TERMS = [
  { name: "Fall 2026", start: "2026-08-24" },
  { name: "Spring 2026", start: "2026-01-12" },
  { name: "Fall 2025", start: "2025-08-25" },
  { name: "Spring 2025", start: "2025-01-13" },
  { name: "Fall 2024", start: "2024-08-26" },
  { name: "Spring 2024", start: "2024-01-15" },
  { name: "Fall 2023", start: "2023-08-21" },
  { name: "Spring 2023", start: "2023-01-09" },
];

// weight = how many professors; PHYS is small on purpose to trigger "unmatched" cases
const DEPARTMENTS = [
  { code: "CS", weight: 30 },
  { code: "SE", weight: 22 },
  { code: "ECE", weight: 18 },
  { code: "MATH", weight: 14 },
  { code: "STAT", weight: 10 },
  { code: "PHYS", weight: 6 },
];

const HIRE_LEVELS = [
  { level: "assistant", weight: 35, cycleTerms: 2 }, // every calendar year = 2 semesters
  { level: "associate", weight: 30, cycleTerms: 4 }, // every two years     = 4 semesters
  { level: "full", weight: 35, cycleTerms: 4 },
];

const SLOTS = [
  { days: "MW", start: "08:30", end: "09:45" },
  { days: "MW", start: "10:00", end: "11:15" },
  { days: "MW", start: "13:00", end: "14:15" },
  { days: "MW", start: "14:30", end: "15:45" },
  { days: "TR", start: "08:30", end: "09:45" },
  { days: "TR", start: "10:00", end: "11:15" },
  { days: "TR", start: "13:00", end: "14:15" },
  { days: "TR", start: "14:30", end: "15:45" },
  { days: "F", start: "10:00", end: "12:45" },
];

const LEVELS = [1, 2, 3, 4, 5, 6]; // course level digit: 1xxx..6xxx

// Observation.ratings is a JSON object (no criteria table in this schema); 1-5 scale.
const RATING_KEYS = [
  "organization",
  "clarityOfInstruction",
  "studentEngagement",
  "useOfMaterials",
  "classroomEnvironment",
];

// ---------- helpers ----------
const oid = () => randomBytes(12).toString("hex");
const rand01 = () => faker.number.float({ min: 0, max: 1 });
const weighted = (items) => {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = faker.number.float({ min: 0, max: total });
  for (const i of items) if ((r -= i.weight) <= 0) return i;
  return items[items.length - 1];
};
const hashPassword = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("hex")}`;
};
const makeNetId = (first, last) =>
  (first[0] + last[0] + (last[1] ?? "x")).toLowerCase() + faker.string.numeric(6);

const at = (iso) => new Date(iso + "T12:00:00Z");
const addDays = (iso, n) => {
  const d = at(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nextWeekday = (iso) => {
  const d = at(iso);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((at(b) - at(a)) / 86400000);
const dateBetween = (a, b) =>
  nextWeekday(addDays(a, faker.number.int({ min: 0, max: Math.max(0, daysBetween(a, b)) })));
const band = (level) => (level <= 2 ? "lower" : level <= 4 ? "upper" : "grad");

const mkRatings = () =>
  Object.fromEntries(
    RATING_KEYS.map((k) => [
      k,
      faker.helpers.weightedArrayElement([
        { weight: 1, value: 2 },
        { weight: 3, value: 3 },
        { weight: 5, value: 4 },
        { weight: 5, value: 5 },
      ]),
    ])
  );

// ---------- Due/overdue rule (assumption: confirm with Prof. Priya) ----------
// assistant: due after 2 semesters, associate/full: after 4.
// due = exactly at the threshold, overdue = beyond it. Never observed = overdue.
// Copy this into backend/services/dueStatus.js for the API.
function dueStatus(professor, lastObserved) {
  const cycle = HIRE_LEVELS.find((h) => h.level === professor.hireLevel).cycleTerms;
  if (!lastObserved) return "overdue";
  const ago = TERMS.findIndex((t) => at(lastObserved) >= at(t.start));
  if (ago < cycle) return "not_due";
  return ago === cycle ? "due" : "overdue";
}

// ---------- professors (PK = email) ----------
const professors = [];
const usedNetIds = new Set();
const pwHash = hashPassword(DEV_PASSWORD); // same hash for all dev accounts (fast)

for (let i = 0; i < N_PROFESSORS; i++) {
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  let nid = makeNetId(first, last);
  while (usedNetIds.has(nid)) nid = makeNetId(first, last);
  usedNetIds.add(nid);

  professors.push({
    email: `${nid}@example-university.edu`, // fake domain on purpose; prefix = NetID
    name: `${first} ${last}`,
    department: weighted(DEPARTMENTS).code,
    hireLevel: weighted(HIRE_LEVELS).level,
    lastObserved: null, // filled in from observation history below
    passwordHash: pwHash,
    isAcMember: false,
  });
}

// 3 AC members + deterministic demo accounts
const pick = (pred) => professors.find(pred);
[
  pick((p) => p.department === "CS" && p.hireLevel === "full"),
  pick((p) => p.department === "SE" && p.hireLevel === "associate"),
  pick((p) => p.department === "MATH" && p.hireLevel === "full"),
]
  .filter(Boolean)
  .forEach((p) => (p.isAcMember = true));

const demo = {
  ac: pick((p) => p.isAcMember),
  assistant: pick((p) => p.hireLevel === "assistant" && p.department === "CS"),
  associate: pick((p) => p.hireLevel === "associate" && p.department === "CS" && !p.isAcMember),
  full: pick((p) => p.hireLevel === "full" && !p.isAcMember && p.department === "ECE"),
};

// ---------- evaluation cycles (PK = term). Needed for every term that has sections ----------
const evaluationCycles = TERMS.map((t, idx) =>
  idx === 0
    ? {
        term: t.name,
        signupDeadline: "2026-09-18",
        observationDeadline: "2026-11-13",
        feedbackDeadline: "2026-11-30",
      }
    : {
        term: t.name,
        signupDeadline: addDays(t.start, 25),
        observationDeadline: addDays(t.start, 80),
        feedbackDeadline: addDays(t.start, 98),
      }
);

// ---------- course sections ----------
const courseSections = [];
function mkSection(p, term, usedSlots) {
  const level = faker.helpers.arrayElement(
    p.hireLevel === "assistant" ? [1, 2, 3, 4, 5] : LEVELS
  );
  const slot = faker.helpers.arrayElement(SLOTS);
  const key = slot.days + slot.start;
  if (usedSlots?.has(key)) return null; // no self-conflicts
  usedSlots?.add(key);
  return {
    _id: oid(), // = section_id
    courseCode: `${p.department} ${level}${faker.string.numeric(3)}`,
    courseLevel: level, // extra: derived from courseCode, handy for matching
    sectionNumber: faker.helpers.arrayElement(["001", "002", "003", "501", "0W1"]),
    term,
    timing: `${slot.days} ${slot.start}-${slot.end}`,
    days: slot.days, // extra: structured copy of `timing` for conflict checks
    startTime: slot.start,
    endTime: slot.end,
    instructorEmail: p.email,
  };
}

// ---------- history: one completed observation per professor at "termsAgo" ----------
// null = never observed. Weighted so roughly 30% overdue, 20% due, rest not due.
const termsAgoOf = new Map();
for (const p of professors) {
  const cycle = HIRE_LEVELS.find((h) => h.level === p.hireLevel).cycleTerms;
  const roll = rand01();
  let ago;
  if (roll < 0.1) ago = null; // never observed
  else if (roll < 0.4) ago = faker.number.int({ min: 1, max: cycle - 1 }); // not due yet
  else if (roll < 0.65) ago = cycle; // due this term
  else ago = faker.number.int({ min: cycle + 1, max: TERMS.length - 1 }); // overdue
  termsAgoOf.set(p.email, ago);
}
// guarantee a spread for the demo accounts
if (demo.assistant) termsAgoOf.set(demo.assistant.email, 3); // overdue (assistant cycle = 2)
if (demo.associate) termsAgoOf.set(demo.associate.email, 4); // due     (cycle = 4)
if (demo.full) termsAgoOf.set(demo.full.email, 1); // not due

const observations = [];
const observerMatches = [];
const surveys = [];

function mkSurvey(professorEmail, term, submittedDate) {
  return {
    professorEmail,
    term,
    processRating: faker.helpers.weightedArrayElement([
      { weight: 1, value: 2 },
      { weight: 3, value: 3 },
      { weight: 5, value: 4 },
      { weight: 5, value: 5 },
    ]),
    positiveFeedback: faker.lorem.sentences(2),
    negativeFeedback: rand01() < 0.6 ? faker.lorem.sentence() : "",
    uploadedFile: null,
    submittedDate,
  };
}

for (const p of professors) {
  const ago = termsAgoOf.get(p.email);
  if (ago == null) continue;
  const term = TERMS[ago];

  const section = mkSection(p, term.name, null);
  courseSections.push(section);

  const sameDept = professors.filter((o) => o.email !== p.email && o.department === p.department);
  const observer = faker.helpers.arrayElement(
    sameDept.length ? sameDept : professors.filter((o) => o.email !== p.email)
  );

  const signupDate = dateBetween(addDays(term.start, 1), addDays(term.start, 18));
  const requestedDate = dateBetween(addDays(signupDate, 1), addDays(signupDate, 7));
  const observationDate = dateBetween(addDays(term.start, 35), addDays(term.start, 78));

  observations.push({
    sectionId: section._id,
    observerEmail: observer.email,
    signupDate,
    observationDate,
    status: "completed",
    observerSignedDate: nextWeekday(addDays(observationDate, faker.number.int({ min: 0, max: 2 }))),
    observeeSignedDate: nextWeekday(addDays(observationDate, faker.number.int({ min: 0, max: 2 }))),
    ratings: mkRatings(),
  });
  observerMatches.push({
    sectionId: section._id,
    observerEmail: observer.email,
    requestedDate,
    status: "confirmed",
  });
  if (rand01() < 0.9)
    surveys.push(
      mkSurvey(p.email, term.name, dateBetween(addDays(observationDate, 3), addDays(observationDate, 14)))
    );
  p.lastObserved = observationDate;
}

// ---------- current cycle (Fall 2026) ----------
const currentSections = new Map();
for (const p of professors) {
  const used = new Set();
  const list = [];
  const n = faker.number.int({ min: 1, max: 3 });
  for (let k = 0; k < n; k++) {
    const s = mkSection(p, CURRENT_TERM, used);
    if (s) {
      list.push(s);
      courseSections.push(s);
    }
  }
  currentSections.set(p.email, list);
}

// due status as of the START of the cycle (before any Fall 2026 observation is completed)
const dueAtStart = new Map(professors.map((p) => [p.email, dueStatus(p, p.lastObserved)]));

// Who signs up: most due/overdue professors, a few volunteers who aren't due.
// demo.assistant always signs up; demo.associate never does (so you can test signup).
const signedUp = SEED_CURRENT_CYCLE
  ? professors.filter((p) => {
      if (p === demo.associate) return false;
      if (p === demo.assistant) return true;
      return rand01() < (dueAtStart.get(p.email) === "not_due" ? 0.1 : 0.75);
    })
  : [];

// SIMPLIFIED matching used only to seed data (Scott's real algorithm replaces this).
// Eligible observer = signed up, same department, not the observee, teaches a course in
// the same level band as the observee's section, and isn't teaching at that time.
function eligibleObservers(observee, section) {
  return signedUp.filter((o) => {
    if (o.email === observee.email || o.department !== observee.department) return false;
    const theirs = currentSections.get(o.email);
    const sameBand = theirs.some((s) => band(s.courseLevel) === band(section.courseLevel));
    const busy = theirs.some((s) => s.days === section.days && s.startTime === section.startTime);
    return sameBand && !busy;
  });
}

for (const p of signedUp) {
  const section = faker.helpers.arrayElement(currentSections.get(p.email));
  const matches = faker.helpers.shuffle([...eligibleObservers(p, section)]).slice(0, 5);
  const signupDate = dateBetween("2026-08-25", "2026-09-18");

  let status;
  if (!matches.length) status = "unmatched";
  else if (p === demo.assistant) status = "signed_up";
  else {
    const r = rand01();
    status =
      r < 0.3 ? "signed_up" // observer list ready, no final observer yet
      : r < 0.63 ? "scheduled"
      : r < 0.9 ? "completed"
      : "missed";
  }

  const obs = {
    sectionId: section._id,
    observerEmail: null, // set once the observee picks a confirmed observer
    signupDate,
    observationDate: null,
    status,
    observerSignedDate: null,
    observeeSignedDate: null,
    ratings: null,
  };
  observations.push(obs);

  if (status === "signed_up") {
    // observer list generated; some requests already sent
    for (const o of matches) {
      const requested = rand01() < 0.3;
      observerMatches.push({
        sectionId: section._id,
        observerEmail: o.email,
        requestedDate: requested ? dateBetween(addDays(signupDate, 1), TODAY) : null,
        status: requested ? "requested" : "suggested",
      });
    }
  } else if (status !== "unmatched") {
    // final observer chosen, others declined
    const requestedDate = dateBetween(addDays(signupDate, 1), "2026-09-25");
    matches.forEach((o, i) =>
      observerMatches.push({
        sectionId: section._id,
        observerEmail: o.email,
        requestedDate,
        status: i === 0 ? "confirmed" : "declined",
      })
    );
    obs.observerEmail = matches[0].email;

    if (status === "scheduled") {
      obs.observationDate = dateBetween("2026-10-14", "2026-11-12");
    } else if (status === "missed") {
      obs.observationDate = dateBetween("2026-10-01", "2026-10-09");
    } else {
      obs.observationDate = dateBetween("2026-09-28", "2026-10-09");
      obs.observerSignedDate = nextWeekday(addDays(obs.observationDate, faker.number.int({ min: 0, max: 1 })));
      obs.observeeSignedDate = nextWeekday(addDays(obs.observationDate, faker.number.int({ min: 0, max: 1 })));
      obs.ratings = mkRatings();
      p.lastObserved = obs.observationDate; // app would update this when the observation completes
      if (rand01() < 0.45)
        surveys.push(mkSurvey(p.email, CURRENT_TERM, dateBetween(addDays(obs.observationDate, 1), TODAY)));
    }
  }
}

// ---------- output ----------
const data = {
  professors,
  courseSections,
  evaluationCycles,
  observations,
  observerMatches,
  surveys,
};

const tally = (arr, fn) =>
  arr.reduce((m, x) => ((m[fn(x)] = (m[fn(x)] || 0) + 1), m), {});
const termOfSection = new Map(courseSections.map((s) => [s._id, s.term]));

console.log("rows:", Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])));
console.log("due status at start of cycle:", tally(professors, (p) => `${p.hireLevel}:${dueAtStart.get(p.email)}`));
console.log(
  "Fall 2026 observation status:",
  tally(observations.filter((o) => termOfSection.get(o.sectionId) === CURRENT_TERM), (o) => o.status)
);
console.log("demo accounts (password:", DEV_PASSWORD + ")");
for (const [role, p] of Object.entries(demo))
  if (p) {
    const ids = new Set(currentSections.get(p.email).map((s) => s._id));
    const ob = observations.find((o) => ids.has(o.sectionId));
    console.log(
      `  ${role.padEnd(9)} ${p.email}  ${p.name} (${p.department}, ${p.hireLevel}) due=${dueAtStart.get(p.email)} fall2026=${ob ? ob.status : "not signed up"}`
    );
  }

if (process.argv.includes("--json")) {
  writeFileSync(new URL("./seed-data.json", import.meta.url), JSON.stringify(data, null, 2));
  console.log("wrote seed-data.json");
} else {
  const { default: mongoose } = await import("mongoose");
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/assessment_helper";
  const isHex = (v) => typeof v === "string" && /^[0-9a-f]{24}$/.test(v);
  const isIsoDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  // section ids -> ObjectId; *Date / *Deadline / lastObserved strings -> real Dates
  const convert = (doc) => {
    const out = {};
    for (const [k, v] of Object.entries(doc)) {
      if ((k === "_id" || k.endsWith("Id")) && isHex(v)) out[k] = new mongoose.Types.ObjectId(v);
      else if (/(Date|Deadline|Observed)$/.test(k) && isIsoDay(v)) out[k] = new Date(v + "T00:00:00Z");
      else out[k] = v;
    }
    return out;
  };
  const INDEXES = {
    professors: [[{ email: 1 }, { unique: true }]],
    evaluationCycles: [[{ term: 1 }, { unique: true }]],
    observations: [[{ sectionId: 1 }, { unique: true }]],
    observerMatches: [[{ sectionId: 1, observerEmail: 1 }, { unique: true }]],
    surveys: [[{ professorEmail: 1, term: 1 }, { unique: true }]],
  };

  console.log("connecting to MongoDB...");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log("connected to database:", mongoose.connection.name);
  for (const [name, docs] of Object.entries(data)) {
    const col = mongoose.connection.collection(name);
    await col.deleteMany({});
    await col.insertMany(docs.map(convert));
    for (const [keys, opts] of INDEXES[name] ?? []) await col.createIndex(keys, opts);
    console.log(`inserted ${docs.length} -> ${name}`);
  }
  await mongoose.disconnect();
  console.log("done.");
}
