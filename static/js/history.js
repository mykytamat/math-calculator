// History sidebar: every calculation, click to re-run, ✎ to edit, × to delete.
import { api } from './api.js';
import { t } from './i18n.js';
import { el, math } from './render.js';
import { TABS } from './tabs.js';

const TAB_LABEL = Object.fromEntries(TABS.map((tab) => [tab.id, t(tab.label)]));

function timeLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? t : `${d.toLocaleDateString()} ${t}`;
}

export class HistoryPanel {
  constructor({ onRerun, onEdit }) {
    this.onRerun = onRerun;
    this.onEdit = onEdit;
    this.list = document.getElementById('history-list');
    this.empty = document.getElementById('history-empty');
    this.search = document.getElementById('history-search');
    this.panel = document.getElementById('history');
    let timer;
    this.search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.refresh(), 200);
    });
    document.getElementById('history-clear').addEventListener('click', async () => {
      if (!confirm(t('Delete the whole history?'))) return;
      await api.historyClear();
      this.refresh();
    });
    document.getElementById('history-toggle').addEventListener('click', () => {
      if (window.matchMedia('(max-width: 760px)').matches) this.panel.classList.toggle('show-mobile');
      else this.panel.classList.toggle('hidden');
    });
  }

  async refresh() {
    let items = [];
    try {
      items = await api.history(this.search.value.trim());
    } catch {
      return;
    }
    this.list.replaceChildren(...items.map((it) => this.renderItem(it)));
    this.empty.hidden = items.length > 0;
  }

  renderItem(it) {
    const li = el('li', { class: 'history-item', title: t('Click to run again') });
    const meta = el('div', { class: 'h-meta' },
      el('span', {}, TAB_LABEL[it.tab] ?? it.tab),
      el('span', {}, '·'),
      el('span', {}, timeLabel(it.created_at)),
    );
    if (it.status !== 'ok') meta.append(el('span', { class: `h-status ${it.status}` }, t(it.status)));
    li.append(meta);
    if (it.input_mode === 'latex') {
      const box = el('div', { class: 'h-input' });
      it.input.split('\n').forEach((l) => box.append(el('div', {}, math(l, ''))));
      li.append(box);
    } else {
      li.append(el('div', { class: 'h-input plain' }, it.input));
    }
    if (it.summary) li.append(el('div', { class: 'h-result' }, '= ', math(it.summary, '')));
    const edit = el('button', { type: 'button', title: t('Edit without running') }, t('✎ edit'));
    const del = el('button', { type: 'button', title: t('Delete from history') }, '×');
    edit.addEventListener('click', (e) => { e.stopPropagation(); this.closeMobile(); this.onEdit(it); });
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.historyDelete(it.id);
      this.refresh();
    });
    li.append(el('div', { class: 'h-actions' }, edit, del));
    li.addEventListener('click', () => { this.closeMobile(); this.onRerun(it); });
    return li;
  }

  // On a phone the history covers the page: close it once an entry is picked.
  closeMobile() {
    this.panel.classList.remove('show-mobile');
  }
}
