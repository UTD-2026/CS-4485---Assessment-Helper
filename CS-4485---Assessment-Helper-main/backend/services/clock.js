// Every "what time is it" question in the backend goes through here, so the demos and tests
// can move time forward (e.g. "two days later") without waiting.
let override = null;

const now = () => (override ? new Date(override().getTime()) : new Date());
function setClock(dateOrFn) {
  override = typeof dateOrFn === 'function' ? () => new Date(dateOrFn()) : () => new Date(dateOrFn);
}
function resetClock() {
  override = null;
}
const addHours = (date, hours) => new Date(date.getTime() + hours * 3600 * 1000);

module.exports = {
  setClock,
  resetClock,
  now,
  addHours,
};
