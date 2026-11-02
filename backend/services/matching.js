// Observer list generation (POST /api/observations/:course_code/:section_number/:term/generate-observer-list).
//
// Rules: services/eligibility.js. Pool: by default only professors who signed up this cycle
// ("Submit & Enter Observer Pool" in the UI; sriproflookup's process-document workflow),
// set OBSERVER_POOL=all to consider anyone teaching this term.
// Ordering: fewest observer duties already taken this term first (spreads the workload), then name.
const { env } = require("../config/env");
const { evaluateEligibility } = require("./eligibility");
const { sectionKey, observeeOf } = require("./context");
const { flagFor } = require("./presenters");

function candidatesFor(ctx, observation, { exclude = new Set() } = {}) {
  const section = ctx.sectionByKey.get(sectionKey(observation));
  const observee = ctx.profByEmail.get(observeeOf(ctx, observation));
  if (!section || !observee) return { candidates: [], eligibleCount: 0, flag: "NO_ELIGIBLE_OBSERVER", rejected: [] };

  const pool = env.observerPool === "all"
    ? ctx.professors
    : [...new Set(ctx.observations.map((o) => observeeOf(ctx, o)))].map((e) => ctx.profByEmail.get(e)).filter(Boolean);

  const load = new Map();
  for (const o of ctx.observations) {
    if (o.observer_email && o.status !== "missed") load.set(o.observer_email, (load.get(o.observer_email) || 0) + 1);
  }

  const rejected = [];
  const eligible = [];
  for (const candidate of pool) {
    if (exclude.has(candidate.email)) continue;
    const result = evaluateEligibility({
      observee,
      candidate,
      section,
      candidateSections: ctx.sectionsByInstructor.get(candidate.email) || [],
    });
    if (result.eligible) eligible.push(candidate);
    else rejected.push({ email: candidate.email, violation: result.violation });
  }
  eligible.sort((a, b) => (load.get(a.email) || 0) - (load.get(b.email) || 0) || a.name.localeCompare(b.name));
  const candidates = eligible.slice(0, env.maxObserversPerList);
  return { candidates, eligibleCount: eligible.length, flag: flagFor(candidates.length), rejected };
}

module.exports = { candidatesFor };
