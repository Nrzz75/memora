// =====================================================================
// ui.js — Petits outils d'interface : messages, fenêtres de confirmation,
// navigation, choix de paquet…
// =====================================================================

import { esc } from './utils.js';
import { deckTree, flatTree } from './data.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Va vers un écran : go('/deck/123'). */
export function go(path) {
  location.hash = '#' + path;
}

/** Petit message temporaire en bas de l'écran. */
export function toast(msg, type = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  el.setAttribute('role', 'status');
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

/**
 * Fenêtre de confirmation. Renvoie une promesse : true si « OK ».
 * confirmDialog('Supprimer ?', { okText: 'Supprimer', danger: true })
 */
export function confirmDialog(message, { title = '', okText = 'OK', cancelText = 'Annuler', danger = false } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        ${title ? `<h3>${esc(title)}</h3>` : ''}
        <p>${esc(message).replace(/\n/g, '<br>')}</p>
        <div class="modal-actions">
          ${cancelText ? `<button class="btn btn-ghost" data-r="0">${esc(cancelText)}</button>` : ''}
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(okText)}</button>
        </div>
      </div>`;
    const close = r => { wrap.remove(); resolve(r); };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) close(false);
      const b = e.target.closest('[data-r]');
      if (b) close(b.dataset.r === '1');
    });
    document.body.appendChild(wrap);
    wrap.querySelector('[data-r="1"]').focus();
  });
}

/** Simple message d'information (un seul bouton). */
export function alertDialog(message, title = '') {
  return confirmDialog(message, { title, cancelText: '', okText: 'OK' });
}

/** Fenêtre de saisie de texte. Renvoie le texte ou null. */
export function promptDialog(label, value = '', { title = '', okText = 'OK' } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true">
        ${title ? `<h3>${esc(title)}</h3>` : ''}
        <label class="field"><span>${esc(label)}</span>
          <input type="text" value="${esc(value)}" required></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
          <button type="submit" class="btn btn-primary">${esc(okText)}</button>
        </div>
      </form>`;
    const input = wrap.querySelector('input');
    const close = r => { wrap.remove(); resolve(r); };
    wrap.querySelector('[data-cancel]').onclick = () => close(null);
    wrap.querySelector('form').onsubmit = e => { e.preventDefault(); close(input.value.trim() || null); };
    document.body.appendChild(wrap);
    input.focus();
    input.select();
  });
}

/** Liste déroulante des paquets (avec indentation des sous-paquets). */
export function deckOptions(decks, selectedId = null, { includeNone = false, noneLabel = '— Aucun (paquet principal) —', excludeId = null } = {}) {
  const tree = flatTree(deckTree(decks));
  let excluded = new Set();
  if (excludeId) {
    // On ne peut pas mettre un paquet dans un de ses propres sous-paquets
    const ids = [excludeId];
    for (let i = 0; i < ids.length; i++) for (const d of decks) if (d.parentId === ids[i]) ids.push(d.id);
    excluded = new Set(ids);
  }
  let html = includeNone ? `<option value="">${esc(noneLabel)}</option>` : '';
  for (const { deck, depth } of tree) {
    if (excluded.has(deck.id)) continue;
    html += `<option value="${esc(deck.id)}" ${deck.id === selectedId ? 'selected' : ''}>${'   '.repeat(depth)}${depth ? '↳ ' : ''}${esc(deck.name)}</option>`;
  }
  return html;
}

/** En-tête d'écran avec bouton retour facultatif. */
export function header(title, { back = null, actions = '' } = {}) {
  return `
    <header class="topbar">
      ${back ? `<a class="icon-btn" href="#${esc(back)}" aria-label="Retour">${icon('back')}</a>` : '<span class="topbar-spacer"></span>'}
      <h1>${esc(title)}</h1>
      <div class="topbar-actions">${actions || '<span class="topbar-spacer"></span>'}</div>
    </header>`;
}

/** Icônes SVG (dessinées à la main, aucun fichier externe). */
const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  decks: '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>',
  ai: '<path d="M12 3l1.9 4.8L19 9.5l-4.1 3 1.2 5L12 15l-4.1 2.5 1.2-5-4.1-3 5.1-1.7z"/>',
  sheets: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  fire: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/** Affiche un état vide joli. */
export function empty(text, actionHtml = '') {
  return `<div class="empty"><p>${text}</p>${actionHtml}</div>`;
}

/** Barre de progression simple. */
export function progressBar(value, max) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>`;
}
