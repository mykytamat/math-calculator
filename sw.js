// Offline support for the web version (a service worker; mobile/build.py fills in the two
// placeholders). Every file of the app is stored on the first visit and then served from that
// store, so the calculator works without internet. A new build has a new VERSION: the next
// visit stores its files and drops the old ones.
const VERSION = "dd538a584ba2";
const FILES = [
 "./",
 "NOTICES.txt",
 "app.zip",
 "apple-touch-icon.png",
 "icon-192.png",
 "icon-512.png",
 "icon-maskable-512.png",
 "index.html",
 "manifest.webmanifest",
 "pyodide/gmpy2-2.3.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
 "pyodide/mpmath-1.4.1-py3-none-any.whl",
 "pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
 "pyodide/pyodide-lock.json",
 "pyodide/pyodide.asm.mjs",
 "pyodide/pyodide.asm.wasm",
 "pyodide/pyodide.mjs",
 "pyodide/python_stdlib.zip",
 "pyodide/sympy-1.14.0-py3-none-any.whl",
 "static/css/app.css",
 "static/favicon.svg",
 "static/js/api.js",
 "static/js/app.js",
 "static/js/browser-api.js",
 "static/js/editor.js",
 "static/js/engine-worker.js",
 "static/js/graph.js",
 "static/js/history.js",
 "static/js/i18n.js",
 "static/js/numberline.js",
 "static/js/render.js",
 "static/js/ru.js",
 "static/js/tabs.js",
 "static/vendor/mathlive/LICENSE.txt",
 "static/vendor/mathlive/fonts/KaTeX_AMS-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Caligraphic-Bold.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Caligraphic-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Fraktur-Bold.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Fraktur-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Main-Bold.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Main-BoldItalic.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Main-Italic.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Main-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Math-BoldItalic.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Math-Italic.woff2",
 "static/vendor/mathlive/fonts/KaTeX_SansSerif-Bold.woff2",
 "static/vendor/mathlive/fonts/KaTeX_SansSerif-Italic.woff2",
 "static/vendor/mathlive/fonts/KaTeX_SansSerif-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Script-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Size1-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Size2-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Size3-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Size4-Regular.woff2",
 "static/vendor/mathlive/fonts/KaTeX_Typewriter-Regular.woff2",
 "static/vendor/mathlive/mathlive-fonts.css",
 "static/vendor/mathlive/mathlive-static.css",
 "static/vendor/mathlive/mathlive.min.mjs",
 "static/vendor/mathlive/sounds/keypress-delete.wav",
 "static/vendor/mathlive/sounds/keypress-return.wav",
 "static/vendor/mathlive/sounds/keypress-spacebar.wav",
 "static/vendor/mathlive/sounds/keypress-standard.wav",
 "static/vendor/mathlive/sounds/plonk.wav",
 "static/vendor/plotly/LICENSE.txt",
 "static/vendor/plotly/plotly.min.js"
];
const CACHE = `mathcalc-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mathcalc-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
