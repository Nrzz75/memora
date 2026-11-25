// =====================================================================
// views/decks.js — Liste des paquets (arborescence), création /
// modification d'un paquet, et détail d'un paquet (ses cartes).
// =====================================================================

import * as db from '../db.js';
import {
  listDecks, createDeck, updateDeck, deleteDeck, deckTree, flatTree,
  descendantIds, deckPath, dueCards, cardsOfDecks,
} from '../data.js';
import { esc, plural } from '../utils.js';
import { $, go, toast, confirmDialog, header, icon, empty, deckOptions } from '../ui.js';

// ---------------------------------------------------------------------
// Liste des paquets
// ---------------------------------------------------------------------
export async function renderList(el) {
  const decks = await listDecks();
  const cards = await db.getAll('cards');
  const countByDeck = new Map();
  for (const c of cards) countByDeck.set(c.deckId, (countByDeck.get(c.deckId) || 0) + 1);
  const total = id => descendantIds(id, decks).reduce((s, d) => s + (countByDeck.get(d) || 0), 0);

  const rows = flatTree(deckTree(decks)).map(({ deck, depth }) => `
    <li class="deck-row" style="--depth:${depth}">
      <a class="deck-main" href="#/deck/${esc(deck.id)}">
        <span class="deck-name">${depth ? '<span class="sub-mark">↳</span>' : icon('folder', 'inline')}${esc(deck.name)}</span>
        <span class="muted small">${plural(total(deck.id), 'carte')}</span>
      </a>
    </li>`).join('');

  el.innerHTML = `
    ${header('Paquets', { actions: `<a class="icon-btn" href="#/deck/new" aria-label="Nouveau paquet">${icon('plus')}</a>` })}
    <div class="page">
      ${decks.length ? `<ul class="deck-list">${rows}</ul>` : empty("Aucun paquet pour l'instant.")}
      <a class="btn btn-primary btn-block" href="#/deck/new">${icon('plus')} Nouveau paquet</a>
      <p class="hint">Astuce : un sous-paquet se crée en choisissant un « paquet parent » (ex. Histoire › XXe siècle). Réviser un paquet inclut ses sous-paquets.</p>
    </div>`;
}

// ---------------------------------------------------------------------
// Création / modification d'un paquet
// ---------------------------------------------------------------------
export async function renderForm(el, params) {
  const decks = await listDecks();
  const editing = params.id ? decks.find(d => d.id === params.id) : null;
  if (params.id && !editing) { go('/decks'); return; }
  const defaultNew = await db.getSetting('defaultNewPerDay');
  const deck = editing || { name: '', parentId: params.parent || null, newPerDay: defaultNew };

  el.innerHTML = `
    ${header(editing ? 'Modifier le paquet' : 'Nouveau paquet', { back: editing ? `/deck/${editing.id}` : '/decks' })}
    <div class="page">
      <form id="deck-form" class="stack">
        <label class="field"><span>Nom du paquet</span>
          <input name="name" type="text" required maxlength="120" value="${esc(deck.name)}" placeholder="ex. Histoire" autocomplete="off">
        </label>
        <label class="field"><span>Paquet parent (facultatif)</span>
          <select name="parentId">${deckOptions(decks, deck.parentId, { includeNone: true, excludeId: editing?.id })}</select>
        </label>
        <label class="field"><span>Nouvelles cartes par jour</span>
          <input name="newPerDay" type="number" min="0" max="9999" inputmode="numeric" value="${deck.newPerDay ?? 20}">
          <small>Nombre maximum de cartes jamais vues présentées chaque jour pour ce paquet.</small>
        </label>
        <button class="btn btn-primary btn-block" type="submit">${editing ? 'Enregistrer' : 'Créer le paquet'}</button>
        ${editing ? `<button class="btn btn-danger btn-block" type="button" id="del-deck">${icon('trash')} Supprimer ce paquet</button>` : ''}
      </form>
    </div>`;

  const form = $('#deck-form', el);
  const nameInput = form.elements['name'];
  if (!editing) nameInput.focus();
  form.onsubmit = async e => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const parentId = form.parentId.value || null;
    const newPerDay = Math.max(0, parseInt(form.newPerDay.value, 10) || 0);
    if (editing) {
      await updateDeck({ ...editing, name, parentId, newPerDay });
      toast('Paquet enregistré', 'success');
      go(`/deck/${editing.id}`);
    } else {
      const d = await createDeck(name, parentId, newPerDay);
      toast('Paquet créé', 'success');
      go(`/deck/${d.id}`);
    }
  };
  const delBtn = $('#del-deck', el);
  if (delBtn) delBtn.onclick = async () => {
    const ids = descendantIds(editing.id, decks);
    const n = (await cardsOfDecks(ids)).length;
    const ok = await confirmDialog(
      `Supprimer « ${editing.name} »${ids.length > 1 ? ` et ses ${ids.length - 1} sous-paquet(s)` : ''} ainsi que ${plural(n, 'carte')} ?\nCette action est définitive.`,
      { title: 'Supprimer le paquet', okText: 'Supprimer', danger: true });
    if (!ok) return;
    await deleteDeck(editing.id);
    toast('Paquet supprimé');
    go('/decks');
  };
}

