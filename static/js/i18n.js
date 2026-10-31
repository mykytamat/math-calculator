// The page's language. Text is written in English in the code and looked up in the chosen
// language's table (ru.js); the solvers' messages are translated by app/i18n.py (the lang option).
// Automatic follows the device. Changing the language reloads the page.
import { RU } from './ru.js';

function saved() {
  try {
    return JSON.parse(localStorage.getItem('mathcalc.lang'));
  } catch {
    return null;
  }
}

export const LANG_SETTING = ['en', 'ru'].includes(saved()) ? saved() : 'auto';
export const LANG = LANG_SETTING !== 'auto' ? LANG_SETTING
  : (navigator.language ?? '').toLowerCase().startsWith('ru') ? 'ru' : 'en';

export const t = (s) => (LANG === 'ru' ? RU[s] ?? s : s);

// t() for text with values: tf('Done in {}.', '3 ms')
export const tf = (s, ...values) => {
  let i = 0;
  return t(s).replace(/\{\}/g, () => values[i++]);
};

// The static part of the page (index.html).
export function translatePage() {
  document.documentElement.lang = LANG;
  document.title = t(document.title);
  if (LANG === 'en') return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue.trim();
    if (s && RU[s]) n.nodeValue = n.nodeValue.replace(s, RU[s]);
  }
  for (const e of document.body.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      if (e.hasAttribute(a)) e.setAttribute(a, t(e.getAttribute(a)));
    }
  }
}
