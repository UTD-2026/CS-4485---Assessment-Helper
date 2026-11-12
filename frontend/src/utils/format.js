// Small formatting helpers shared by the portals.

// Days from today (local) to an ISO date; negative once it has passed.
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function initials(fullName) {
  const TITLES = ['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'mx'];
  if (!fullName) return 'U';
  const parts = fullName.trim().split(/\s+/).filter((p) => !TITLES.includes(p.replace(/\./g, '').toLowerCase()));
  if (parts.length === 0) return 'U';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
