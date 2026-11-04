// Tiny toast bus: replaces window.alert() for success and error messages.
// toast('Saved') / toast.error('Something failed'). <Toaster /> renders them.
let listeners = [];
let nextId = 1;

function emit(message, tone = 'good', options = {}) {
  const item = { id: nextId++, message: String(message), tone, ...options };
  listeners.forEach((fn) => fn(item));
  return item.id;
}

export function toast(message, options) { return emit(message, 'good', options); }
toast.success = (message, options) => emit(message, 'good', options);
toast.error = (message, options) => emit(message, 'bad', { duration: 7000, ...options });
toast.info = (message, options) => emit(message, 'info', options);

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}
