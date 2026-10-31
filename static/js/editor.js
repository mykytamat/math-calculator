// Input editor: a stack of MathLive fields (visual mode) or a textarea (plain text).
import { MathfieldElement } from '../vendor/mathlive/mathlive.min.mjs';
import { LANG, t } from './i18n.js';
import { cleanLatex, copyText, el, math } from './render.js';

MathfieldElement.fontsDirectory = new URL('../vendor/mathlive/fonts', import.meta.url).href;
MathfieldElement.soundsDirectory = new URL('../vendor/mathlive/sounds', import.meta.url).href;
MathfieldElement.keypressSound = null;
MathfieldElement.locale = LANG;
MathfieldElement.plonkSound = null;

// Extra shortcuts typed as letters in the visual editor. ("if" is left as plain
// letters: a \text{} shortcut would trap the cursor in text mode.)
const EXTRA_SHORTCUTS = {
  inf: '\\infty',
  otherwise: '\\text{otherwise}',
};

// Toolbar: [label (LaTeX or text), LaTeX to insert, tooltip]
const TOOLBAR = [
  ['\\frac{a}{b}', '\\frac{#@}{#?}', 'Fraction (or type /)'],
  ['\\sqrt{x}', '\\sqrt{#0}', 'Square root (or type sqrt)'],
  ['\\sqrt[n]{x}', '\\sqrt[#?]{#0}', 'n-th root'],
  ['x^{n}', '#@^{#?}', 'Power (or type ^)'],
  ['x_{n}', '#@_{#?}', 'Subscript (or type _)'],
  ['|x|', '\\left|#0\\right|', 'Absolute value (or type |)'],
  null,
  ['\\log_{b}', '\\log_{#?}\\left(#?\\right)', 'Logarithm with a base'],
  ['\\ln', '\\ln\\left(#0\\right)', 'Natural logarithm'],
  ['\\sin', '\\sin\\left(#0\\right)', 'Sine'],
  ['\\cos', '\\cos\\left(#0\\right)', 'Cosine'],
  ['\\tan', '\\tan\\left(#0\\right)', 'Tangent'],
  null,
  ['\\pi', '\\pi', 'Pi (or type pi)'],
  ['e', 'e', "Euler's number"],
  ['\\infty', '\\infty', 'Infinity (or type oo)'],
  ['\\le', '\\le', 'Less than or equal (or type <=)'],
  ['\\ge', '\\ge', 'Greater than or equal (or type >=)'],
  ['\\ne', '\\ne', 'Not equal (or type !=)'],
  ['\\in[a,b]', '\\in\\left\\lbrack #?,#?\\right\\rbrack', 'Restrict to an interval'],
  null,
  ['\\lim_{x\\to a}', '\\lim_{x\\to#?}#?', 'Limit (or type lim); for one side write the point as 0^+ or 0^-'],
  ['\\frac{d}{dx}', '\\frac{d}{dx}\\left(#?\\right)', 'Derivative (or type d/dx)'],
  ['\\int', '\\int#?\\,dx', 'Indefinite integral (+ C)'],
  ['\\int_a^b', '\\int_{#?}^{#?}#?\\,dx', 'Definite integral (or type int); ∞ is allowed as a bound'],
  ['\\sum', '\\sum_{#?}^{#?}#?', 'Sum (or type sum): the start below, e.g. n=1; the end above (∞ allowed); then the terms'],
  ['\\prod', '\\prod_{#?}^{#?}#?', 'Product (or type prod): the start below, e.g. k=1; the end above (a number or a letter); then the factors'],
  null,
  ['\\begin{cases}\\cdot\\\\\\cdot\\end{cases}', '\\begin{cases}#? & #? \\\\ #? & #?\\end{cases}',
    'Cases (piecewise): value & condition on each row'],
  ['\\left\\{\\begin{matrix}\\cdot\\\\\\cdot\\end{matrix}\\right.', '\\begin{cases}#?\\\\ #?\\end{cases}',
    'System of equations or inequalities: one per row (Tab moves to the next row)'],
  ['+\\text{row}', 'addRowAfter', 'Add a row to the cases block or matrix the cursor is in'],
  ['\\operatorname{if}', '\\operatorname{if}', 'The word "if" (for a condition)'],
  ['\\begin{pmatrix}\\cdot&\\cdot\\\\\\cdot&\\cdot\\end{pmatrix}', '\\begin{pmatrix}#? & #?\\\\ #? & #?\\end{pmatrix}', '2×2 matrix'],
  ['+\\text{col}', 'addColumnAfter', 'Add a column to the matrix the cursor is in'],
  ['\\begin{pmatrix}\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\end{pmatrix}',
    '\\begin{pmatrix}#? & #? & #?\\\\ #? & #? & #?\\\\ #? & #? & #?\\end{pmatrix}', '3×3 matrix'],
  ['\\det', '\\det', 'Determinant (or type det)'],
  ['A^{T}', '#@^{T}', 'Transpose'],
  ['A^{-1}', '#@^{-1}', 'Inverse'],
];

