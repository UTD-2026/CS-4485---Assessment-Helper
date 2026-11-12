// Observer list generation (POST .../generate-observer-list and POST /api/observer-matches/generate).
//
// The rules and ranking come from main's matching engine (matching/matchmaker.js, unit tested in
// matching/matchmaker.test.js):
//   - same department, teaches a course at the same level this term, no overlapping class time;
//   - a timing that can't be read counts as a conflict;
//   - committee (AC) members are left off generated lists (they use the Committee portal and can't
//     answer requests there; the committee can still assign one by hand);
//   - order: teaches the same course, then fewest observations already assigned this term,
//     then fewest other open lists, then name.
// Pool: by default only professors who signed up this cycle (the "observer pool" in the process doc);
// set OBSERVER_POOL=all in backend/.env to consider anyone teaching this term.
const { env } = require("../config/env");
const { auditPairing, rankCandidates } = require("../matching/matchmaker");
const { sectionKey, observeeOf } = require("./context");
const { flagFor } = require("./presenters");

const OPEN = ["suggested", "requested", "accepted"];

function candidatesFor(ctx, observation, { exclude = new Set() } = {}) {
  const section = ctx.sectionByKey.get(sectionKey(observation));
  const observee = ctx.profByEmail.get(observeeOf(ctx, observation));
  if (!section || !observee) return { candidates: [], eligibleCount: 0, flag: "NO_ELIGIBLE_OBSERVER", rejected: [] };

  const pool = env.observerPool === "all"
    ? ctx.professors
    : [...new Set(ctx.observations.map((o) => observeeOf(ctx, o)))].map((e) => ctx.profByEmail.get(e)).filter(Boolean);

  const assignedCounts = new Map();
  for (const o of ctx.observations) {
    if (o.observer_email && o.status !== "missed") assignedCounts.set(o.observer_email, (assignedCounts.get(o.observer_email) || 0) + 1);
  }
  const activeCounts = new Map();
  for (const m of ctx.matches) {
    if (OPEN.includes(m.status) && sectionKey(m) !== sectionKey(observation)) {
      activeCounts.set(m.observer_email, (activeCounts.get(m.observer_email) || 0) + 1);
    }
  }

  const ranked = rankCandidates({
    section,
    observee,
    professors: pool,
    termSections: ctx.sections.filter((s) => s.term === section.term),
    excludeEmails: exclude,
    assignedCounts,
    activeCounts,
    limit: env.maxObserversPerList,
  });

  const picked = new Set(ranked.candidates.map((c) => c.email));
  const rejected = pool
    .filter((p) => !exclude.has(p.email) && !picked.has(p.email) && p.email !== observee.email)
    .map((p) => {
      const violations = violationsFor(ctx, observation, p.email);
      return { email: p.email, violation: violations[0] || (p.is_ac_member ? "COMMITTEE_MEMBER" : "LIST_FULL") };
    });

  const candidates = ranked.candidates.map((c) => c.professor);
  return { candidates, eligibleCount: ranked.eligibleCount, flag: flagFor(candidates.length), rejected };
}

/** Rule codes (matching/matchmaker.js RULES) an observer -> observation pairing breaks. [] = eligible. */
function violationsFor(ctx, observation, observerEmail) {
  const section = ctx.sectionByKey.get(sectionKey(observation));
  const observee = ctx.profByEmail.get(observeeOf(ctx, observation));
  const observer = ctx.profByEmail.get(observerEmail);
  if (!section || !observee || !observer) return [];
  const observerSections = (ctx.sectionsByInstructor.get(observerEmail) || []).filter((s) => s.term === section.term);
  return auditPairing({ section, observee, observer, observerSections });
}

module.exports = { candidatesFor, violationsFor };
