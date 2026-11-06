import { formatTiming } from '../api/adapters.js';

/*
 * "Next action" for an outstanding observation (Committee reports).
 * The table shows a short "Who: what" keyword; the details pop-up shows a full explanation written for that professor.
 */

// [label, badge tone] for observation status and evaluation (due) status.
export const STATUS = {
  signed_up: ['Signed up', 'neutral'], unmatched: ['No eligible observer', 'bad'], matched: ['Pending scheduling', 'warn'],
  scheduled: ['Scheduled', 'info'], awaiting_confirmation: ['Awaiting confirmation', 'warn'], missed: ['Missed', 'bad'],
};
export const DUE = { due: ['Due', 'warn'], overdue: ['Overdue', 'bad'], not_due: ['Not due', 'neutral'] };

export const scheduleOf = (o) => [o.observation_date, formatTiming(o.timing)].filter(Boolean).join(' · ') || '—';

// Whose turn it is, used both for the short label and for the "Waiting on" filter.
export function nextActor(o) {
  switch (o.status) {
    case 'signed_up': return 'Committee + observee';
    case 'unmatched': return 'Committee';
    case 'matched': return 'Observee';
    case 'scheduled': return 'Observer + observee';
    case 'awaiting_confirmation':
      if (o.observer_confirmed && !o.observee_confirmed) return 'Observee';
      if (o.observee_confirmed && !o.observer_confirmed) return 'Observer';
      return 'Observer + observee';
    case 'missed': return 'Committee';
    default: return 'Committee';
  }
}

const SHORT = {
  signed_up: 'release list / request observers',
  unmatched: 'assign an observer manually',
  matched: 'schedule the date',
  scheduled: 'confirm it happened',
  awaiting_confirmation: 'confirm it happened',
  missed: 'reschedule or follow up',
};

export const nextShort = (o) => SHORT[o.status] || 'review';

export function nextDetail(o) {
  const who = o.observee_name;
  const observer = o.observer_name || 'the observer';
  const course = o.course_code ? `${o.course_code}${o.timing ? ` (${formatTiming(o.timing)})` : ''}` : 'their class';
  const on = o.observation_date ? ` on ${o.observation_date}` : '';
  const upcoming = o.observation_date && o.observation_date >= new Date().toISOString().slice(0, 10);

  switch (o.status) {
    case 'signed_up':
      return `${who} has signed up to be observed in ${course}, but no observer has been chosen yet. `
        + `The committee needs to release the observer list (if it hasn't already), and then ${who} requests observers from it.`;
    case 'unmatched':
      return `No faculty member qualifies to observe ${who} in ${course} under the pairing rules, so the automatic list is empty. `
        + 'The committee needs to pick an observer by hand.';
    case 'matched':
      return `${observer} has agreed to observe ${who} in ${course}, but no date has been set. `
        + `${who} needs to pick the observation date.`;
    case 'scheduled':
      return `${observer} is scheduled to observe ${who} in ${course}${on}. `
        + `${upcoming ? 'Once the class takes place' : 'Now that the date has passed'}, both of them need to confirm in the app that the observation happened.`;
    case 'awaiting_confirmation': {
      const done = o.observer_confirmed ? observer : o.observee_confirmed ? who : null;
      const waiting = o.observer_confirmed ? who : o.observee_confirmed ? observer : null;
      return done
        ? `${done} has confirmed the observation of ${who} in ${course}${on}. It is waiting on ${waiting} to confirm too.`
        : `The observation of ${who} by ${observer} in ${course}${on} is waiting on both of them to confirm it happened.`;
    }
    case 'missed':
      return `The observation of ${who} by ${observer} in ${course}${on} was reported as missed`
        + `${o.missed_reason ? ` ("${o.missed_reason}")` : ''}. `
        + 'The committee needs to reschedule it, assign a new observer, or follow up with both professors.';
    default:
      return o.next_action || 'Review this observation.';
  }
}
