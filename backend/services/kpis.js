// Committee KPIs and reports for one term (pure functions over a loaded term context).
// Definitions match the dashboard (frontend/src/utils/kpis.js) so the API and the UI agree;
// the report shapes follow sriproflookup's Committee Reports (by hire level, unmatched, outstanding, workload).
const { evaluateEligibility } = require("./eligibility");
const { sectionKey, observeeOf, isObservationPeriodOver, isSurveyClosed } = require("./context");
const { levelLabel } = require("./dueStatus");
const { flagFor } = require("./presenters");

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const TARGET_LIST_SIZE = 5;

function computeKpis(ctx, { surveys = [] } = {}) {
  const obs = ctx.observations;
  const signups = obs.map((o) => ({ o, email: observeeOf(ctx, o) })).filter((s) => s.email);
  const signedUp = new Set(signups.map((s) => s.email));
  const matchesFor = (o) => ctx.matches.filter((m) => sectionKey(m) === sectionKey(o));

  // 1a. Eligibility accuracy: every suggested/requested/confirmed pairing re-checked against the rules
  const audited = [];
  for (const { o, email } of signups) {
    const section = ctx.sectionByKey.get(sectionKey(o));
    const observee = ctx.profByEmail.get(email);
    const pairs = new Set(matchesFor(o).map((m) => m.observer_email));
    if (o.observer_email) pairs.add(o.observer_email);
    for (const candidateEmail of pairs) {
      const candidate = ctx.profByEmail.get(candidateEmail);
      if (!candidate || !section || !observee) continue;
      const r = evaluateEligibility({ observee, candidate, section, candidateSections: ctx.sectionsByInstructor.get(candidateEmail) || [] });
      audited.push({ observee: email, observer: candidateEmail, course_code: o.course_code, violation: r.violation });
    }
  }
  const incorrect = audited.filter((a) => a.violation);
  const byType = incorrect.reduce((m, a) => ({ ...m, [a.violation]: (m[a.violation] || 0) + 1 }), {});

  // 1b. Overdue
  const dueRows = ctx.professors.map((p) => ({ p, s: ctx.due.get(p.email) }));
  const overdue = dueRows.filter((r) => r.s.status === "overdue");
  const dueOrOverdue = dueRows.filter((r) => r.s.status !== "not_due");

  // 2a / 2b
  const signedUpDue = dueOrOverdue.filter((r) => signedUp.has(r.p.email)).length;
  const observers = new Set(obs.filter((o) => o.observer_email && o.status !== "missed").map((o) => o.observer_email));

  // 3a
  const listSizes = signups.map(({ o }) => matchesFor(o).length);
  const totalMatches = listSizes.reduce((a, b) => a + b, 0);
  const avg = signups.length ? Math.round((totalMatches / signups.length) * 10) / 10 : 0;
  const flags = signups.map(({ o }) => o.match_flag || flagFor(matchesFor(o).length));

  // 4a
  const deadlinePassed = ctx.cycle ? isObservationPeriodOver(ctx.cycle) : false;
  const paired = obs.filter((o) => o.observer_email);
  const missing = paired.filter((o) => o.status === "missed" || (deadlinePassed && !["completed", "deferred"].includes(o.status)));

  // 4b
  const surveyed = new Set(surveys.map((s) => s.professor_email));
  const stages = signups.map(({ o, email }) => {
    const m = matchesFor(o);
    return {
      signedUp: true,
      sentRequest: m.some((x) => x.status !== "suggested"),
      confirmed: Boolean(o.observer_email),
      observed: o.status === "completed",
      surveyed: surveyed.has(email),
    };
  });
  const steps = ["signedUp", "sentRequest", "confirmed", "observed", "surveyed"];
  const funnel = steps.map((key, i) => ({ key, count: stages.filter((s) => steps.slice(0, i + 1).every((k) => s[k])).length }));
  const completedProcess = funnel[funnel.length - 1].count;

  return {
    term: ctx.term,
    eligibility_accuracy: { audited: audited.length, correct: audited.length - incorrect.length, rate: audited.length ? pct(audited.length - incorrect.length, audited.length) : null, violations_by_type: byType },
    overdue_count: { count: overdue.length, not_signed_up: overdue.filter((r) => !signedUp.has(r.p.email)).length },
    participation_rate: { numerator: signedUpDue, denominator: dueOrOverdue.length, rate: pct(signedUpDue, dueOrOverdue.length) },
    observer_utilization: { numerator: observers.size, denominator: signups.length, rate: pct(observers.size, signups.length) },
    list_sufficiency: {
      total_matches: totalMatches, signups: signups.length, average: avg, rate_of_target: pct(avg, TARGET_LIST_SIZE),
      full_lists: flags.filter((f) => f === "OK").length,
      insufficient: flags.filter((f) => f === "INSUFFICIENT_OBSERVERS").length,
      none: flags.filter((f) => f === "NO_ELIGIBLE_OBSERVER").length,
    },
    missing_observations: { count: missing.length, approved: paired.length, completed: paired.filter((o) => o.status === "completed").length, deadline_passed: deadlinePassed },
    survey_completion: {
      numerator: completedProcess, denominator: signups.length, rate: pct(completedProcess, signups.length), funnel,
      available: ctx.cycle ? isSurveyClosed(ctx.cycle) : false,
    },
    faculty_due_by_hire_level: facultyDueByLevel(ctx),
    observer_workload: observerWorkload(ctx),
  };
}

