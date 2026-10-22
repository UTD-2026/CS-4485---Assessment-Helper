import { mockProfessors, calculateEvaluationStatus } from './mockDatabase.js';

export function buildCommitteeReports(signups, observations, professors = mockProfessors) {
  const faculty = professors.map(p => ({ ...p, ...calculateEvaluationStatus(p) }));
  const due = faculty.filter(p => p.status === 'Due' || p.status === 'Overdue');
  const byLevel = [...new Set(faculty.map(p => p.hire_level))].sort().map(level => ({
    level,
    due: due.filter(p => p.hire_level === level && p.status === 'Due').length,
    overdue: due.filter(p => p.hire_level === level && p.status === 'Overdue').length,
  }));
  const unmatched = due.filter(p => !observations.some(o => o.observeeId === p.professor_id && o.status !== 'Missed')).map(p => {
    const signup = signups.find(s => s.observeeId === p.professor_id);
    const missed = observations.some(o => o.observeeId === p.professor_id && o.status === 'Missed');
    const reason = missed ? 'Observation missed; reassignment needed'
      : !signup ? 'Not signed up'
      : !signup.selectionGenerated ? 'Awaiting committee observer selection'
      : !signup.matchesCount ? 'No eligible observers'
      : 'Awaiting observer confirmation';
    return { ...p, reason };
  });
  const outstanding = observations.filter(o => o.status !== 'Completed').map(o => ({
    ...o,
    hireLevel: professors.find(p => p.professor_id === o.observeeId)?.hire_level || 'Unknown',
    nextAction: o.status === 'Missed' ? 'Reschedule observation'
      : [!o.observerConfirmed && 'Observer confirmation', !o.observeeConfirmed && 'Observee confirmation'].filter(Boolean).join(' and ') || 'Review observation status',
  }));
  const workload = faculty.map(p => {
    const assigned = observations.filter(o => o.observerId === p.professor_id);
    return { ...p, total: assigned.length, completed: assigned.filter(o => o.status === 'Completed').length,
      pending: assigned.filter(o => o.status !== 'Completed' && o.status !== 'Missed').length,
      missed: assigned.filter(o => o.status === 'Missed').length };
  });
  const active = workload.filter(p => p.total > 0);
  const average = active.length ? observations.length / active.length : 0;
  return { byLevel, unmatched, outstanding, workload, average, activeObservers: active.length };
}
