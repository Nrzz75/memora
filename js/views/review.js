// =====================================================================
// views/review.js — Révision des cartes
//   • renderStudy    : révision du jour (planifiée par SM-2)
//   • renderPractice : entraînement sur les cartes les plus ratées
//                      (ne modifie pas la planification)
// =====================================================================

import * as db from '../db.js';
import { StudySession, recordAnswer, hardestCards, getMedia, listDecks, deckPath } from '../data.js';
import { previewIntervals, formatDelay } from '../sm2.js';
import { renderCardText, esc, shuffle, plural } from '../utils.js';
import { $, go, icon, empty, toast } from '../ui.js';

const LABELS = { 1: 'À revoir', 2: 'Difficile', 3: 'Bien', 4: 'Facile' };

// ---------------------------------------------------------------------
// Affichage commun d'une carte (recto, puis verso)
// ---------------------------------------------------------------------
async function cardHTML(card, showBack) {
  const fImg = await getMedia(card.frontImg);
  const bImg = showBack ? await getMedia(card.backImg) : null;
  return `
    <div class="flashcard">
      <div class="fc-front">
        ${fImg ? `<img src="${fImg}" alt="">` : ''}
        <div class="fc-text">${renderCardText(card.front)}</div>
      </div>
      ${showBack ? `
        <hr class="fc-sep">
        <div class="fc-back">
          ${bImg ? `<img src="${bImg}" alt="">` : ''}
          <div class="fc-text">${renderCardText(card.back)}</div>
        </div>` : ''}
    </div>`;
}

function topBar(title, right) {
  return `
    <header class="topbar study-top">
      <a class="icon-btn" href="#/" aria-label="Quitter">${icon('close')}</a>
      <h1>${esc(title)}</h1>
      <div class="topbar-actions">${right}</div>
    </header>`;
}

/** Raccourcis clavier (sur ordinateur) : espace = retourner, 1-4 = noter. */
function bindKeys(handler) {
  const fn = e => {
    if (e.target.matches('input, textarea, select')) return;
    handler(e);
  };
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

// ---------------------------------------------------------------------
// Révision du jour
// ---------------------------------------------------------------------
export async function renderStudy(el, params) {
  const deckId = params.deck === 'all' ? null : params.deck;
  const decks = await listDecks();
  if (deckId && !decks.some(d => d.id === deckId)) { go('/'); return; }
  const title = deckId ? decks.find(d => d.id === deckId).name : 'Toutes les cartes';
  const session = await StudySession.create(deckId);
  let current = null;
  let showBack = false;
  let busy = false;
  let waitTimer = null;

  const draw = async () => {
    clearTimeout(waitTimer);
    current = session.next();
    if (!current) return drawDone();
    const r = session.remaining();
    const counter = `<span class="counts"><span class="c-new">${r.new}</span><span class="c-learn">${r.learn}</span><span class="c-review">${r.review}</span></span>`;
    const path = deckId && current.deckId !== deckId ? `<p class="muted small center">${esc(deckPath(current.deckId, decks))}</p>` : '';
    let buttons;
    if (!showBack) {
      buttons = `<button class="btn btn-primary btn-block btn-big" id="flip">Voir la réponse</button>`;
    } else {
      const iv = previewIntervals(current);
      buttons = `<div class="answer-btns">${[1, 2, 3, 4].map(n => `
        <button class="ans ans-${n}" data-r="${n}">
          <span class="ans-label">${LABELS[n]}</span>
          <span class="ans-ivl">${formatDelay(iv[n])}</span>
        </button>`).join('')}</div>`;
    }
    el.innerHTML = `
      ${topBar(title, counter)}
      <div class="study">
        ${path}
        <div class="study-card" id="tap-zone">${await cardHTML(current, showBack)}</div>
        <div class="study-actions">${buttons}</div>
      </div>`;
    const flip = $('#flip', el);
    if (flip) flip.onclick = () => { showBack = true; draw(); };
    $('#tap-zone', el).onclick = () => { if (!showBack) { showBack = true; draw(); } };
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => answer(Number(b.dataset.r)));
  };

  const answer = async rating => {
    if (busy || !current || !showBack) return;
    busy = true;
    try {
      await session.answer(current, rating);
      if (navigator.vibrate) navigator.vibrate(10);
    } catch (e) {
      toast("Impossible d'enregistrer la réponse : " + e.message, 'error');
    }
    showBack = false;
    busy = false;
    draw();
  };

  const drawDone = () => {
    const nextDue = session.nextLearningDue();
    if (nextDue) {
      // Des cartes en apprentissage reviennent dans quelques minutes
      const ms = nextDue - Date.now();
      el.innerHTML = `
        ${topBar(title, '')}
        <div class="page center">
          <div class="done-box">
            <h2>Petite pause ☕</h2>
            <p>${plural(session.learning.length, 'carte')} en apprentissage revien${session.learning.length > 1 ? 'nent' : 't'} dans ${formatDelay(ms)}.</p>
            <p class="muted">Tu peux attendre ici (ça reprendra tout seul) ou revenir plus tard.</p>
            <a class="btn btn-block" href="#/">Retour à l'accueil</a>
          </div>
        </div>`;
      waitTimer = setTimeout(draw, Math.max(1000, ms - 20 * 60 * 1000 + 1000));
      return;
    }
    el.innerHTML = `
      ${topBar(title, '')}
      <div class="page center">
        <div class="done-box">
          <div class="big-emoji">🎉</div>
          <h2>Bravo, c'est fini pour aujourd'hui !</h2>
          <p>${plural(session.done, 'réponse')} pendant cette session.</p>
          <a class="btn btn-primary btn-block" href="#/">Retour à l'accueil</a>
          <a class="btn btn-block" href="#/practice/${esc(params.deck)}">${icon('fire')} S'entraîner sur les cartes difficiles</a>
        </div>
      </div>`;
  };

  const unbind = bindKeys(e => {
    if (!current) return;
    if ((e.key === ' ' || e.key === 'Enter') && !showBack) { e.preventDefault(); showBack = true; draw(); }
    else if (showBack && ['1', '2', '3', '4'].includes(e.key)) answer(Number(e.key));
  });

  await draw();
  return () => { unbind(); clearTimeout(waitTimer); };
}

