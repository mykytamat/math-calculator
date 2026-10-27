// Page controller: tabs, input mode, calculate/stop, results, history, settings.
import { api } from './api.js';
import { Editor } from './editor.js';
import { redrawAllGraphs } from './graph.js';
import { HistoryPanel } from './history.js';
import { redrawAllNumberLines } from './numberline.js';
import { el, renderResponse } from './render.js';
import { SYNTAX_HELP, TABS } from './tabs.js';

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('mathcalc.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('mathcalc.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

// In the Android app the web view may not use the clipboard itself: go through the native plugin
// (@capacitor/clipboard), so Copy, Paste and MathLive's keyboard paste key work there too.
const nativeClipboard = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.Clipboard : null;
if (nativeClipboard && navigator.clipboard) {
  navigator.clipboard.writeText = (text) => nativeClipboard.write({ string: text });
  navigator.clipboard.readText = async () => (await nativeClipboard.read()).value ?? '';
}

const state = {
  tab: store.get('tab', 'evaluate'),
  running: false,
  timer: null,
};
if (!TABS.some((t) => t.id === state.tab)) state.tab = TABS[0].id;

const $ = (id) => document.getElementById(id);
const resultsBox = $('results');
const statusBox = $('status');
const calcBtn = $('calculate');
const stopBtn = $('stop');
const notice = $('convert-notice');

const editor = new Editor({
  onSubmit: () => calculate(),
  onModeChange: (mode) => store.set('mode', mode),
});

const history = new HistoryPanel({
  onRerun: (it) => loadEntry(it, true),
  onEdit: (it) => loadEntry(it, false),
});

// ---------------------------------------------------------------- settings
const DEFAULT_TIMEOUT = api.defaultTimeout ?? 10;  // the offline version allows longer (phones are slower)
function settings() {
  return {
    decimals: clampInt($('set-decimals').value, 1, 15, 4),
    timeout: clampInt($('set-timeout').value, 1, 600, DEFAULT_TIMEOUT),
  };
}
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
$('set-decimals').value = store.get('decimals', 4);
$('set-timeout').value = store.get('timeout', DEFAULT_TIMEOUT);
for (const id of ['set-decimals', 'set-timeout']) {
  $(id).addEventListener('change', () => {
    const s = settings();
    store.set('decimals', s.decimals);
    store.set('timeout', s.timeout);
  });
}
$('settings-toggle').addEventListener('click', () => { $('settings-panel').hidden = !$('settings-panel').hidden; });

// Theme: automatic (follows the system), light or dark. index.html applies the saved choice early.
function redrawPlots() {  // graphs and number lines take their colours from the theme when drawn
  redrawAllGraphs();
  redrawAllNumberLines();
}
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  redrawPlots();
}
$('set-theme').value = store.get('theme', 'auto');
$('set-theme').addEventListener('change', () => {
  store.set('theme', $('set-theme').value);
  applyTheme($('set-theme').value);
});
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (store.get('theme', 'auto') === 'auto') redrawPlots();
});

// -------------------------------------------------------------------- tabs
function renderTabs() {
  const nav = $('tabs');
  nav.replaceChildren(...TABS.map((t) => {
    const b = el('button', { type: 'button', role: 'tab', class: t.id === state.tab ? 'active' : '' }, t.label);
    b.addEventListener('click', () => selectTab(t.id));
    return b;
  }));
  nav.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });  // phones scroll the tab row
  const tab = TABS.find((t) => t.id === state.tab);
  $('tab-description').textContent = tab.description;
  renderOptions();
  const ex = $('examples');
  ex.replaceChildren(el('span', { class: 'label' }, 'Examples:'), ...tab.examples.map((e) => {
    const chip = el('button', { type: 'button', class: 'chip', title: e.plain }, e.title);
    chip.addEventListener('click', () => {
      if (e.options) {
        // The example also sets the tab's options (e.g. "solutions wanted").
        for (const o of tab.options ?? []) {
          const input = $('opt-' + o.id);
          if (input) input.value = e.options[o.id] ?? '';
        }
        store.set('options.' + tab.id, tabOptions());
      }
      editor.setInput(editor.mode === 'plain' ? e.plain : e.latex.join('\n'));
      calculate();
    });
    return chip;
  }));
}

function selectTab(id) {
  state.tab = id;
  store.set('tab', id);
  renderTabs();
}

