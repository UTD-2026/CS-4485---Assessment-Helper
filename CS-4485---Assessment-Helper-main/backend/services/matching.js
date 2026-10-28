// Observer matching.
//
// TA Q&A:  "If fewer than 5 eligible observers exist ... display everyone that qualifies."
//          "If 5 or more observers are available, then randomly pick from this pool."
//          "No eligible observers: notify a message in the dashboard of Assessment Committee members."
// So selection is NOT ranked by anything: the whole eligible pool when it has fewer than 5 people,
// otherwise a random 5. Nobody eligible -> the observation becomes `unmatched` (the AC alert).
const { CANDIDATE_LIST_SIZE } = require('../config/env');
const {
  CourseSection, Observation, ObserverMatch, Professor,
} = require('../models');
const { evaluateEligibility } = require('./eligibility');
const { loadObservation, onlyInSections, sectionKey } = require('./lookup');
const { now } = require('./clock');

/** Fisher-Yates shuffle. Returns a new array. `rng` can be swapped for a seeded one in tests. */
function shuffled(array, rng = Math.random) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The committee's alert level for one signup, from how many colleagues were eligible:
 *   NO_ELIGIBLE_OBSERVER   nobody (the signup is "unmatched" and the committee must step in)
 *   INSUFFICIENT_OBSERVERS fewer than the usual 5 (everyone eligible is listed, but the observee has little choice)
 *   OK                     5 or more (a random 5 are listed)
 */
function candidateFlag(eligibleCount, size = CANDIDATE_LIST_SIZE) {
  if (!eligibleCount) return 'NO_ELIGIBLE_OBSERVER';
  return eligibleCount < size ? 'INSUFFICIENT_OBSERVERS' : 'OK';
}

/** @returns {{chosen: any[], mode: 'none'|'all'|'random'}} */
function pickCandidates(eligible, size = CANDIDATE_LIST_SIZE, rng = Math.random) {
  if (eligible.length === 0) return { chosen: [], mode: 'none' };
  if (eligible.length < size) return { chosen: eligible.slice(), mode: 'all' };
  return { chosen: shuffled(eligible, rng).slice(0, size), mode: 'random' };
}

/** Everyone and every section for one term, loaded once and reused for all the eligibility checks. */
async function loadTermPool(term) {
  const [professors, sections] = await Promise.all([Professor.find({}).lean(), CourseSection.find({ term }).lean()]);
  const sectionsByInstructor = new Map();
  for (const s of sections) {
    if (!sectionsByInstructor.has(s.instructor_email)) sectionsByInstructor.set(s.instructor_email, []);
    sectionsByInstructor.get(s.instructor_email).push(s);
  }
  return { professors, sections, sectionsByInstructor };
}

/** Check every other professor against one observee section. Every verdict is returned (eligible or not) with its reason. */
function evaluatePool({ observee, section, pool }) {
  return pool.professors
    .filter((p) => p.email !== observee.email)
    .map((candidate) => {
      const candidateSections = pool.sectionsByInstructor.get(candidate.email) || [];
      const verdict = evaluateEligibility({
        observee, candidate, section, candidateSections,
      });
      return { candidate, candidateSections, ...verdict };
    });
}

/** Re-check one specific person (used when a request is sent, in case their schedule changed). */
async function checkOneCandidate({ observee, section, candidateEmail }) {
  const candidate = await Professor.findOne({ email: candidateEmail }).lean();
  if (!candidate) return { found: false };
  const candidateSections = await CourseSection.find({ instructor_email: candidateEmail, term: section.term }).lean();
  return {
    found: true,
    candidate,
    ...evaluateEligibility({
      observee, candidate, section, candidateSections,
    }),
  };
}

/**
 * Compute (without saving) who is eligible for one signup. Backs the AC "why was X rejected?" view and Demo 5.
 */
async function previewEligibility(sectionId, rng = Math.random) {
  const { observation, section, observee } = await loadObservation(sectionId);
  const pool = await loadTermPool(section.term);
  const evaluations = evaluatePool({ observee, section, pool });
  const eligible = evaluations.filter((e) => e.eligible);
  const { chosen, mode } = pickCandidates(eligible, CANDIDATE_LIST_SIZE, rng);
  return {
    observation, section, observee, evaluations, eligible, chosen, mode, flag: candidateFlag(eligible.length),
  };
}

/**
 * Generate and save the candidate list for one signup. Replaces earlier `suggested` rows, but never
 * touches a list the observee has already started using (any request sent / answered).
 */
async function generateSuggestions(sectionId, { rng = Math.random, pool } = {}) {
  const {
    observation, section, observee, filter,
  } = await loadObservation(sectionId);
  const key = sectionKey(section);
  if (!['signed_up', 'unmatched'].includes(observation.status)) {
    return { sectionId: key, skipped: true, reason: `observation is already ${observation.status}` };
  }
  const existing = await ObserverMatch.find(filter).lean();
  if (existing.some((m) => m.status !== 'suggested')) {
    return { sectionId: key, skipped: true, reason: 'requests have already been sent for this signup' };
  }

  const termPool = pool || (await loadTermPool(section.term));
  const evaluations = evaluatePool({ observee, section, pool: termPool });
  const eligible = evaluations.filter((e) => e.eligible);
  const { chosen, mode } = pickCandidates(eligible, CANDIDATE_LIST_SIZE, rng);

  await ObserverMatch.deleteMany({ ...filter, status: 'suggested' });
  if (chosen.length) {
    await ObserverMatch.insertMany(
      chosen.map((e) => ({
        ...filter, observer_email: e.candidate.email, requested_date: null, status: 'suggested', expires_at: null, responded_date: null,
      }))
    );
  }

  const newStatus = chosen.length ? 'signed_up' : 'unmatched';
  const update = {
    $set: {
      status: newStatus, selection_run_date: now(), candidate_count: chosen.length, eligible_count: eligible.length,
    },
  };
  if (newStatus !== observation.status) {
    update.$push = { status_history: { at: now(), by: 'system', from: observation.status, to: newStatus, note: `observer selection (${mode})` } };
  }
  await Observation.updateOne(filter, update);

  return {
    sectionId: key,
    observee: observee.email,
    mode,
    eligibleCount: eligible.length,
    flag: candidateFlag(eligible.length),
    candidateEmails: chosen.map((e) => e.candidate.email),
    hasSufficientObservers: chosen.length > 0,
  };
}

/** AC "Observer Selection" button: run generateSuggestions for every open signup of a term. */
async function runObserverSelection(term, { rng = Math.random } = {}) {
  const pool = await loadTermPool(term);
  const observations = onlyInSections(await Observation.find({ term, status: { $in: ['signed_up', 'unmatched'] } }).lean(), pool.sections);

  const results = [];
  for (const obs of observations) results.push(await generateSuggestions(sectionKey(obs), { rng, pool }));
  const done = results.filter((r) => !r.skipped);
  return {
    term,
    processed: done.length,
    withObservers: done.filter((r) => r.hasSufficientObservers).length,
    unmatched: done.filter((r) => !r.hasSufficientObservers).length,
    insufficient: done.filter((r) => r.flag === 'INSUFFICIENT_OBSERVERS').length,
    skipped: results.filter((r) => r.skipped).length,
    results,
  };
}

module.exports = {
  candidateFlag,
  shuffled,
  pickCandidates,
  loadTermPool,
  evaluatePool,
  checkOneCandidate,
  previewEligibility,
  generateSuggestions,
  runObserverSelection,
};