// ---------------------------------------------------------------------
// Cartes difficiles (entraînement libre)
// ---------------------------------------------------------------------
export async function renderPractice(el, params) {
  const deckId = params.deck === 'all' ? null : params.deck;
  const decks = await listDecks();
  const title = deckId ? (decks.find(d => d.id === deckId)?.name || 'Paquet') : 'Cartes difficiles';
  const hard = await hardestCards(deckId, 30);

  if (!hard.length) {
    el.innerHTML = `${topBar(title, '')}<div class="page">${empty("Aucune carte difficile pour l'instant : tu n'as encore raté aucune carte. Bravo !", '<a class="btn" href="#/">Retour</a>')}</div>`;
    return;
  }

  // File : les cartes ratées ici reviennent à la fin de la file
  let queue = shuffle(hard.map(h => h.card));
  const total = queue.length;
  let known = 0;
  let showBack = false;

  const draw = async () => {
    const card = queue[0];
    if (!card) {
      el.innerHTML = `
        ${topBar(title, '')}
        <div class="page center"><div class="done-box">
          <div class="big-emoji">💪</div>
          <h2>Entraînement terminé</h2>
          <p>${plural(total, 'carte difficile revue', 'cartes difficiles revues')}.</p>
          <a class="btn btn-primary btn-block" href="#/">Retour à l'accueil</a>
        </div></div>`;
      return;
    }
    el.innerHTML = `
      ${topBar(title, `<span class="muted small">${known}/${total}</span>`)}
      <div class="study">
        <p class="hint center">Entraînement libre : ne change pas le planning de révision.</p>
        <div class="study-card" id="tap-zone">${await cardHTML(card, showBack)}</div>
        <div class="study-actions">
          ${showBack ? `
            <div class="answer-btns two">
              <button class="ans ans-1" data-r="1"><span class="ans-label">Raté</span><span class="ans-ivl">revient</span></button>
              <button class="ans ans-3" data-r="3"><span class="ans-label">Su</span><span class="ans-ivl">suivante</span></button>
            </div>` : `<button class="btn btn-primary btn-block btn-big" id="flip">Voir la réponse</button>`}
        </div>
      </div>`;
    const flip = () => { showBack = true; draw(); };
    $('#flip', el)?.addEventListener('click', flip);
    $('#tap-zone', el).onclick = () => { if (!showBack) flip(); };
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => answer(Number(b.dataset.r)));
  };

  const answer = async rating => {
    const card = queue.shift();
    await recordAnswer(card, rating, 'practice');
    if (rating === 1) queue.push(card); else known++;
    showBack = false;
    draw();
  };

  const unbind = bindKeys(e => {
    if (!queue.length) return;
    if ((e.key === ' ' || e.key === 'Enter') && !showBack) { e.preventDefault(); showBack = true; draw(); }
    else if (showBack && (e.key === '1' || e.key === '2')) answer(e.key === '1' ? 1 : 3);
  });
  await draw();
  return unbind;
}