// Per-tab options (graph range, depth limit, ...), remembered per tab.
function renderOptions() {
  const tab = TABS.find((t) => t.id === state.tab);
  const box = $('tab-options');
  const saved = store.get('options.' + tab.id, {});
  box.replaceChildren(...(tab.options ?? []).map((o) => {
    const input = el('input', { type: 'text', id: 'opt-' + o.id, placeholder: o.placeholder ?? '',
      size: o.size ?? 7, spellcheck: 'false' });
    input.value = saved[o.id] ?? '';
    input.addEventListener('change', () => store.set('options.' + tab.id, tabOptions()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') calculate(); });
    return el('label', { class: 'opt' }, o.label, input);
  }));
}

function tabOptions() {
  const tab = TABS.find((t) => t.id === state.tab);
  const out = {};
  for (const o of tab?.options ?? []) {
    const v = $('opt-' + o.id)?.value.trim();
    if (v) out[o.id] = v;
  }
  return out;
}

// --------------------------------------------------------------- mode switch
async function switchMode(mode) {
  if (mode === editor.mode) return;
  notice.hidden = true;
  const text = editor.getInput();
  if (!text.trim()) {
    editor.showMode(mode);
    editor.setInput('');
    editor.focus();
    return;
  }
  const from = editor.mode;
  let converted = null;
  try {
    const r = await api.convert(text, from);
    if (r.ok) converted = from === 'latex' ? r.plain : r.latex.join('\n');
    else {
      notice.textContent = `Couldn't convert your input: ${r.error.message} The other editor keeps its previous content.`;
      notice.hidden = false;
    }
  } catch {
    notice.textContent = "Couldn't convert your input (server not reachable).";
    notice.hidden = false;
  }
  editor.showMode(mode);
  if (converted !== null) editor.setInput(converted);
  editor.focus();
}
document.querySelectorAll('.mode-toggle button').forEach((b) => {
  b.addEventListener('click', () => switchMode(b.dataset.mode));
});

// ---------------------------------------------------------------- calculate
async function calculate() {
  if (state.running) return;
  const input = editor.getInput();
  notice.hidden = true;
  if (!input.trim()) {
    statusBox.textContent = 'Type something first.';
    return;
  }
  setRunning(true);
  try {
    const options = { ...settings(), ...tabOptions() };
    const request = { tab: state.tab, mode: editor.mode, input, options };
    const resp = await api.compute(request);
    // Graphs of recursive functions are re-sampled by the server when the view changes.
    const refetch = async (range) => {
      const r = await api.graph({ ...request, options: { ...options, x_range: range } });
      return r.ok ? r.graph : null;
    };
    renderResponse(resultsBox, resp, { refetch });
    statusBox.textContent = resp.elapsed_ms !== undefined ? `Done in ${formatMs(resp.elapsed_ms)}.` : '';
    statusBox.dataset.engine = '';
  } catch (e) {
    renderResponse(resultsBox, { ok: false, error: { kind: 'internal', message: `Could not reach the calculator: ${e.message}` } });
    statusBox.textContent = '';
  } finally {
    setRunning(false);
    history.refresh();
    if (api.engine) showEngineState(api.engine.state, api.engine.detail);  // restarting after Stop or a timeout
  }
}

function formatMs(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function setRunning(on) {
  state.running = on;
  calcBtn.disabled = on;
  stopBtn.hidden = !on;
  clearInterval(state.timer);
  if (on) {
    const t0 = Date.now();
    const what = () => (api.engine?.state === 'loading' ? api.engine.detail : 'Calculating…');
    statusBox.textContent = what();
    state.timer = setInterval(() => {
      statusBox.textContent = `${what()} ${Math.floor((Date.now() - t0) / 1000)} s`;
    }, 500);
  }
}

// The offline version computes in the page: say when its engine is (re)starting.
function showEngineState(engineState, detail) {
  if (state.running) return;
  if (engineState === 'loading') statusBox.textContent = detail;
  else if (engineState === 'failed') statusBox.textContent = `The math engine could not start: ${detail}`;
  else if (statusBox.dataset.engine === 'loading') statusBox.textContent = 'Ready.';
  statusBox.dataset.engine = engineState;
}

calcBtn.addEventListener('click', () => calculate());
stopBtn.addEventListener('click', () => api.cancel());

// ----------------------------------------------------------------- history
function loadEntry(it, run) {
  if (TABS.some((t) => t.id === it.tab)) selectTab(it.tab);
  if (it.options?.decimals) $('set-decimals').value = it.options.decimals;
  const tab = TABS.find((t) => t.id === it.tab);
  for (const o of tab?.options ?? []) {
    const input = $('opt-' + o.id);
    if (input) input.value = it.options?.[o.id] ?? '';
  }
  editor.setInput(it.input, it.input_mode);
  if (run) calculate();
  else editor.focus();
}

// --------------------------------------------------------------- syntax help
$('syntax-help-body').append(el('table', {}, SYNTAX_HELP.map(([a, b]) => el('tr', {}, el('td', {}, a), el('td', {}, b)))));

// -------------------------------------------------------------------- start
editor.showMode(store.get('mode', 'latex'));
renderTabs();
history.refresh();
api.engine?.onChange(showEngineState);
// On a touch screen focusing would pop up the keyboard over half the page before anything is typed.
if (!window.matchMedia('(pointer: coarse)').matches) editor.focus();
window.mathcalc = { editor, calculate, state, api };  // for debugging and end-to-end tests
