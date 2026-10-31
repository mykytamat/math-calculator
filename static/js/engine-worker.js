// The offline version's math engine: Python (Pyodide) with SymPy in a Web Worker, so the page
// stays responsive and a computation can be stopped by terminating the worker.
// Runs app/browser.py. Files (made by mobile/build.py): ../../pyodide/ and ../../app.zip.

const ROOT = new URL('../../', import.meta.url);
let browser = null;
let current = null;  // id of the job being computed (partial results belong to it)

const progress = (text) => postMessage({ type: 'progress', text });

async function start() {
  progress('Loading the math engine…');
  const { loadPyodide } = await import(new URL('pyodide/pyodide.mjs', ROOT).href);
  const py = await loadPyodide({ indexURL: new URL('pyodide/', ROOT).href });
  progress('Loading SymPy…');
  await py.loadPackage(['sympy', 'mpmath', 'numpy', 'gmpy2'], { messageCallback: () => {}, checkIntegrity: true });
  const r = await fetch(new URL('app.zip', ROOT));
  if (!r.ok) throw new Error(`app.zip: HTTP ${r.status}`);
  py.unpackArchive(await r.arrayBuffer(), 'zip', { extractDir: '/home/pyodide/mathcalc' });
  py.registerJsModule('mathcalc_js', { partial: (json) => postMessage({ id: current, type: 'partial', json }) });
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide/mathcalc')");
  progress('Starting the calculator…');
  browser = py.pyimport('app.browser');
  browser.warm_up();
}

const started = start().then(
  () => postMessage({ type: 'ready' }),
  (e) => postMessage({ type: 'failed', message: String(e?.message ?? e).split('\n')[0] }),
);

onmessage = async ({ data: m }) => {
  await started;
  current = m.id;
  try {
    const json = m.op === 'convert' ? browser.convert(m.text, m.src, m.lang) : browser.run(m.name, JSON.stringify(m.payload));
    postMessage({ id: m.id, type: 'result', json });
  } catch (e) {
    // Python errors are caught in app/browser.py, so this is the engine itself failing
    // (e.g. out of memory). The page then starts a fresh worker.
    postMessage({ id: m.id, type: 'crash', message: String(e?.message ?? e).split('\n')[0] });
  }
};
