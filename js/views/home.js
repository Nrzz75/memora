// =====================================================================
// views/home.js — Écran d'accueil : objectif du jour, cartes à réviser
// par paquet, rappels (révision et sauvegarde).
// =====================================================================

import * as db from '../db.js';
import { allDeckCounts, deckTree, flatTree } from '../data.js';
import { answersPerDay, streak } from '../stats.js';
import { backupIsDue } from '../backup.js';
import { inAppReminder, showNotification } from '../reminders.js';
import { dayKey, esc, plural } from '../utils.js';
import { icon, empty } from '../ui.js';
import { APP_NAME } from '../config.js';

export async function render(el) {
  const { decks, perDeck, total } = await allDeckCounts();
  const settings = await db.getAllSettings();
  const reviews = await db.getAll('reviews');
  const perDay = answersPerDay(reviews);
  const todayCount = perDay.get(dayKey()) || 0;
  const goal = Math.max(1, settings.dailyGoal || 50);
  const st = streak(perDay);
  const dueTotal = total.new + total.learn + total.review;

  // Rappels
  const banners = [];
  const reminder = await inAppReminder(dueTotal);
  if (reminder) {
    banners.push(`<div class="banner banner-info">${icon('bell')}<span>${esc(reminder)}</span></div>`);
  }
  if (await backupIsDue()) {
    const days = settings.lastBackup ? Math.floor((Date.now() - settings.lastBackup) / 86400000) : null;
    banners.push(`<a class="banner banner-warn" href="#/settings?section=data">${icon('download')}<span>${days === null ? "Tu n'as jamais sauvegardé tes cartes." : `Dernière sauvegarde il y a ${days} jours.`} <u>Sauvegarder maintenant</u></span></a>`);
  }

  const tree = flatTree(deckTree(decks));
  const deckRows = tree.map(({ deck, depth }) => {
    const c = perDeck.get(deck.id);
    const n = c.new + c.learn + c.review;
    return `
      <li class="deck-row" style="--depth:${depth}">
        <a class="deck-main" href="#/${n ? 'study' : 'deck'}/${esc(deck.id)}">
          <span class="deck-name">${depth ? '<span class="sub-mark">↳</span>' : ''}${esc(deck.name)}</span>
          <span class="counts">
            <span class="c-new" title="Nouvelles">${c.new}</span>
            <span class="c-learn" title="En apprentissage">${c.learn}</span>
            <span class="c-review" title="À réviser">${c.review}</span>
          </span>
        </a>
        <a class="icon-btn small" href="#/deck/${esc(deck.id)}" aria-label="Ouvrir le paquet">${icon('chevron')}</a>
      </li>`;
  }).join('');

  const pct = Math.min(1, todayCount / goal);
  const R = 34, C = 2 * Math.PI * R;

  el.innerHTML = `
    <header class="topbar">
      <span class="topbar-spacer"></span>
      <h1>${esc(APP_NAME)}</h1>
      <div class="topbar-actions"><a class="icon-btn" href="#/settings" aria-label="Réglages">${icon('settings')}</a></div>
    </header>
    <div class="page">
      ${banners.join('')}

      <section class="card-box goal">
        <svg class="ring" viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="${R}" class="ring-bg"/>
          <circle cx="40" cy="40" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
        </svg>
        <div class="goal-text">
          <strong>${todayCount} / ${goal}</strong>
          <span>${todayCount >= goal ? 'Objectif du jour atteint 🎉' : 'réponses aujourd\'hui'}</span>
          <span class="muted">${icon('fire', 'inline')} Série : ${plural(st, 'jour')}</span>
        </div>
      </section>

      ${decks.length ? `
        <a class="btn btn-primary btn-block btn-big ${dueTotal ? '' : 'disabled'}" href="${dueTotal ? '#/study/all' : '#/'}">
          ${icon('play')} ${dueTotal ? `Réviser tout (${dueTotal})` : 'Rien à réviser pour le moment'}
        </a>
        <div class="legend"><span class="c-new">Nouvelles</span><span class="c-learn">En cours</span><span class="c-review">À revoir</span></div>
        <ul class="deck-list">${deckRows}</ul>
        <div class="grid-2">
          <a class="btn btn-block" href="#/practice/all">${icon('fire')} Cartes difficiles</a>
          <a class="btn btn-block" href="#/exam/all">${icon('timer')} Mode examen</a>
        </div>
      ` : empty(
        'Bienvenue ! Commence par créer un paquet de cartes, ou laisse l\'IA créer des cartes depuis ton cours.',
        `<div class="stack"><a class="btn btn-primary btn-block" href="#/deck/new">${icon('plus')} Créer un paquet</a>
         <a class="btn btn-block" href="#/ai">${icon('ai')} Créer avec l'IA</a></div>`
      )}
    </div>`;

  // Notification système (si autorisée) quand le rappel s'affiche
  if (reminder && !localStorage.getItem('notif-' + dayKey())) {
    localStorage.setItem('notif-' + dayKey(), '1');
    showNotification(APP_NAME, reminder);
  }
}