// Touch screens get a math keyboard with fewer, bigger keys (MathLive's own has 10 columns,
// too small to hit on a phone) and a short menu of big buttons instead of MathLive's long one.
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
// A key showing `latex` and inserting `insert`; `shift` is the same pair for when Shift is on.
// Names longer than about 4 letters get MathLive's small font so they fit on the key.
// The layer ids let app.css widen these pages' keys.
function key(latex, insert, shift, small = false) {
  const k = { latex, insert };
  if (small) k.class = 'small';
  if (shift) k.shift = { latex: shift[0], insert: shift[1], ...(shift[2] ? { class: 'small' } : {}) };
  return k;
}
const fn = (name, latex = `\\${name}`) => [latex, `${latex}\\left(#0\\right)`];
const fnKey = (name, inverse, small = false) => key(...fn(...name), [...fn(...inverse), true], small);
const SHIFT = { label: '[shift]', width: 1 };
const PHONE_KEYBOARD = [
  {
    label: '123',
    tooltip: t('Numbers (Shift: y, degrees, eˣ, x², ⁿ√, ≠, 1/x, ∞, powers)'),
    layers: [{ id: 'mc-numbers', rows: [
      [key('x', 'x', ['y', 'y']), '[7]', '[8]', '[9]', '[/]', '[(]', '[)]'],
      // Shift+0 is MathLive's ∞, so Shift+π is the degree sign (30° in trigonometry).
      [key('\\pi', '\\pi', ['x^{\\circ}', '#@^{\\circ}']), '[4]', '[5]', '[6]', '[*]',
        key('x^{n}', '#@^{#?}', ['x^2', '#@^{2}']), key('\\sqrt{x}', '\\sqrt{#0}', ['\\sqrt[n]{x}', '\\sqrt[#?]{#0}'])],
      // Our own − and + keys: with Shift MathLive's give ± and a ∑ without limits, which the
      // calculator can't read.
      [key('e', 'e', ['e^{x}', 'e^{#0}']), '[1]', '[2]', '[3]', { latex: '-', label: '&#x2212;', class: 'big-op' },
        { label: '[backspace]', width: 2 }],
      [SHIFT, '[0]', '[.]', '[=]', { latex: '+', label: '+', class: 'big-op' }, '[left]', '[right]'],
    ] }],
  },
  {
    label: 'f(x)',
    tooltip: t('Functions (Shift: arcsin, arccos, arctan, arcctg, sinh, cosh, eˣ, ∏, lg)'),
    layers: [{ id: 'mc-functions', rows: [
      [fnKey(['sin'], ['arcsin']), fnKey(['cos'], ['arccos']), fnKey(['tan'], ['arctan']),
        fnKey(['ctg', '\\operatorname{ctg}'], ['arcctg', '\\operatorname{arcctg}']), fnKey(['sec'], ['sinh']),
        fnKey(['cosec', '\\operatorname{cosec}'], ['cosh'], true), key(...fn('ln'), ['e^{x}', 'e^{#0}'])],
      // \textstyle: the display-size ∫ and Σ don't fit on a key.
      [key('\\textstyle\\int', '\\int#?\\,dx'), key('\\textstyle\\int_{a}^{b}', '\\int_{#?}^{#?}#?\\,dx'),
        key('\\textstyle\\sum', '\\sum_{#?}^{#?}#?', ['\\textstyle\\prod', '\\prod_{#?}^{#?}#?']),
        key('\\lim', '\\lim_{x\\to#?}#?'),
        key('\\tfrac{d}{dx}', '\\frac{d}{dx}\\left(#?\\right)'),
        key('\\log_{b}', '\\log_{#?}\\left(#?\\right)', [...fn('lg'), false], true), key('n!', '#@!')],
      ['<', '>', '\\le', '\\ge', '\\ne', '\\infty', ','],
      [SHIFT, key('|x|', '\\left|#0\\right|'), key('x_{n}', '#@_{#?}'), key('\\sqrt[n]{x}', '\\sqrt[#?]{#0}'),
        '[left]', '[right]', { label: '[backspace]', width: 1 }],
    ] }],
  },
  'alphabetic',
  'greek',
];
if (TOUCH) window.mathVirtualKeyboard.layouts = PHONE_KEYBOARD;

