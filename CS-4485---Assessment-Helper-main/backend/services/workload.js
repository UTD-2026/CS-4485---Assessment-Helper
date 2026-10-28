// Observer workload: who is being asked to observe, who says yes, and how evenly the work is spread.
// (The stretch goal "workload analytics" in the README.) Pure function over plain data + one loader.
const { CourseSection, Observation, ObserverMatch, Professor } = require('../models');
const { getCycleOr404, onlyInSections } = require('./lookup');

const rate = (n, d) => (d === 0 ? null : Number((n / d).toFixed(4)));
const round = (n, places = 1) => Number(n.toFixed(places));
const HOUR = 3600000;

/**
 * @param matches  observerMatches rows (any term; filtered here to the term's sections)
 * Definitions:
 *   asked      requests actually sent to this professor this term (a row that never left "suggested" is not a request)
 *   confirmed / declined / expired / cancelled / pending   what happened to those requests
 *              ("cancelled" = stood down because someone else confirmed first)
 *   acceptRate confirmed / (confirmed + declined + expired): of the requests that were settled by the person or by time
 *   assigned   observations this professor is the confirmed observer of (scheduled, completed or missed)
 *   avgResponseHours  mean time from request to the person's own answer (confirm / decline); null when unknown
 */
function computeWorkload({ term, professors, sections, observations, matches }) {
  const termSections = sections.filter((s) => s.term === term);
  const termMatches = onlyInSections(matches, termSections);
  const termObs = onlyInSections(observations, termSections);

  const rows = new Map();
  const rowFor = (email) => {
    if (!rows.has(email)) {
      rows.set(email, {
        email, asked: 0, confirmed: 0, declined: 0, expired: 0, cancelled: 0, pending: 0, assigned: 0, completed: 0, missed: 0, responseHours: [],
      });
    }
    return rows.get(email);
  };

  for (const m of termMatches) {
    if (m.status === 'suggested' || !m.requested_date) continue; // never actually asked
    const r = rowFor(m.observer_email);
    r.asked += 1;
    if (m.status === 'confirmed' || m.status === 'accepted') r.confirmed += 1; // 'accepted' (two-step mode) is also a yes
    else if (m.status === 'declined') r.declined += 1;
    else if (m.status === 'expired') r.expired += 1;
    else if (m.status === 'cancelled') r.cancelled += 1;
    else if (m.status === 'requested') r.pending += 1;
    if (['confirmed', 'accepted', 'declined'].includes(m.status) && m.responded_date) {
      const hours = (new Date(m.responded_date) - new Date(m.requested_date)) / HOUR;
      if (Number.isFinite(hours) && hours >= 0) r.responseHours.push(hours);
    }
  }
  for (const o of termObs) {
    if (!o.observer_email || !['scheduled', 'completed', 'missed'].includes(o.status)) continue;
    const r = rowFor(o.observer_email);
    r.assigned += 1;
    if (o.status === 'completed') r.completed += 1;
    if (o.status === 'missed') r.missed += 1;
  }

  const byEmail = new Map(professors.map((p) => [p.email, p]));
  const people = [...rows.values()].map((r) => {
    const p = byEmail.get(r.email) || {};
    const settled = r.confirmed + r.declined + r.expired;
    return {
      email: r.email,
      name: p.name || r.email,
      department: p.department || null,
      hireLevel: p.hire_level || null,
      asked: r.asked, confirmed: r.confirmed, declined: r.declined, expired: r.expired, cancelled: r.cancelled, pending: r.pending,
      assigned: r.assigned, completed: r.completed, missed: r.missed,
      acceptRate: rate(r.confirmed, settled),
      avgResponseHours: r.responseHours.length ? round(r.responseHours.reduce((a, b) => a + b, 0) / r.responseHours.length) : null,
    };
  }).sort((a, b) => b.assigned - a.assigned || b.asked - a.asked || a.name.localeCompare(b.name));

  const observers = people.filter((p) => p.assigned > 0);
  const assignments = observers.reduce((n, p) => n + p.assigned, 0);
  const levels = new Map();
  for (const p of observers) {
    const l = levels.get(p.hireLevel) || { hireLevel: p.hireLevel, observers: 0, assignments: 0 };
    l.observers += 1; l.assignments += p.assigned; levels.set(p.hireLevel, l);
  }
  return {
    term,
    summary: {
      professorsAsked: people.filter((p) => p.asked > 0).length,
      requestsSent: people.reduce((n, p) => n + p.asked, 0),
      observersWithAssignments: observers.length,
      assignments,
      meanAssignmentsPerObserver: observers.length ? round(assignments / observers.length, 2) : 0,
      maxAssignments: observers.length ? Math.max(...observers.map((p) => p.assigned)) : 0,
      busiest: observers.slice(0, 5).map((p) => ({ email: p.email, name: p.name, assigned: p.assigned })),
    },
    byHireLevel: [...levels.values()].sort((a, b) => String(a.hireLevel).localeCompare(String(b.hireLevel))),
    professors: people,
  };
}

async function loadWorkload(term) {
  await getCycleOr404(term);
  const [professors, sections, observations, matches] = await Promise.all([
    Professor.find({}).lean(), CourseSection.find({ term }).lean(), Observation.find({ term }).lean(), ObserverMatch.find({ term }).lean(),
  ]);
  return computeWorkload({ term, professors, sections, observations, matches });
}

module.exports = {
  computeWorkload,
  loadWorkload,
};
