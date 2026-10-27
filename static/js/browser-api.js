// The offline version's backend: the same calls as the server API (api.js), answered by the math
// engine in a Web Worker (engine-worker.js), with the history kept in this browser's storage.
// Mirrors app/main.py: tabs, time limit, Stop, partial results and the messages.

const TABS = new Set(['evaluate', 'piecewise', 'graph', 'equations', 'calculus', 'sequences', 'parameters', 'matrices']);
const GRAPH_TABS = new Set(['piecewise', 'graph']);  // graphs re-sampled for a new view
const MAX_TIMEOUT = 600;
const DEFAULT_TIMEOUT = 30;  // a phone is several times slower than a PC

// ------------------------------------------------------------------ engine
// Stopping a computation means terminating its worker, and a fresh engine takes 10-20 s to load
// on a phone. So once a job has run SPARE_AFTER_MS, a spare engine starts loading: if the job is
// then stopped or times out, the spare takes over. At most two engines exist at a time.
const SPARE_AFTER_MS = 5000;
const listeners = new Set();
const engine = {
  current: null,   // { worker, ready, state, detail }: ready resolves when it can take a job
  spare: null,     // the same, kept for when the current one has to be stopped
  state: 'off',    // the current engine's: 'loading' | 'ready' | 'failed'
  detail: '',
  job: null,       // the job being computed: { id, resolve, partial, started, timer, spareTimer }
  waiting: new Set(),  // jobs queued behind it (or behind the engine starting)
  queue: Promise.resolve(),
  onChange(fn) { listeners.add(fn); fn(this.state, this.detail); },
};
let nextId = 1;

function setState(state, detail = '') {
  engine.state = state;
  engine.detail = detail;
  for (const fn of listeners) fn(state, detail);
}

function update(inst, state, detail = '') {
  inst.state = state;
  inst.detail = detail;
  if (inst === engine.current) setState(state, detail);
}

function spawn() {
  const w = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
  const inst = { worker: w, state: 'loading', detail: 'Starting the math engine…' };
  inst.ready = new Promise((resolve, reject) => {
    const fail = (message) => {
      update(inst, 'failed', message);
      reject(new Error(message));
      if (inst === engine.spare) dropSpare();
    };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'progress') update(inst, 'loading', m.text);
      else if (m.type === 'ready') { update(inst, 'ready'); resolve(); }
      else if (m.type === 'failed') fail(m.message);
      else if (inst === engine.current) onJobMessage(m);
    };
    w.onerror = (ev) => {
      ev.preventDefault();
      if (inst.state === 'loading') fail(ev.message || 'the engine did not load.');
      else if (inst === engine.current) crashed('The math engine stopped.');
      else if (inst === engine.spare) dropSpare();
    };
  });
  inst.ready.catch(() => {});
  return inst;
}

function dropSpare() {
  engine.spare?.worker.terminate();
  engine.spare = null;
}

function startEngine() {
  engine.current = spawn();
  setState(engine.current.state, engine.current.detail);
}

// The current engine is stopped (Stop, time limit, crash): the spare takes over if there is one.
function restartEngine() {
  engine.current?.worker.terminate();
  if (engine.spare && engine.spare.state !== 'failed') {
    engine.current = engine.spare;
    engine.spare = null;
    setState(engine.current.state, engine.current.detail);
  } else {
    dropSpare();
    startEngine();
  }
}

function crashed(message) {
  restartEngine();
  finishJob({ kind: 'crashed', message });
}

function onJobMessage(m) {
  const job = engine.job;
  if (!job || m.id !== job.id) return;
  if (m.type === 'partial') job.partial = JSON.parse(m.json);
  else if (m.type === 'result') finishJob({ kind: 'ok', value: JSON.parse(m.json) });
  else if (m.type === 'crash') crashed(m.message);
}

function finishJob(outcome) {
  const job = engine.job;
  if (!job) return;
  engine.job = null;
  clearTimeout(job.timer);
  clearTimeout(job.spareTimer);
  job.resolve({ ...outcome, partial: job.partial, elapsed: Date.now() - job.started });
}

// One job at a time, as on the server. The time limit counts from when the engine takes the
// job, so starting the engine doesn't use it up. Resolves with
// { kind: 'ok' | 'timeout' | 'cancelled' | 'crashed' | 'failed', value, partial, message, elapsed }.
function runJob(msg, timeoutS) {
  const ticket = { cancelled: false };
  engine.waiting.add(ticket);
  const run = async () => {
    if (engine.state === 'failed') restartEngine();  // try again: it may have been short of memory
    try {
      await engine.current.ready;
    } catch (e) {
      return { kind: 'failed', message: e.message };
    } finally {
      engine.waiting.delete(ticket);
    }
    if (ticket.cancelled) return { kind: 'cancelled' };
    return new Promise((resolve) => {
      const job = { id: nextId++, resolve, partial: null, started: Date.now() };
      engine.job = job;
      job.timer = setTimeout(() => {
        restartEngine();
        finishJob({ kind: 'timeout' });
      }, timeoutS * 1000);
      job.spareTimer = setTimeout(() => {
        if (!engine.spare) engine.spare = spawn();
      }, SPARE_AFTER_MS);
      engine.current.worker.postMessage({ ...msg, id: job.id });
    });
  };
  const p = engine.queue.then(run);
  engine.queue = p.catch(() => {});
  return p;
}

function timeoutOf(options) {
  const t = Number(options.timeout ?? DEFAULT_TIMEOUT);
  return Number.isFinite(t) ? Math.min(Math.max(t, 1), MAX_TIMEOUT) : DEFAULT_TIMEOUT;
}