// Holding the math keyboard's ⌫ keeps deleting, as on a phone keyboard. MathLive deletes once,
// when the key is released; after a repeat that release is swallowed so it doesn't take one more.
// Sliding off the key stops. (With Shift the key is "delete all", which doesn't repeat.)
{
  const isDeleteKey = (target) => {
    const k = target instanceof Element ? target.closest('.ML__keyboard .MLK__row > *') : null;
    return [...(k?.querySelectorAll('use') ?? [])].some((u) =>
      /svg-delete-backward/.test(u.getAttribute('xlink:href') ?? u.getAttribute('href') ?? '')
      && u.closest('svg').getBoundingClientRect().width > 0);  // not while Shift shows "delete all"
  };
  let timer = null;
  let repeating = false;
  const stop = () => { clearTimeout(timer); timer = null; };
  const deleteOne = () => {
    const mf = document.activeElement;
    if (mf?.tagName === 'MATH-FIELD') mf.executeCommand('deleteBackward');
  };
  window.addEventListener('pointerdown', (e) => {
    if (!isDeleteKey(e.target)) return;
    stop();
    repeating = false;
    const next = (delay) => {
      timer = setTimeout(() => { repeating = true; deleteOne(); next(70); }, delay);
    };
    next(450);
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (timer !== null && !isDeleteKey(document.elementFromPoint(e.clientX, e.clientY))) stop();
  }, true);
  for (const type of ['pointerup', 'pointercancel']) {
    window.addEventListener(type, (e) => {
      const held = repeating;
      stop();
      repeating = false;
      if (held && type === 'pointerup') e.stopImmediatePropagation();
    }, true);
  }
}

// MathLive copies "$$ latex $$" as plain text (an empty line as "$$  $$"): keep the LaTeX alone.
function fixCopiedText(e) {
  const text = e.clipboardData?.getData('text/plain');
  if (!text) return;
  const inner = text.replace(/^\s*\$\$([\s\S]*)\$\$\s*$/, '$1').trim();
  if (inner === text.trim()) return;
  if (inner) e.clipboardData.setData('text/plain', inner);
  else e.clipboardData.clearData();
}

// The touch menu: one sheet of big buttons, shared by all lines. A button acts only when the
// finger is lifted on it (an ordinary click), and the sheet never scrolls.
class LineMenu {
  constructor() {
    this.field = null;
    const actions = [
      [t('Cut'), () => this.copy(true)],
      [t('Copy'), () => this.copy(false)],
      [t('Paste'), () => this.paste()],
      [t('Select all'), () => { this.field.executeCommand('selectAll'); this.field.focus(); }],
      [t('Clear line'), () => { this.field.value = ''; this.field.focus(); }],
      [t('Cancel'), () => {}],
    ];
    this.sheet = el('div', { class: 'line-menu', role: 'menu' }, actions.map(([label, fn]) => {
      const b = el('button', { type: 'button', role: 'menuitem' }, label);
      b.addEventListener('click', async () => {
        this.close();
        try { await fn(); } catch { /* clipboard unavailable */ }
      });
      return b;
    }));
    this.backdrop = el('div', { class: 'line-menu-backdrop', hidden: '' }, this.sheet);
    this.backdrop.addEventListener('click', (e) => { if (e.target === this.backdrop) this.close(); });
    document.body.append(this.backdrop);
  }

  open(field) {
    this.field = field;
    window.mathVirtualKeyboard.hide();
    this.backdrop.hidden = false;
  }

  close() {
    this.backdrop.hidden = true;
  }

  // The selection, or the whole line when nothing is selected.
  async copy(cut) {
    const f = this.field;
    const whole = f.selectionIsCollapsed;
    const latex = whole ? f.value : f.getValue(f.selection);
    if (!latex.trim()) return;
    await copyText(latex);
    if (!cut) return;
    if (whole) f.value = '';
    else f.executeCommand('deleteBackward');
    f.focus();
  }

  async paste() {
    const text = cleanLatex(await navigator.clipboard.readText()).replace(/^\s*\$\$([\s\S]*)\$\$\s*$/, '$1').trim();
    if (text) this.field.insert(text, { selectionMode: 'after', focus: true });
  }
}
let lineMenu = null;

