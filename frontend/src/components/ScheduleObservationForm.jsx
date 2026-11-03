import React, { useState } from 'react';
import {
  parseClassTiming,
  todayLocalISO,
  validateObservationSlot,
} from '../utils/scheduling.js';
import ClassDayPicker from './ClassDayPicker.jsx';

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
    <div style={{ padding: '15px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '15px' }}>
      <h4 style={{ color: '#b45309' }}>📅 Schedule the specific date</h4>
      <p style={{ fontSize: '0.9rem', color: '#92400e', marginBottom: '10px' }}>
        Coordinate with {observation.observerName} and select the exact date for this observation.
        Your class meets on <strong>{dayNames.join(' and ')}</strong> at <strong>{times.join(', ')}</strong>, so only those days can be booked.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor={`date-${observation.id}`} style={{ fontSize: '0.8rem', fontWeight: 600, color: '#92400e' }}>Date</label>
          <ClassDayPicker
            id={`date-${observation.id}`}
            value={dateVal}
            onChange={(v) => { setDateVal(v); setError(''); }}
            allowedDays={dayIndexes}
            minDate={dateLimits.minDate}
            maxDate={dateLimits.maxDate}
          />
        </div>

        <button
          className="btn-primary sm"
          disabled={!dateVal}
          onClick={handleSubmit}
          style={{ opacity: !dateVal ? 0.5 : 1, cursor: !dateVal ? 'not-allowed' : 'pointer' }}
        >
          Set Meeting Date
        </button>
      </div>

      {error && (
        <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '8px', fontWeight: 500 }}>⚠️ {error}</p>
      )}
    </div>
  );
}
