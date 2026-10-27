// Thin wrappers around the local JSON API.
import { browserApi } from './browser-api.js';

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok && r.status >= 500) throw new Error(`Server error ${r.status}`);
  return r.json();
}

const serverApi = {
  compute: (body) => post('/api/compute', body),
  graph: (body) => post('/api/graph', body),
  cancel: () => post('/api/cancel'),
  convert: (input, from) => post('/api/convert', { input, from }),
  async history(query = '') {
    const r = await fetch('/api/history' + (query ? `?q=${encodeURIComponent(query)}` : ''));
    return (await r.json()).items;
  },
  async historyDelete(id) {
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
  },
  async historyClear() {
    await fetch('/api/history', { method: 'DELETE' });
  },
};

// The offline version (built by mobile/build.py) computes in the page itself, with no server.
export const api = document.documentElement.dataset.engine === 'browser' ? browserApi.start() : serverApi;
