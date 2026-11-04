import React, { useState } from 'react';
import {
  parseClassTiming,
  todayLocalISO,
  validateObservationSlot,
} from '../utils/scheduling.js';
import ClassDayPicker from './ClassDayPicker.jsx';
import Icon from './Icon.jsx';

// Lets the observee pick the observation date.
// - The calendar only allows the class meeting days (e.g. TR -> Tuesdays and Thursdays), from today
//   through the observation deadline; every other day is greyed out.
// - The time is the class meeting time, so there is nothing to choose.
export default function ScheduleObservationForm({ observation, observationDeadline, onSchedule }) {
  const [dateVal, setDateVal] = useState('');
  const [error, setError] = useState('');
  const { dayIndexes, dayNames, times } = parseClassTiming(observation.timing);
  const classTime = times[0] || '';
  const dateLimits = { minDate: todayLocalISO(), maxDate: observationDeadline || undefined };

  const handleSubmit = () => {
    const slotError = validateObservationSlot(dateVal, classTime, observation.timing, dateLimits);
    if (slotError) {
      setError(slotError);
      return;
    }
    setError('');
    onSchedule(observation.id, dateVal, classTime);
  };

  return (
    <div className="card card-warn stack-sm">
      <div className="row text-warn"><Icon name="calendar" /><strong>Pick the observation date</strong></div>
      <p className="muted">
        Agree on a day with {observation.observerName}. Your class meets on <strong className="text-warn">{dayNames.join(' and ')}</strong> at <strong className="text-warn">{times.join(', ')}</strong>, so only those days can be booked.
      </p>
      <div className="row">
        <label className="field" htmlFor={`date-${observation.id}`}>
          Date
          <ClassDayPicker
            id={`date-${observation.id}`}
            value={dateVal}
            onChange={(v) => { setDateVal(v); setError(''); }}
            allowedDays={dayIndexes}
            minDate={dateLimits.minDate}
            maxDate={dateLimits.maxDate}
          />
        </label>
        <button type="button" className="btn btn-primary push-down" disabled={!dateVal} onClick={handleSubmit}>Set meeting date</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}
