import React, { useState } from 'react';
import {
  parseClassTiming,
  todayLocalISO,
  validateObservationDate,
  validateObservationSlot,
} from '../utils/scheduling.js';

// Lets the observee pick the observation date, then the time.
// - Date must fall on one of the class meeting days (e.g. MW -> Monday/Wednesday only)
// - Time can only be chosen after a valid date, and only from the class meeting time
export default function ScheduleObservationForm({ observation, observationDeadline, onSchedule }) {
  const [dateVal, setDateVal] = useState('');
  const [timeVal, setTimeVal] = useState('');
  const [error, setError] = useState('');

  const { dayNames, times } = parseClassTiming(observation.timing);
  const dateLimits = { minDate: todayLocalISO(), maxDate: observationDeadline || undefined };
  const isDateValid = dateVal !== '' && !validateObservationDate(dateVal, observation.timing, dateLimits);

  const handleDateChange = (e) => {
    const value = e.target.value;
    setDateVal(value);
    setTimeVal(''); // force re-selecting the time whenever the date changes
    setError(value ? (validateObservationDate(value, observation.timing, dateLimits) || '') : '');
  };

  const handleSubmit = () => {
    const slotError = validateObservationSlot(dateVal, timeVal, observation.timing, dateLimits);
    if (slotError) {
      setError(slotError);
      return;
    }
    setError('');
    onSchedule(observation.id, dateVal, timeVal);
  };

  return (
    <div style={{ padding: '15px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '15px' }}>
      <h4 style={{ color: '#b45309' }}>📅 Schedule the specific date</h4>
      <p style={{ fontSize: '0.9rem', color: '#92400e', marginBottom: '10px' }}>
        Coordinate with {observation.observerName} and select the exact date for this observation.
        Your class meets on <strong>{dayNames.join(' and ')}</strong> at <strong>{times.join(', ')}</strong>, so only those days and times can be booked.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor={`date-${observation.id}`} style={{ fontSize: '0.8rem', fontWeight: 600, color: '#92400e' }}>Date</label>
          <input
            type="date"
            id={`date-${observation.id}`}
            value={dateVal}
            min={dateLimits.minDate}
            max={dateLimits.maxDate}
            onChange={handleDateChange}
            style={{ padding: '8px', borderRadius: '6px', border: `1px solid ${error && dateVal && !isDateValid ? '#ef4444' : '#d1d5db'}` }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor={`time-${observation.id}`} style={{ fontSize: '0.8rem', fontWeight: 600, color: '#92400e' }}>Time</label>
          <select
            id={`time-${observation.id}`}
            value={timeVal}
            disabled={!isDateValid}
            onChange={(e) => { setTimeVal(e.target.value); setError(''); }}
            title={!isDateValid ? 'Pick a valid class date first' : ''}
            style={{ padding: '8px', borderRadius: '6px', border: '1px solid #d1d5db', minWidth: '140px', cursor: isDateValid ? 'pointer' : 'not-allowed', background: isDateValid ? 'white' : '#f3f4f6' }}
          >
            <option value="">{isDateValid ? 'Select a time' : 'Pick a date first'}</option>
            {isDateValid && times.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <button
          className="btn-primary sm"
          disabled={!isDateValid || !timeVal}
          onClick={handleSubmit}
          style={{ opacity: !isDateValid || !timeVal ? 0.5 : 1, cursor: !isDateValid || !timeVal ? 'not-allowed' : 'pointer' }}
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