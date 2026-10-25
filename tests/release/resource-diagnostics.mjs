const traceKey = Symbol.for('tilt.trace-native-diagnostics');
export const resourceState = resource => {
  const state = {kind: resource?.constructor?.name || 'unknown'};
  for (const [name, method] of [['connected', 'isConnected'], ['closed', 'isClosed']]) {
    try {if (typeof resource?.[method] === 'function') state[name] = resource[method]();} catch (error) {state[name + 'Error'] = String(error);}
  }
  try {if (typeof resource?.pages === 'function') state.pages = resource.pages().length;} catch (error) {state.pagesError = String(error);}
  return state;
};

// Install before any fixture delay wrapper. This boundary is the captured public
// Playwright API, not its opaque zip/compression/download implementation.
export function instrumentTraceNative(context) {
  if (context.tracing[traceKey]) return context.tracing[traceKey];
  const listeners = new Set(), events = [], original = context.tracing.stop.bind(context.tracing);
  const emit = (stage, extra = {}) => {
    const event = {stage, at: new Date().toISOString(), monotonicMs: performance.now(), ...extra}; events.push(event);
    for (const listener of listeners) {try {listener(event);} catch {}}
  };
  context.tracing.stop = async options => {
    const started = performance.now(); emit('native-stop-entered', {boundary: 'captured Playwright public API'});
    try {const value = await original(options); emit('native-stop-resolved', {nativeElapsedMs: performance.now() - started}); return value;}
    catch (error) {emit('native-stop-rejected', {nativeElapsedMs: performance.now() - started, error: {name: error.name, message: error.message}}); throw error;}
  };
  const observer = {events, note: emit, subscribe: listener => {listeners.add(listener); return () => listeners.delete(listener);}};
  context.tracing[traceKey] = observer; return observer;
}
