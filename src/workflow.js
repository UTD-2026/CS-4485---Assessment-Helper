export function localDate(today = new Date()) {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export function validObservationDate(date, deadline, timing, today = localDate()) {
  if (!date || !deadline || date < today || date >= deadline) return false;
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || localDate(parsed) !== date) return false;
  const day = ['U', 'M', 'T', 'W', 'R', 'F', 'S'][parsed.getDay()];
  return timing.trim().split(/\s+/)[0].toUpperCase().includes(day);
}
