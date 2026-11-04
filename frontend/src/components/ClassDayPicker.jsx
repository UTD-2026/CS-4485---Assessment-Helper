import React, { useEffect, useRef, useState } from 'react';
import { parseLocalDate } from '../utils/scheduling.js';
import Icon from './Icon.jsx';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const display = (value) => (value ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}` : '');

/**
 * Date picker that only allows the days a class meets.
 * Props:
 *  - value / onChange: "YYYY-MM-DD"
 *  - allowedDays: JS weekday numbers (0 = Sunday), e.g. [2, 4] for a TR class
 *  - minDate / maxDate: "YYYY-MM-DD" bounds (today and the observation deadline)
 * Every other day is greyed out and cannot be clicked.
 */
export default function ClassDayPicker({ id, value, onChange, allowedDays, minDate, maxDate }) {
  const [open, setOpen] = useState(false);
  const start = parseLocalDate(value) || parseLocalDate(minDate) || new Date();
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const rootRef = useRef(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const isAllowed = (dateStr, weekday) =>
    allowedDays.includes(weekday) && (!minDate || dateStr >= minDate) && (!maxDate || dateStr <= maxDate);

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
  const canPrev = !minDate || monthKey(view.y, view.m) > minDate.slice(0, 7);
  const canNext = !maxDate || monthKey(view.y, view.m) < maxDate.slice(0, 7);
  const shift = (delta) => setView(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const pick = (dateStr) => { onChange(dateStr); setOpen(false); };

  return (
    <div className="class-day-picker" ref={rootRef}>
      <button type="button" id={id} className="class-day-picker-input" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={value ? '' : 'placeholder'}>{value ? display(value) : 'MM/DD/YYYY'}</span>
        <Icon name="calendar" size={16} />
      </button>

      {open && (
        <div className="class-day-picker-pop" role="dialog" aria-label="Choose an observation date">
          <div className="class-day-picker-head">
            <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Previous month"><Icon name="chevronLeft" size={16} /></button>
            <strong>{MONTHS[view.m]} {view.y}</strong>
            <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Next month"><Icon name="chevronRight" size={16} /></button>
          </div>
          <div className="class-day-picker-grid">
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={`class-day-picker-weekday${allowedDays.includes(i) ? ' allowed' : ''}`}>{w}</span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={`blank-${i}`} />;
              const dateStr = iso(view.y, view.m, day);
              const allowed = isAllowed(dateStr, (firstWeekday + day - 1) % 7);
              return (
                <button
                  key={dateStr}
                  type="button"
                  className={`class-day-picker-day${dateStr === value ? ' selected' : ''}`}
                  disabled={!allowed}
                  onClick={() => pick(dateStr)}
                  aria-label={display(dateStr)}
                  aria-pressed={dateStr === value}
                >{day}</button>
              );
            })}
          </div>
          {value && <button type="button" className="class-day-picker-clear" onClick={() => pick('')}>Clear</button>}
        </div>
      )}
    </div>
  );
}
