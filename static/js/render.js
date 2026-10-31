// Rendering of math (via MathLive's static renderer), results and errors.
import { convertLatexToMarkup } from '../vendor/mathlive/mathlive.min.mjs';
import { renderGraph } from './graph.js';
import { t } from './i18n.js';
import { renderNumberLine } from './numberline.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// MathLive's HTML extensions (\htmlStyle, \class, \href, ...) can attach styles or links to the
// page, e.g. a background image from another site. The calculator never uses them, so they are
// dropped from anything shown or pasted (their arguments stay, as plain groups).
const HTML_COMMANDS = /\\(?:htmlStyle|htmlData|htmlId|class|cssId|href|url|includegraphics|mathtip|texttip)(?![a-zA-Z])/g;
export const cleanLatex = (latex) => String(latex ?? '').replace(HTML_COMMANDS, '');

export function math(latex, cls = 'math') {
  const span = el('span', { class: cls });
  try {
    span.innerHTML = convertLatexToMarkup(cleanLatex(latex));
  } catch (e) {
    span.textContent = latex;
  }
  return span;
}

// Text with $...$ math segments, as produced by the server's explanations.
export function richText(text, cls) {
  const span = el('span', { class: cls });
  const parts = String(text ?? '').split(/(\$[^$]+\$)/g);
  for (const p of parts) {
    if (p.length > 1 && p.startsWith('$') && p.endsWith('$')) span.append(math(p.slice(1, -1), 'inline-math'));
    else if (p) span.append(document.createTextNode(p));
  }
  return span;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { style: 'position:fixed;left:-9999px' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function copyButton(latex, label = t('Copy LaTeX')) {
  const btn = el('button', { type: 'button', class: 'copy-btn', title: t('Copy this answer as LaTeX') }, label);
  btn.addEventListener('click', async () => {
    const ok = await copyText(latex);
    btn.textContent = ok ? t('Copied') : t('Copy failed');
    btn.classList.toggle('copied', ok);
    setTimeout(() => { btn.textContent = label; btn.classList.remove('copied'); }, 1400);
  });
  return btn;
}

const BADGE = {
  exact: ['exact', 'Exact'],
  'numerical estimate': ['numerical', 'Numerical estimate'],
  undefined: ['undefined', 'Undefined'],
  error: ['error', 'Error'],
};

function badge(kind) {
  if (!kind || !BADGE[kind]) return null;
  const [cls, text] = BADGE[kind];
  return el('span', { class: `badge ${cls}` }, t(text));
}

export function errorBlock(err) {
  const box = el('div', { class: 'error-block' });
  if (err.title) box.append(el('div', { class: 'error-title' }, err.title));
  box.append(el('div', { class: 'error-msg' }, richText(err.message)));
  if (err.source !== undefined && err.span) {
    const src = el('div', { class: 'error-src', title: t('The highlighted part could not be read') });
    src.append(
      el('span', { class: 'read-ok' }, err.before ?? ''),
      el('mark', {}, err.at && err.at.length ? err.at : ' '),
      el('span', {}, err.after ?? ''),
    );
    box.append(src);
  }
  if (err.hint) box.append(el('div', { class: 'error-hint' }, richText(err.hint)));
  return box;
}

function stepsTable(table) {
  const t = el('table', { class: 'steps' },
    el('thead', {}, el('tr', {}, table.columns.map((c) => el('th', {}, c)))),
    el('tbody', {}, table.rows.map((row) => el('tr', {}, row.map((cell) => el('td', {}, cell ? math(cell, '') : ''))))));
  const box = el('details', { class: 'steps-box' }, el('summary', {}, table.caption), t);
  if (table.rows.length <= 12) box.open = true;
  return box;
}

export function resultCard(item, ctx = {}) {
  const isError = item.kind === 'error';
  if (item.kind === 'graph') {
    const card = el('article', { class: 'card graph-card' });
    const box = el('div', { class: 'graph' });
    card.append(box);
    if (item.notes?.length) {
      card.append(el('ul', { class: 'notes' }, item.notes.map((n) => el('li', {}, richText(n)))));
    }
    card.append(el('p', { class: 'muted graph-help' }, item.graph?.three_d
      ? t('Drag to rotate, scroll to zoom, right-drag to move.')
      : t('Drag to pan, scroll to zoom, double-click to reset. Filled dot = point included, hollow dot = not included.')));
    // Plot after the card is in the page, so Plotly can measure its width.
    requestAnimationFrame(() => renderGraph(box, item.graph, { refetch: ctx.refetch }));
    return card;
  }
  const card = el('article', { class: 'card' + (isError ? ' error' : '') });
  const head = el('div', { class: 'card-head' });
  if (item.input_latex) {
    head.append(el('span', {}, t('Interpreted as')), math(item.input_latex, 'interp'));
  }
  const b = badge(item.badge);
  if (b) head.append(b);
  card.append(head);

  for (const line of item.lines ?? []) {
    const row = el('div', { class: 'answer-line' });
    if (line.label) row.append(el('span', { class: 'label' }, line.label));
    row.append(math(line.latex));
    row.append(copyButton(line.copy ?? line.latex));
    card.append(row);
  }
  // Large brackets (matrices) stick out a few pixels: show them instead of a needless scrollbar.
  requestAnimationFrame(() => card.querySelectorAll('.answer-line .math').forEach((m) => {
    if (m.scrollWidth - m.clientWidth <= 4) m.style.overflow = 'visible';
  }));
  if (isError && item.error) card.append(errorBlock(item.error));
  if (item.notes?.length) {
    card.append(el('ul', { class: 'notes' }, item.notes.map((n) => el('li', {}, richText(n)))));
  }
  if (item.table) card.append(stepsTable(item.table));
  if (item.numberline) {
    const box = el('div', { class: 'numberline' });
    card.append(box);
    requestAnimationFrame(() => renderNumberLine(box, item.numberline));
  }
  if (item.graph) {
    const box = el('div', { class: 'graph inline-graph' });
    card.append(box);
    requestAnimationFrame(() => renderGraph(box, item.graph, {}));
  }
  return card;
}

export function renderResponse(container, resp, ctx = {}) {
  container.replaceChildren();
  if (!resp.ok && resp.error) {
    const card = el('article', { class: 'card error' });
    const title = { timeout: t('Timed out'), cancelled: t('Stopped'), parse: t("Couldn't read the input"),
      math: t('Not possible') }[resp.error.kind]
      ?? t('Error');
    card.append(el('div', { class: 'card-head' }, el('strong', {}, title),
      badge(resp.error.kind === 'parse' ? 'error' : 'error')));
    card.append(errorBlock(resp.error));
    container.append(card);
    return;
  }
  if (resp.warning) container.append(el('div', { class: 'warning-banner' }, richText(resp.warning)));
  for (const item of resp.results ?? []) container.append(resultCard(item, ctx));
  if (!resp.results?.length) container.append(el('p', { class: 'muted' }, t('No result.')));
}