const fail = (kind, message, extra = {}) => ({ ok: false, results: [], echo: [], error: { kind, message, ...extra } });

function withWarning(partial, message) {
  return { ok: true, ...partial, warning: message };
}

function engineFailed(message) {
  return fail('internal', `The math engine could not start: ${message}`,
    { hint: 'Close and reopen the app. If it keeps happening, the device may be short of memory.' });
}

// ------------------------------------------------------------------ calls
async function compute(body) {
  const tab = body.tab ?? 'evaluate';
  const mode = body.mode ?? 'plain';
  const input = body.input ?? '';
  const options = body.options ?? {};
  if (!TABS.has(tab)) return { ok: false, error: { kind: 'internal', message: `Unknown tab '${tab}'.` } };
  const timeout = timeoutOf(options);
  const out = await runJob({ op: 'run', name: tab, payload: { input, mode, options } }, timeout);
  let result;
  let status = 'ok';
  if (out.kind === 'ok' && out.value.internal_error === undefined) {
    result = out.value;
    if (!result.ok) status = 'error';
    result.elapsed_ms = out.elapsed;
  } else if (out.kind === 'ok') {  // an unexpected Python error
    status = 'error';
    const e = out.value.internal_error;
    result = fail('internal', 'Internal error: ' + e.split('\n')[0], { details: `${e}\n${out.value.traceback}` });
  } else if (out.kind === 'timeout') {
    status = 'timeout';
    result = out.partial
      ? withWarning(out.partial, `The exact solver ran out of time after ${timeout} s. The answers below come `
        + 'from the fast numerical pass: they are numerical estimates.')
      : fail('timeout', `Timed out after ${timeout} s, so the computation was stopped.`,
        { hint: 'Try a simpler form of the problem, or raise the time limit in Settings.' });
  } else if (out.kind === 'cancelled') {
    status = 'cancelled';
    result = out.partial
      ? withWarning(out.partial, 'Stopped. The answers below come from the fast numerical pass: they are numerical estimates.')
      : fail('cancelled', 'Stopped.');
  } else if (out.kind === 'crashed') {
    status = 'error';
    result = fail('internal', 'The computation engine stopped unexpectedly (possibly out of memory).');
  } else {
    status = 'error';
    result = engineFailed(out.message);
  }
  result.tab = tab;
  result.history_id = addHistory(tab, mode, input, options, status, result.summary_latex ?? null);
  return result;
}

async function graph(body) {
  const tab = body.tab;
  if (!GRAPH_TABS.has(tab)) return { ok: false, error: { kind: 'internal', message: 'No graph here.' } };
  const options = { ...(body.options ?? {}), graph_only: true };
  const payload = { input: body.input ?? '', mode: body.mode ?? 'plain', options };
  const out = await runJob({ op: 'run', name: tab, payload }, timeoutOf(options));
  if (out.kind === 'ok' && out.value.internal_error === undefined) return out.value;
  if (out.kind === 'timeout') return { ok: false, error: { kind: 'timeout', message: 'Re-drawing timed out.' } };
  const message = out.kind === 'ok' ? out.value.internal_error.split('\n')[0] : out.message ?? 'Stopped.';
  return { ok: false, error: { kind: 'internal', message } };
}

async function convert(input, from) {
  const out = await runJob({ op: 'convert', text: input, src: from }, 60);
  if (out.kind === 'ok') return out.value;
  if (out.kind === 'failed') return engineFailed(out.message);
  return { ok: false, error: { kind: 'internal', message: 'The conversion did not finish.' } };
}

async function cancel() {
  for (const t of engine.waiting) t.cancelled = true;
  if (engine.job) {
    restartEngine();
    finishJob({ kind: 'cancelled' });
  }
  return { ok: true };
}

// ----------------------------------------------------------------- history
// As app/history.py, in localStorage. The newest entries are kept when it is full.
const HISTORY_KEY = 'mathcalc.history';
const HISTORY_MAX = 1000;

function loadHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-HISTORY_MAX)));
  } catch { /* storage full or unavailable: the history isn't saved */ }
}

function sortedJson(obj) {
  return JSON.stringify(Object.fromEntries(Object.entries(obj ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function addHistory(tab, inputMode, input, options, status, summary) {
  const items = loadHistory();
  const opts = sortedJson(options);
  const last = items[items.length - 1];
  const now = localIso();
  if (last && last.tab === tab && last.input_mode === inputMode && last.input === input && sortedJson(last.options) === opts) {
    // Re-running the same input: refresh the latest entry instead of duplicating it.
    Object.assign(last, { created_at: now, status, summary });
    saveHistory(items);
    return last.id;
  }
  const id = (last?.id ?? 0) + 1;
  items.push({ id, created_at: now, tab, input_mode: inputMode, input, options: JSON.parse(opts), status, summary });
  saveHistory(items);
  return id;
}

async function history(query = '') {
  const q = query.toLowerCase();
  return loadHistory().reverse()
    .filter((it) => !q || it.input.toLowerCase().includes(q) || (it.summary ?? '').toLowerCase().includes(q))
    .slice(0, 300);
}

async function historyDelete(id) {
  saveHistory(loadHistory().filter((it) => it.id !== id));
}

async function historyClear() {
  saveHistory([]);
}

export const browserApi = {
  compute, graph, cancel, convert, history, historyDelete, historyClear,
  engine,
  defaultTimeout: DEFAULT_TIMEOUT,
  start() {
    if (!engine.current) startEngine();
    return this;
  },
};