// ---------------------------------------------------------------------
// Détail d'un paquet
// ---------------------------------------------------------------------
export async function renderDetail(el, params) {
  const decks = await listDecks();
  const deck = decks.find(d => d.id === params.id);
  if (!deck) { go('/decks'); return; }
  const ids = descendantIds(deck.id, decks);
  const cards = (await cardsOfDecks(ids)).sort((a, b) => b.createdAt - a.createdAt);
  const { counts } = await dueCards(deck.id);
  const due = counts.new + counts.learn + counts.review;
  const children = decks.filter(d => d.parentId === deck.id);
  const parent = decks.find(d => d.id === deck.parentId);
  const stateLabel = { new: 'Nouvelle', learning: 'En cours', relearning: 'À réapprendre', review: 'Apprise' };

  el.innerHTML = `
    ${header(deck.name, { back: parent ? `/deck/${parent.id}` : '/decks', actions: `<a class="icon-btn" href="#/deck/${esc(deck.id)}/edit" aria-label="Modifier le paquet">${icon('edit')}</a>` })}
    <div class="page">
      ${parent ? `<p class="muted small">${esc(deckPath(deck.id, decks))}</p>` : ''}
      <section class="card-box">
        <div class="counts big">
          <span class="c-new"><b>${counts.new}</b> nouvelles</span>
          <span class="c-learn"><b>${counts.learn}</b> en cours</span>
          <span class="c-review"><b>${counts.review}</b> à revoir</span>
        </div>
        <a class="btn btn-primary btn-block btn-big ${due ? '' : 'disabled'}" href="${due ? `#/study/${esc(deck.id)}` : `#/deck/${esc(deck.id)}`}">${icon('play')} ${due ? `Réviser (${due})` : 'Rien à réviser aujourd\'hui'}</a>
        <div class="grid-2">
          <a class="btn btn-block" href="#/practice/${esc(deck.id)}">${icon('fire')} Difficiles</a>
          <a class="btn btn-block" href="#/exam/${esc(deck.id)}">${icon('timer')} Examen</a>
        </div>
      </section>

      <div class="grid-2">
        <a class="btn btn-block" href="#/card/new?deck=${esc(deck.id)}">${icon('plus')} Carte</a>
        <a class="btn btn-block" href="#/ai?deck=${esc(deck.id)}">${icon('ai')} Avec l'IA</a>
      </div>

      <h2 class="section-title">Sous-paquets</h2>
      ${children.length ? `<ul class="deck-list">${children.map(c => `
        <li class="deck-row"><a class="deck-main" href="#/deck/${esc(c.id)}"><span class="deck-name">${icon('folder', 'inline')}${esc(c.name)}</span>${icon('chevron')}</a></li>`).join('')}</ul>` : ''}
      <a class="btn btn-ghost btn-small" href="#/deck/new?parent=${esc(deck.id)}">${icon('plus')} Ajouter un sous-paquet</a>

      <h2 class="section-title">Cartes (${cards.length})</h2>
      ${cards.length ? `<input id="search" type="search" placeholder="Rechercher une carte…" class="search">` : ''}
      <ul class="card-list" id="card-list"></ul>
      <button class="btn btn-ghost btn-block hidden" id="more">Afficher plus</button>
      ${cards.length ? '' : empty('Ce paquet est vide.')}
    </div>`;

  // Liste des cartes, affichée par blocs de 100 (plus fluide)
  let shown = 100;
  let filtered = cards;
  const list = $('#card-list', el);
  const more = $('#more', el);
  const draw = () => {
    list.innerHTML = filtered.slice(0, shown).map(c => `
      <li><a href="#/card/${esc(c.id)}">
        <span class="card-front">${esc(c.front || '(image)')}</span>
        <span class="card-back muted">${esc(c.back || '')}</span>
        <span class="tag tag-${c.state}">${stateLabel[c.state] || ''}${c.deckId !== deck.id ? ' · ' + esc(decks.find(d => d.id === c.deckId)?.name || '') : ''}</span>
      </a></li>`).join('');
    more.classList.toggle('hidden', filtered.length <= shown);
  };
  draw();
  more.onclick = () => { shown += 100; draw(); };
  const search = $('#search', el);
  if (search) search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    filtered = q ? cards.filter(c => (c.front + ' ' + c.back).toLowerCase().includes(q)) : cards;
    shown = 100;
    draw();
  };
}
