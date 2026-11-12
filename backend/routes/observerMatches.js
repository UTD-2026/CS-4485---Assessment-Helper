// Observer matching workflow.
//
// An observer match links one signup (observation) to one candidate observer.
// Lifecycle of a match:
//
//   suggested --(observee sends request)--> requested --(observer accepts)--> accepted
//   requested/accepted --(observer declines)--> declined
//   requested/accepted --(withdrawn)--> cancelled
//   accepted --(observee confirms)--> confirmed   (other open requests -> cancelled)
//   suggested --(regenerating finds it no longer meets the rules)--> removed
//
// Once a signup has its observer the list is closed: untouched suggestions stay
// "suggested" as a record of the list, and no match on it can change any more.
// "removed" entries never passed the rules and do not count as part of the list.
//
// "suggested" matches are created by the matching engine (POST /generate) and
// "confirmed" ones also by a committee assignment (POST /assign). Confirming sets
// observations.observer_email, which hands the pair over to scheduling.
const express = require("express");
const {
  ObserverMatch,
  Observation,
  CourseSection,
  Professor,
  EvaluationCycle,
} = require("../models");
const {
  ApiError,
  asyncRoute,
  sendData,
  requireObject,
  rejectUnknownFields,
  requireString,
  normalizeEmail,
  normalizeTerm,
  routeSectionKey,
  termIndex,
} = require("./apiHelpers");
const {
  OBSERVER_LIST_SIZE,
  MATCH_FLAGS,
  RULES,
  auditPairing,
  isEligibleObserver,
  flagForListSize,
  groupSectionsByInstructor,
  rankCandidates,
} = require("../matching/matchmaker");

const router = express.Router();

const MATCH_STATUSES = ["suggested", "requested", "accepted", "declined", "confirmed", "cancelled", "removed"];
const ACTIVE_MATCH_STATUSES = ["suggested", "requested", "accepted"];
// Observer lists can only change while the signup is waiting for an observer.
const MATCHABLE_OBSERVATION_STATUSES = ["signed_up", "unmatched"];
const STATUS_TRANSITIONS = {
  suggested: ["requested"],
  requested: ["accepted", "declined", "cancelled"],
  accepted: ["confirmed", "declined", "cancelled"],
};
const STATUS_ORDER = Object.fromEntries(
  ["confirmed", "accepted", "requested", "suggested", "declined", "cancelled", "removed"].map((status, index) => [status, index])
);

const keyId = (item) => `${item.course_code}|${item.section_number}|${item.term}`;
const lower = (value) => String(value || "").trim().toLowerCase();

function normalizeMatchStatus(value) {
  const status = requireString(value, "status").toLowerCase();
  if (!MATCH_STATUSES.includes(status)) {
    throw new ApiError(400, `status must be one of: ${MATCH_STATUSES.join(", ")}.`);
  }
  return status;
}

function requireSectionKey(body) {
  return {
    course_code: requireString(body.course_code, "course_code"),
    section_number: requireString(body.section_number, "section_number", { pattern: /^\d{3}$/ }),
    term: normalizeTerm(body.term),
  };
}

function isMatchable(observation) {
  return !observation.observer_email &&
    MATCHABLE_OBSERVATION_STATUSES.includes(lower(observation.status));
}