export class Editor {
  constructor({ onSubmit, onModeChange }) {
    this.onSubmit = onSubmit;
    this.onModeChange = onModeChange;
    this.mode = 'latex';
    this.linesBox = document.getElementById('mf-lines');
    this.visualBox = document.getElementById('editor-visual');
    this.plainBox = document.getElementById('editor-plain');
    this.textarea = document.getElementById('plain-input');
    this.lastFocused = null;
    this.buildToolbar();
    document.getElementById('add-line').addEventListener('click', () => this.addLine('', true));
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.onSubmit();
      }
    });
    this.addLine('', false);
  }

  buildToolbar() {
    const bar = document.getElementById('toolbar');
    for (const entry of TOOLBAR) {
      if (!entry) { bar.append(el('span', { class: 'sep' })); continue; }
      const [label, insert, title] = entry;
      const btn = el('button', { type: 'button', title: t(title) }, math(label, 'tb-math'));
      // Keep focus in the math field when clicking toolbar buttons.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => this.insert(insert));
      bar.append(btn);
    }
  }

  fields() {
    return [...this.linesBox.querySelectorAll('math-field')];
  }

  currentField() {
    const f = this.fields();
    if (this.lastFocused && f.includes(this.lastFocused)) return this.lastFocused;
    return f[f.length - 1];
  }

  insert(latex) {
    const mf = this.currentField();
    if (!mf) return;
    mf.focus();
    if (latex === 'addRowAfter' || latex === 'addColumnAfter') {
      mf.executeCommand(latex);
      return;
    }
    mf.insert(latex, { selectionMode: 'placeholder', focus: true });
  }

  addLine(latex = '', focus = true, after = null) {
    const row = el('div', { class: 'mf-line' });
    const mf = new MathfieldElement();
    mf.setAttribute('aria-label', t('Math input'));
    mf.smartFence = true;
    mf.addEventListener('focusin', () => { this.lastFocused = mf; });
    mf.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.addLine('', true, row);
        else this.onSubmit();
      } else if (e.key === 'Backspace' && !mf.value && this.fields().length > 1) {
        e.preventDefault();
        const prev = row.previousElementSibling?.querySelector('math-field');
        this.removeLine(row);
        prev?.focus();
      }
    }, { capture: true });
    mf.addEventListener('copy', fixCopiedText);
    // Pasted LaTeX loses MathLive's HTML extensions (see cleanLatex) before MathLive sees it.
    mf.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const clean = cleanLatex(text);
      if (clean === text) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      mf.insert(clean, { selectionMode: 'after' });
    }, { capture: true });
    mf.addEventListener('cut', fixCopiedText);
    const remove = el('button', { type: 'button', class: 'remove-line', title: t('Remove this line') }, '×');
    remove.addEventListener('click', () => this.removeLine(row));
    row.append(el('span', { class: 'line-no' }), mf);
    if (TOUCH) {
      const more = el('button', { type: 'button', class: 'line-menu-btn', title: t('Cut, copy, paste') }, '⋯');
      more.addEventListener('click', () => (lineMenu ??= new LineMenu()).open(mf));
      row.append(more);
    }
    row.append(remove);
    if (after) after.after(row); else this.linesBox.append(row);
    // Shortcuts must be set after the element is connected.
    mf.inlineShortcuts = { ...mf.inlineShortcuts, ...EXTRA_SHORTCUTS };
    // Keep MathLive's context menu with a mouse; on touch screens it is replaced by LineMenu.
    mf.menuItems = TOUCH ? [] : mf.menuItems;
    if (latex) mf.value = cleanLatex(latex);
    this.renumber();
    if (focus) setTimeout(() => mf.focus(), 0);
    return mf;
  }

  removeLine(row) {
    if (this.fields().length <= 1) {
      row.querySelector('math-field').value = '';
      return;
    }
    row.remove();
    this.renumber();
  }

  renumber() {
    const rows = [...this.linesBox.children];
    rows.forEach((r, i) => {
      r.querySelector('.line-no').textContent = rows.length > 1 ? String(i + 1) : '';
      r.querySelector('.remove-line').style.visibility = rows.length > 1 ? 'visible' : 'hidden';
    });
  }

  setLatexLines(lines) {
    this.linesBox.replaceChildren();
    const list = lines.length ? lines : [''];
    list.forEach((l) => this.addLine(l, false));
  }

  getInput() {
    if (this.mode === 'plain') return this.textarea.value;
    return this.fields().map((f) => f.value).filter((v) => v.trim()).join('\n');
  }

  setInput(text, mode) {
    if (mode && mode !== this.mode) this.showMode(mode);
    if (this.mode === 'plain') this.textarea.value = text;
    else this.setLatexLines(text.split('\n'));
  }

  showMode(mode) {
    this.mode = mode;
    this.visualBox.hidden = mode !== 'latex';
    this.plainBox.hidden = mode !== 'plain';
    document.querySelectorAll('.mode-toggle button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    this.onModeChange?.(mode);
  }

  focus() {
    if (this.mode === 'plain') this.textarea.focus();
    else this.currentField()?.focus();
  }
}
