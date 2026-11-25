// =====================================================================
// app.js — Point d'entrée : démarrage, navigation entre les écrans,
// barre d'onglets, service worker (hors connexion) et badge.
// =====================================================================

import { openDB, requestPersistence } from './db.js';
import { allDeckCounts } from './data.js';
import { updateBadge } from './reminders.js';
import { $, icon, toast } from './ui.js';

import * as home from './views/home.js';
import * as decks from './views/decks.js';
import * as cardEditor from './views/cardEditor.js';
import * as review from './views/review.js';
import * as exam from './views/exam.js';
import * as ai from './views/ai.js';
import * as sheets from './views/sheets.js';
import * as stats from './views/stats.js';
import * as settings from './views/settings.js';

// ---------- Table des écrans ----------
// Chaque route : motif d'adresse → fonction d'affichage + onglet actif
const ROUTES = [
  { re: /^\/?$/, view: home.render, tab: 'home' },
  { re: /^\/decks$/, view: decks.renderList, tab: 'decks' },
  { re: /^\/deck\/new$/, view: decks.renderForm, tab: 'decks' },
  { re: /^\/deck\/([^/]+)\/edit$/, view: decks.renderForm, tab: 'decks', keys: ['id'] },
  { re: /^\/deck\/([^/]+)$/, view: decks.renderDetail, tab: 'decks', keys: ['id'] },
  { re: /^\/card\/new$/, view: cardEditor.render, tab: 'decks' },
  { re: /^\/card\/([^/]+)$/, view: cardEditor.render, tab: 'decks', keys: ['id'] },
  { re: /^\/study\/([^/]+)$/, view: review.renderStudy, tab: null, keys: ['deck'] },
  { re: /^\/practice\/([^/]+)$/, view: review.renderPractice, tab: null, keys: ['deck'] },
  { re: /^\/exam\/([^/]+)$/, view: exam.render, tab: null, keys: ['deck'] },
  { re: /^\/ai$/, view: ai.render, tab: 'ai' },
  { re: /^\/sheets$/, view: sheets.renderList, tab: 'sheets' },
  { re: /^\/sheet\/([^/]+)$/, view: sheets.renderDetail, tab: 'sheets', keys: ['id'] },
  { re: /^\/stats$/, view: stats.render, tab: 'stats' },
  { re: /^\/settings$/, view: settings.render, tab: 'home' },
];

const TABS = [
  { id: 'home', href: '#/', label: 'Accueil', icon: 'home' },
  { id: 'decks', href: '#/decks', label: 'Paquets', icon: 'decks' },
  { id: 'ai', href: '#/ai', label: 'Créer (IA)', icon: 'ai' },
  { id: 'sheets', href: '#/sheets', label: 'Fiches', icon: 'sheets' },
  { id: 'stats', href: '#/stats', label: 'Stats', icon: 'stats' },
];

/** Lit l'adresse (#/deck/123?x=1) → { path, query }. */
function parseHash() {
  const raw = decodeURIComponent(location.hash.slice(1) || '/');
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let cleanup = null; // fonction de nettoyage de l'écran précédent (minuteurs…)

async function router() {
  const { path, query } = parseHash();
  const route = ROUTES.find(r => r.re.test(path)) || ROUTES[0];
  const m = path.match(route.re) || [];
  const params = { ...query };
  (route.keys || []).forEach((k, i) => { params[k] = m[i + 1]; });

  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { /* rien */ } }
  cleanup = null;

  renderTabs(route.tab);
  document.body.classList.toggle('no-tabs', route.tab === null);
  const main = $('#app');
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  try {
    cleanup = await route.view(main, params);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="page"><div class="card-box error-box"><h2>Oups</h2><p>Une erreur est survenue : ${String(e.message || e)}</p><a class="btn" href="#/">Retour à l'accueil</a></div></div>`;
  }
  refreshBadge();
}

function renderTabs(active) {
  const nav = $('#tabs');
  nav.innerHTML = TABS.map(t => `
    <a href="${t.href}" class="tab ${t.id === active ? 'active' : ''}" ${t.id === active ? 'aria-current="page"' : ''}>
      ${icon(t.icon)}<span>${t.label}</span>
    </a>`).join('');
}

/** Met à jour le chiffre sur l'icône de l'app. */
export async function refreshBadge() {
  try {
    const { total } = await allDeckCounts();
    await updateBadge(total.new + total.learn + total.review);
  } catch (e) { /* pas grave */ }
}

// ---------- Service worker (mode hors connexion) ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    // Une nouvelle version de l'app est prête → on propose de recharger
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
      });
    });
  }).catch(e => console.warn('Service worker non enregistré', e));

  // On recharge seulement lors d'une MISE À JOUR (pas à la toute première
  // installation, sinon la page se rechargerait pendant qu'on l'utilise)
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

function showUpdateBanner(reg) {
  const bar = document.createElement('div');
  bar.className = 'update-banner';
  bar.innerHTML = `<span>Nouvelle version disponible</span><button class="btn btn-small btn-primary">Mettre à jour</button>`;
  bar.querySelector('button').onclick = () => reg.waiting?.postMessage('skipWaiting');
  document.body.appendChild(bar);
}

// ---------- Démarrage ----------
async function start() {
  try {
    await openDB();
  } catch (e) {
    $('#app').innerHTML = `<div class="page"><div class="card-box error-box"><h2>Stockage indisponible</h2><p>Le navigateur bloque le stockage local (mode navigation privée ?). Ouvre l'app dans une fenêtre normale.</p></div></div>`;
    return;
  }
  requestPersistence();
  window.addEventListener('hashchange', router);
  window.addEventListener('online', () => toast('Connexion rétablie', 'success'));
  window.addEventListener('offline', () => toast('Hors connexion : tout marche sauf l\'IA', 'info', 3500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBadge(); });
  registerSW();
  router();
}

start();