function unmatchableReason(observation) {
  if (observation.observer_email) return "This signup already has an observer.";
  return `This signup is ${observation.status}; its observer list can no longer change.`;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function adjustCount(counts, key, delta) {
  counts.set(key, Math.max(0, (counts.get(key) || 0) + delta));
}

function isDuplicateKeyError(error) {
  if (error?.code === 11000) return true;
  const writeErrors = error?.writeErrors;
  return Array.isArray(writeErrors) && writeErrors.length > 0 &&
    writeErrors.every((item) => (item.code ?? item.err?.code) === 11000);
}

async function loadProfessorsByEmail() {
  const professors = await Professor.find({}).select("-password_hash").lean();
  return new Map(professors.map((professor) => [lower(professor.email), professor]));
}

// Adds observee/observer names, the class timing and any rule violations to each match.
async function describeMatches(matches) {
  if (!matches.length) return [];
  const terms = [...new Set(matches.map((match) => match.term))];
  const [sections, professorsByEmail] = await Promise.all([
    CourseSection.find({ term: { $in: terms } }).lean(),
    loadProfessorsByEmail(),
  ]);
  const sectionsByKey = new Map(sections.map((section) => [keyId(section), section]));
  const sectionsByInstructor = groupSectionsByInstructor(sections);

  return matches.map((match) => {
    const section = sectionsByKey.get(keyId(match));
    const observeeEmail = section ? lower(section.instructor_email) : null;
    const observee = observeeEmail ? professorsByEmail.get(observeeEmail) : null;
    const observerEmail = lower(match.observer_email);
    const observer = professorsByEmail.get(observerEmail);
    const observerSections = (sectionsByInstructor.get(observerEmail) || [])
      .filter((item) => item.term === match.term);
    return {
      ...match,
      observee_email: observeeEmail,
      observee_name: observee?.name || null,
      observer_name: observer?.name || null,
      observer_department: observer?.department || null,
      timing: section?.timing || null,
      violations: section && observee && observer
        ? auditPairing({ section, observee, observer, observerSections })
        : [],
    };
  });
}

// Atomically gives a waiting signup its observer. Returns null if someone else got there first.
function claimObservation(key, observation, observerEmail) {
  return Observation.findOneAndUpdate(
    { ...key, observer_email: null, status: observation.status },
    { $set: { observer_email: observerEmail, status: "signed_up" } },
    { new: true, runValidators: true }
  ).lean();
}

function releaseObservation(key, observation, observerEmail) {
  return Observation.updateOne(
    { ...key, observer_email: observerEmail },
    { $set: { observer_email: null, status: observation.status } }
  );
}

// Once an observer is confirmed, other colleagues who were asked are released.
async function cancelOtherOpenRequests(key, observerEmail) {
  const result = await ObserverMatch.updateMany(
    { ...key, observer_email: { $ne: observerEmail }, status: { $in: ["requested", "accepted"] } },
    { $set: { status: "cancelled" } }
  );
  return result?.modifiedCount ?? 0;
}

const CONFLICT_RELOAD = "This signup was changed by someone else. Reload and try again.";

router.get(
  "/",
  asyncRoute(async (request, response) => {
    const query = request.query;
    const filter = {};
    if (query.term !== undefined) filter.term = normalizeTerm(query.term);
    if (query.course_code !== undefined) filter.course_code = requireString(query.course_code, "course_code");
    if (query.section_number !== undefined) {
      filter.section_number = requireString(query.section_number, "section_number", { pattern: /^\d{3}$/ });
    }
    if (query.observer_email !== undefined) {
      filter.observer_email = normalizeEmail(query.observer_email, "observer_email");
    }
    if (query.status !== undefined) filter.status = normalizeMatchStatus(query.status);

    if (query.observee_email !== undefined) {
      const sectionFilter = { instructor_email: normalizeEmail(query.observee_email, "observee_email") };
      if (filter.term) sectionFilter.term = filter.term;
      const sections = await CourseSection.find(sectionFilter)
        .select("course_code section_number term")
        .lean();
      if (!sections.length) return sendData(response, []);
      filter.$or = sections.map(({ course_code, section_number, term }) => ({ course_code, section_number, term }));
    }

    const matches = await describeMatches(await ObserverMatch.find(filter).lean());
    matches.sort((a, b) =>
      termIndex(b.term) - termIndex(a.term) ||
      keyId(a).localeCompare(keyId(b)) ||
      (STATUS_ORDER[lower(a.status)] ?? 99) - (STATUS_ORDER[lower(b.status)] ?? 99) ||
      String(a.observer_name || a.observer_email).localeCompare(String(b.observer_name || b.observer_email))
    );
    return sendData(response, matches);
  })
);

// Builds or tops up observer lists for every signup in a term that is still
// waiting for an observer (or for one section). Safe to run repeatedly:
//   - open requests (requested/accepted) are never touched;
//   - suggestions that no longer pass the rules (for example, after a schedule
//     change) are removed;
//   - lists are filled back up to OBSERVER_LIST_SIZE with new, never-listed observers;
//   - signups with no eligible observer at all are marked "unmatched".
// Pass dry_run: true to preview the result without saving anything.
router.post(
  "/generate",
  asyncRoute(async (request, response) => {
    requireObject(request.body);
    rejectUnknownFields(request.body, ["term", "course_code", "section_number", "dry_run"]);
    const term = normalizeTerm(request.body.term);
    const hasCourse = request.body.course_code !== undefined;
    if (hasCourse !== (request.body.section_number !== undefined)) {
      throw new ApiError(400, "Provide both course_code and section_number, or neither.");
    }
    const onlyKey = hasCourse ? requireSectionKey({ ...request.body, term }) : null;
    if (request.body.dry_run !== undefined && typeof request.body.dry_run !== "boolean") {
      throw new ApiError(400, "dry_run must be a boolean.");
    }
    const dryRun = request.body.dry_run === true;
    if (!(await EvaluationCycle.exists({ term }))) {
      throw new ApiError(404, "Evaluation cycle not found.");
    }

    const [professorsByEmail, termSections, observations, matches] = await Promise.all([
      loadProfessorsByEmail(),
      CourseSection.find({ term }).lean(),
      Observation.find({ term }).lean(),
      ObserverMatch.find({ term }).lean(),
    ]);

    let targets;
    if (onlyKey) {
      const observation = observations.find((item) => keyId(item) === keyId(onlyKey));
      if (!observation) throw new ApiError(404, "No signup (observation) exists for that section.");
      if (!isMatchable(observation)) throw new ApiError(409, unmatchableReason(observation));
      targets = [observation];
    } else {
      targets = observations.filter(isMatchable).sort((a, b) => keyId(a).localeCompare(keyId(b)));
    }

    const professors = [...professorsByEmail.values()];
    const sectionsByKey = new Map(termSections.map((section) => [keyId(section), section]));
    const sectionsByInstructor = groupSectionsByInstructor(termSections);
    const assignedCounts = countBy(observations.filter((item) => item.observer_email), (item) => lower(item.observer_email));
    // Open lists only: suggestions left on a closed list (observer already chosen) don't count
    const openKeys = new Set(observations.filter(isMatchable).map(keyId));
    const activeCounts = countBy(
      matches.filter((match) => openKeys.has(keyId(match)) && ACTIVE_MATCH_STATUSES.includes(lower(match.status))),
      (match) => lower(match.observer_email)
    );
    const matchesBySection = new Map();
    for (const match of matches) {
      const id = keyId(match);
      if (!matchesBySection.has(id)) matchesBySection.set(id, []);
      matchesBySection.get(id).push(match);
    }

    const now = new Date();
    const inserts = [];
    const prunes = [];
    const statusUpdates = [];
    const results = [];

    for (const observation of targets) {
      const key = {
        course_code: observation.course_code,
        section_number: observation.section_number,
        term: observation.term,
      };
      const section = sectionsByKey.get(keyId(key));
      const observee = section ? professorsByEmail.get(lower(section.instructor_email)) : null;
      if (!section || !observee) {
        results.push({ ...key, error: section ? "The observee's professor record was not found." : "Course section not found." });
        continue;
      }

      const existing = matchesBySection.get(keyId(key)) || [];
      const kept = [];
      const removed = [];
      for (const match of existing) {
        const status = lower(match.status);
        if (!ACTIVE_MATCH_STATUSES.includes(status)) continue;
        if (status === "suggested") {
          const observerEmail = lower(match.observer_email);
          const observer = professorsByEmail.get(observerEmail);
          const observerSections = sectionsByInstructor.get(observerEmail) || [];
          if (!observer || !isEligibleObserver({ section, observee, observer, observerSections })) {
            removed.push(match);
            continue;
          }
        }
        kept.push(match);
      }
      for (const match of removed) adjustCount(activeCounts, lower(match.observer_email), -1);

      const { candidates, eligibleCount } = rankCandidates({
        section,
        observee,
        professors,
        termSections,
        // Nobody is listed twice for a section (also enforced by the unique index).
        excludeEmails: new Set(existing.map((match) => lower(match.observer_email))),
        assignedCounts,
        activeCounts,
        limit: OBSERVER_LIST_SIZE - kept.length,
      });
      for (const candidate of candidates) {
        adjustCount(activeCounts, candidate.email, 1);
        inserts.push({ ...key, observer_email: candidate.email, requested_date: now, status: "suggested" });
      }
      prunes.push(...removed.map((match) => ({ ...key, observer_email: lower(match.observer_email) })));

      const listSize = kept.length + candidates.length;
      const observationStatus = listSize === 0 ? "unmatched" : "signed_up";
      if (lower(observation.status) !== observationStatus) {
        statusUpdates.push({ key, from: observation.status, to: observationStatus });
      }

      results.push({
        ...key,
        observee_email: lower(observee.email),
        observee_name: observee.name,
        list_size: listSize,
        flag: flagForListSize(listSize),
        added: candidates.map((candidate) => ({ email: candidate.email, name: candidate.professor.name })),
        removed: removed.map((match) => ({
          email: lower(match.observer_email),
          name: professorsByEmail.get(lower(match.observer_email))?.name || null,
        })),
        unused_eligible: eligibleCount - candidates.length,
        observation_status: observationStatus,
      });
    }

    if (!dryRun) {
      for (const prune of prunes) {
        await ObserverMatch.updateOne({ ...prune, status: "suggested" }, { $set: { status: "removed" } });
      }
      if (inserts.length) {
        try {
          await ObserverMatch.insertMany(inserts, { ordered: false });
        } catch (error) {
          // A concurrent run already listed the same observer; the other rows were saved.
          if (!isDuplicateKeyError(error)) throw error;
        }
      }
      for (const update of statusUpdates) {
        await Observation.updateOne(
          { ...update.key, observer_email: null, status: update.from },
          { $set: { status: update.to } }
        );
      }
    }

    const listed = results.filter((item) => !item.error);
    return sendData(response, {
      term,
      dry_run: dryRun,
      list_size: OBSERVER_LIST_SIZE,
      summary: {
        sections: results.length,
        added: inserts.length,
        removed: prunes.length,
        ok: listed.filter((item) => item.flag === MATCH_FLAGS.OK).length,
        insufficient: listed.filter((item) => item.flag === MATCH_FLAGS.INSUFFICIENT).length,
        none: listed.filter((item) => item.flag === MATCH_FLAGS.NONE).length,
        errors: results.length - listed.length,
      },
      results,
    });
  })
);

// Committee override: assigns an observer directly (no request/accept round trip).
// Any professor other than the observee may be chosen; rule violations are returned
// as warnings so the committee can see what it is overriding.
router.post(
  "/assign",
  asyncRoute(async (request, response) => {
    requireObject(request.body);
    rejectUnknownFields(request.body, ["course_code", "section_number", "term", "observer_email"]);
    const key = requireSectionKey(request.body);
    const observerEmail = normalizeEmail(request.body.observer_email, "observer_email");

    const [section, observation, observer] = await Promise.all([
      CourseSection.findOne(key).lean(),
      Observation.findOne(key).lean(),
      Professor.findOne({ email: observerEmail }).select("-password_hash").lean(),
    ]);
    if (!section) throw new ApiError(404, "Course section not found.");
    if (!observation) throw new ApiError(404, "No signup (observation) exists for this section.");
    if (!observer) throw new ApiError(400, `Professor not found: ${observerEmail}.`);
    if (lower(section.instructor_email) === observerEmail) {
      throw new ApiError(400, "A professor cannot observe their own class.");
    }
    if (!isMatchable(observation)) throw new ApiError(409, unmatchableReason(observation));

    const claimed = await claimObservation(key, observation, observerEmail);
    if (!claimed) throw new ApiError(409, CONFLICT_RELOAD);

    let match;
    try {
      const existing = await ObserverMatch.findOne({ ...key, observer_email: observerEmail }).lean();
      match = existing
        ? await ObserverMatch.findOneAndUpdate(
          { ...key, observer_email: observerEmail },
          { $set: { status: "confirmed" } },
          { new: true, runValidators: true }
        ).lean()
        : (await ObserverMatch.create({
          ...key,
          observer_email: observerEmail,
          requested_date: new Date(),
          status: "confirmed",
        })).toObject();
    } catch (error) {
      await releaseObservation(key, observation, observerEmail);
      throw error;
    }
    const cancelledCount = await cancelOtherOpenRequests(key, observerEmail);

    const [described] = await describeMatches([match]);
    return sendData(response, {
      match: described,
      observation: claimed,
      cancelled_count: cancelledCount,
      violations: described.violations.map((code) => ({ code, label: RULES[code] })),
    });
  })
);

router.patch(
  "/:course_code/:section_number/:term/:observer_email",
  asyncRoute(async (request, response) => {
    const key = routeSectionKey(request);
    const observerEmail = normalizeEmail(request.params.observer_email, "observer_email");
    requireObject(request.body);
    rejectUnknownFields(request.body, ["status"]);
    const nextStatus = normalizeMatchStatus(request.body.status);

    const match = await ObserverMatch.findOne({ ...key, observer_email: observerEmail }).lean();
    if (!match) throw new ApiError(404, "Observer match not found.");
    const currentStatus = lower(match.status);
    if (currentStatus === nextStatus) throw new ApiError(409, `This match is already ${nextStatus}.`);
    if (!(STATUS_TRANSITIONS[currentStatus] || []).includes(nextStatus)) {
      throw new ApiError(409, `A ${currentStatus} match cannot be changed to ${nextStatus}.`);
    }

    let observation = null;
    if (["requested", "accepted", "confirmed"].includes(nextStatus)) {
      observation = await Observation.findOne(key).lean();
      if (!observation) throw new ApiError(404, "No signup (observation) exists for this section.");
      if (!isMatchable(observation)) throw new ApiError(409, unmatchableReason(observation));
    }

    if (nextStatus === "confirmed") {
      const claimed = await claimObservation(key, observation, observerEmail);
      if (!claimed) throw new ApiError(409, CONFLICT_RELOAD);
      const confirmed = await ObserverMatch.findOneAndUpdate(
        { ...key, observer_email: observerEmail, status: match.status },
        { $set: { status: "confirmed" } },
        { new: true, runValidators: true }
      ).lean();
      if (!confirmed) {
        await releaseObservation(key, observation, observerEmail);
        throw new ApiError(409, CONFLICT_RELOAD);
      }
      const cancelledCount = await cancelOtherOpenRequests(key, observerEmail);
      const [described] = await describeMatches([confirmed]);
      return sendData(response, { match: described, observation: claimed, cancelled_count: cancelledCount });
    }

    const updates = { status: nextStatus };
    if (nextStatus === "requested") updates.requested_date = new Date();
    const updated = await ObserverMatch.findOneAndUpdate(
      { ...key, observer_email: observerEmail, status: match.status },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    if (!updated) throw new ApiError(409, CONFLICT_RELOAD);
    const [described] = await describeMatches([updated]);
    return sendData(response, { match: described, observation: null, cancelled_count: 0 });
  })
);

module.exports = router;