function facultyDueByLevel(ctx) {
  const levels = [...new Set(ctx.professors.map((p) => p.hire_level))].sort();
  return levels.map((level) => {
    const rows = ctx.professors.filter((p) => p.hire_level === level).map((p) => ctx.due.get(p.email).status);
    return { hire_level: level, hire_level_label: levelLabel(level), due: rows.filter((s) => s === "due").length, overdue: rows.filter((s) => s === "overdue").length };
  });
}

function observerWorkload(ctx) {
  return ctx.professors.map((p) => {
    const assigned = ctx.observations.filter((o) => o.observer_email === p.email);
    return {
      email: p.email, name: p.name, department: p.department, major: p.major,
      assigned: assigned.length,
      completed: assigned.filter((o) => o.status === "completed").length,
      pending: assigned.filter((o) => !["completed", "missed", "deferred"].includes(o.status)).length,
      missed: assigned.filter((o) => o.status === "missed").length,
    };
  }).sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
}

const NEXT_ACTION = {
  signed_up: "Committee: release observer list / observee: request observers",
  unmatched: "Committee: assign an observer manually",
  matched: "Observee: schedule the observation date",
  scheduled: "Observer + observee: confirm the observation happened",
  awaiting_confirmation: "Waiting on the other participant's confirmation",
  missed: "Reschedule or follow up",
};

function outstandingObservations(ctx) {
  const rows = ctx.observations
    .filter((o) => !["completed", "deferred"].includes(o.status))
    .map((o) => {
      const email = observeeOf(ctx, o);
      const p = ctx.profByEmail.get(email);
      return {
        id: sectionKey(o), course_code: o.course_code, section_number: o.section_number, term: o.term,
        observee_email: email, observee_name: p?.name || email, hire_level: p?.hire_level || null, hire_level_label: levelLabel(p?.hire_level),
        observer_email: o.observer_email, observer_name: o.observer_email ? ctx.profByEmail.get(o.observer_email)?.name : null,
        status: o.status, observation_date: o.observation_date ? new Date(o.observation_date).toISOString().slice(0, 10) : null,
        timing: ctx.sectionByKey.get(sectionKey(o))?.timing || null,
        observer_confirmed: Boolean(o.observer_signed_date), observee_confirmed: Boolean(o.observee_signed_date),
        missed_reason: o.missed_reason || null,
        next_action: NEXT_ACTION[o.status] || "Review",
      };
    });
  const levels = [...new Set(rows.map((r) => r.hire_level))].sort();
  const byLevel = levels.map((l) => ({ hire_level: l, hire_level_label: levelLabel(l), count: rows.filter((r) => r.hire_level === l).length }));
  return { rows, byLevel };
}

/**
 * Doc definition: faculty for whom no suitable observer candidates could be generated.
 * With includeAllDue, also every due/overdue professor without an observer, with the reason (sriproflookup's report).
 */
function unmatchedFaculty(ctx, { includeAllDue = false } = {}) {
  const obsByEmail = new Map(ctx.observations.map((o) => [observeeOf(ctx, o), o]));
  const rows = [];
  for (const p of ctx.professors) {
    const o = obsByEmail.get(p.email);
    const status = ctx.due.get(p.email);
    const listSize = o ? ctx.matches.filter((m) => sectionKey(m) === sectionKey(o)).length : 0;
    const flag = o ? o.match_flag || flagFor(listSize) : null;
    const noCandidates = Boolean(o && !o.observer_email && (o.status === "unmatched" || flag === "NO_ELIGIBLE_OBSERVER"));
    let reason = null;
    if (noCandidates) reason = "No eligible observers";
    else if (includeAllDue && status.status !== "not_due" && (!o || !o.observer_email || o.status === "missed")) {
      reason = !o ? "Not signed up"
        : o.status === "missed" ? "Observation missed; reassignment needed"
        : flag === "INSUFFICIENT_OBSERVERS" ? "Insufficient observers; awaiting manual assignment"
        : "Awaiting observer confirmation";
    }
    if (!reason) continue;
    rows.push({
      email: p.email, name: p.name, department: p.department, major: p.major, hire_level: p.hire_level, hire_level_label: levelLabel(p.hire_level),
      evaluation_status: status.status, course_code: o?.course_code || null, match_flag: flag, candidate_count: listSize,
      no_candidates: noCandidates, reason,
    });
  }
  return rows.sort((a, b) => Number(b.no_candidates) - Number(a.no_candidates) || a.name.localeCompare(b.name));
}

module.exports = { computeKpis, outstandingObservations, unmatchedFaculty, facultyDueByLevel, observerWorkload };
