// =====================================================================
// data.js — Logique « métier » : paquets, cartes, files de révision,
// enregistrement des réponses. S'appuie sur db.js (stockage) et sm2.js.
// =====================================================================

import * as db from './db.js';
import { newCardState, schedule } from './sm2.js';
import { uid, dayKey, endOfToday } from './utils.js';

const LEARN_AHEAD_MS = 20 * 60 * 1000; // on peut montrer une carte en apprentissage 20 min en avance

// ---------------------------------------------------------------------
// PAQUETS
// ---------------------------------------------------------------------
export async function listDecks() {
  const decks = await db.getAll('decks');
  return decks.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function createDeck(name, parentId = null, newPerDay) {
  const deck = {
    id: uid(),
    name: name.trim(),
    parentId: parentId || null,
    newPerDay: Number.isFinite(newPerDay) ? newPerDay : await db.getSetting('defaultNewPerDay'),
    createdAt: Date.now(),
  };
  await db.put('decks', deck);
  return deck;
}

export async function updateDeck(deck) {
  await db.put('decks', deck);
  return deck;
}

/** Supprime un paquet, ses sous-paquets, leurs cartes, images et historique. */
export async function deleteDeck(deckId) {
  const decks = await db.getAll('decks');
  const ids = descendantIds(deckId, decks);
  const cards = (await db.getAll('cards')).filter(c => ids.includes(c.deckId));
  const cardIds = new Set(cards.map(c => c.id));
  const mediaIds = cards.flatMap(c => [c.frontImg, c.backImg]).filter(Boolean);
  const reviews = (await db.getAll('reviews')).filter(r => cardIds.has(r.cardId)).map(r => r.id);
  await db.delMany('cards', [...cardIds]);
  await db.delMany('media', mediaIds);
  await db.delMany('reviews', reviews);
  await db.delMany('decks', ids);
}

/** Liste des identifiants d'un paquet + tous ses sous-paquets. */
export function descendantIds(deckId, decks) {
  const out = [deckId];
  for (let i = 0; i < out.length; i++) {
    for (const d of decks) if (d.parentId === out[i]) out.push(d.id);
  }
  return out;
}

/** Chemin complet d'un paquet : « Histoire › XXe siècle ». */
export function deckPath(deckId, decks, sep = ' › ') {
  const byId = new Map(decks.map(d => [d.id, d]));
  const parts = [];
  let d = byId.get(deckId);
  let guard = 0;
  while (d && guard++ < 50) { parts.unshift(d.name); d = byId.get(d.parentId); }
  return parts.join(sep);
}

/** Arborescence : [{deck, children:[…], depth}] triée par nom. */
export function deckTree(decks) {
  const byParent = new Map();
  for (const d of decks) {
    const k = d.parentId || null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(d);
  }
  const build = (parentId, depth) =>
    (byParent.get(parentId) || [])
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map(deck => ({ deck, depth, children: build(deck.id, depth + 1) }));
  return build(null, 0);
}

/** Aplatis l'arbre (pour les listes déroulantes). */
export function flatTree(tree, out = []) {
  for (const n of tree) { out.push(n); flatTree(n.children, out); }
  return out;
}

/**
 * Trouve (ou crée) un paquet à partir d'un chemin « Histoire::XXe siècle ».
 * Utilisé par l'import CSV.
 */
export async function ensureDeckPath(path, decks) {
  const parts = path.split(/::|›|>/).map(s => s.trim()).filter(Boolean);
  let parentId = null;
  let deck = null;
  for (const name of parts) {
    deck = decks.find(d => (d.parentId || null) === parentId && d.name.toLowerCase() === name.toLowerCase());
    if (!deck) { deck = await createDeck(name, parentId); decks.push(deck); }
    parentId = deck.id;
  }
  return deck;
}

// ---------------------------------------------------------------------
// CARTES
// ---------------------------------------------------------------------
export async function createCard({ deckId, front, back, frontImg = null, backImg = null, sheetId = null, tags = [] }) {
  const card = {
    id: uid(),
    deckId,
    front: front || '',
    back: back || '',
    frontImg, backImg,     // identifiants d'images (store « media »)
    sheetId,               // fiche liée (si créée par l'IA)
    tags,
    createdAt: Date.now(),
    fails: 0,              // nombre de « À revoir »
    seen: 0,               // nombre total de réponses
    ...newCardState(),
  };
  await db.put('cards', card);
  return card;
}

export async function createCards(list) {
  const now = Date.now();
  const cards = list.map((c, i) => ({
    id: uid(), front: '', back: '', frontImg: null, backImg: null, sheetId: null, tags: [],
    createdAt: now + i, fails: 0, seen: 0, ...newCardState(), ...c,
  }));
  await db.putMany('cards', cards);
  return cards;
}

export async function updateCard(card) {
  await db.put('cards', card);
  return card;
}

export async function deleteCard(card) {
  const ids = [card.frontImg, card.backImg].filter(Boolean);
  if (ids.length) await db.delMany('media', ids);
  await db.del('cards', card.id);
}

export async function cardsOfDecks(deckIds) {
  const set = new Set(deckIds);
  return (await db.getAll('cards')).filter(c => set.has(c.deckId));
}

/** Remet une carte à zéro (comme une nouvelle carte). */
export function resetCard(card) {
  return { ...card, ...newCardState(), fails: 0, seen: 0 };
}

// ---------- Images ----------
export async function saveMedia(dataUrl) {
  const id = uid();
  await db.put('media', { id, data: dataUrl });
  return id;
}
export async function getMedia(id) {
  if (!id) return null;
  const m = await db.get('media', id);
  return m ? m.data : null;
}
export async function deleteMedia(id) {
  if (id) await db.del('media', id);
}

// ---------------------------------------------------------------------
// FILES DE RÉVISION
// ---------------------------------------------------------------------

/** Nombre de nouvelles cartes déjà commencées aujourd'hui, par paquet. */
async function newStudiedTodayByDeck() {
  const today = await db.getByIndex('reviews', 'day', dayKey());
  const map = new Map();
  for (const r of today) if (r.wasNew && r.mode === 'review') map.set(r.deckId, (map.get(r.deckId) || 0) + 1);
  return map;
}

/**
 * Calcule ce qui est à réviser aujourd'hui.
 * @param {string|null} rootDeckId paquet choisi (avec ses sous-paquets) ou null = tout
 * @returns {{learning:[], reviews:[], news:[], counts:{new, learn, review}}}
 */
export async function dueCards(rootDeckId = null, ctx = null) {
  const now = Date.now();
  const eod = endOfToday(now);
  const decks = ctx?.decks || await db.getAll('decks');
  const allCards = ctx?.cards || await db.getAll('cards');
  const newToday = ctx?.newToday || await newStudiedTodayByDeck();
  const ids = new Set(rootDeckId ? descendantIds(rootDeckId, decks) : decks.map(d => d.id));

  const learning = [], reviews = [], newByDeck = new Map();
  for (const c of allCards) {
    if (!ids.has(c.deckId)) continue;
    if (c.state === 'learning' || c.state === 'relearning') {
      if (c.due <= now + LEARN_AHEAD_MS) learning.push(c);
    } else if (c.state === 'review') {
      if (c.due < eod) reviews.push(c);
    } else if (c.state === 'new') {
      if (!newByDeck.has(c.deckId)) newByDeck.set(c.deckId, []);
      newByDeck.get(c.deckId).push(c);
    }
  }
  // Nouvelles cartes : limite par paquet (réglable), les plus anciennes d'abord
  const news = [];
  for (const d of decks) {
    if (!ids.has(d.id)) continue;
    const list = (newByDeck.get(d.id) || []).sort((a, b) => a.createdAt - b.createdAt);
    const limit = Math.max(0, (d.newPerDay ?? 20) - (newToday.get(d.id) || 0));
    news.push(...list.slice(0, limit));
  }
  learning.sort((a, b) => a.due - b.due);
  reviews.sort((a, b) => a.due - b.due);
  return {
    learning, reviews, news,
    counts: { new: news.length, learn: learning.length, review: reviews.length },
  };
}

/** Compteurs de tous les paquets d'un coup (écran d'accueil). */
export async function allDeckCounts() {
  const decks = await db.getAll('decks');
  const cards = await db.getAll('cards');
  const newToday = await newStudiedTodayByDeck();
  const ctx = { decks, cards, newToday };
  const result = new Map();
  for (const d of decks) result.set(d.id, (await dueCards(d.id, ctx)).counts);
  const total = (await dueCards(null, ctx)).counts;
  return { decks, cards, perDeck: result, total };
}

/**
 * Session de révision. Utilisation :
 *   const s = await StudySession.create(deckId);
 *   let card = s.next();  … s.answer(card, note) … card = s.next();
 */
export class StudySession {
  static async create(rootDeckId = null) {
    const s = new StudySession();
    const { learning, reviews, news } = await dueCards(rootDeckId);
    s.learning = learning;               // cartes en apprentissage (minutes)
    s.main = interleave(reviews, news);  // révisions + nouvelles mélangées
    s.done = 0;
    return s;
  }

  /** Nombre restant (approximatif, pour l'affichage). */
  remaining() {
    const nNew = this.main.filter(c => c.state === 'new').length;
    return { new: nNew, review: this.main.length - nNew, learn: this.learning.length };
  }

  /** Prochaine carte à montrer, ou null si la session est finie. */
  next(now = Date.now()) {
    this.learning.sort((a, b) => a.due - b.due);
    if (this.learning.length && this.learning[0].due <= now) return this.learning[0];
    if (this.main.length) return this.main[0];
    if (this.learning.length && this.learning[0].due <= now + LEARN_AHEAD_MS) return this.learning[0];
    return null;
  }

  /** Enregistre la réponse et remet la carte dans la file si besoin. */
  async answer(card, rating) {
    this.main = this.main.filter(c => c.id !== card.id);
    this.learning = this.learning.filter(c => c.id !== card.id);
    const updated = await recordAnswer(card, rating, 'review');
    if ((updated.state === 'learning' || updated.state === 'relearning') && updated.due < endOfToday()) {
      this.learning.push(updated);
    }
    this.done++;
    return updated;
  }

  /** Prochaine carte en apprentissage plus tard (pour dire « revenez dans X min »). */
  nextLearningDue() {
    return this.learning.length ? Math.min(...this.learning.map(c => c.due)) : null;
  }
}

/** Répartit les nouvelles cartes régulièrement parmi les révisions. */
function interleave(reviews, news) {
  if (!news.length) return reviews.slice();
  if (!reviews.length) return news.slice();
  const out = [];
  const step = (reviews.length + news.length) / news.length;
  let ni = 0, ri = 0;
  for (let i = 0; i < reviews.length + news.length; i++) {
    if (ni < news.length && Math.floor((ni + 1) * step) - 1 <= i) out.push(news[ni++]);
    else if (ri < reviews.length) out.push(reviews[ri++]);
    else out.push(news[ni++]);
  }
  return out;
}

/**
 * Enregistre une réponse : met à jour la carte (si mode « review ») et
 * ajoute une ligne à l'historique (pour les statistiques et la jauge).
 * mode : 'review' (planifiée), 'practice' (cartes difficiles), 'exam'.
 */
export async function recordAnswer(card, rating, mode = 'review') {
  const now = Date.now();
  let updated = { ...card };
  if (mode === 'review') updated = { ...card, ...schedule(card, rating, now) };
  updated.seen = (card.seen || 0) + 1;
  if (rating === 1) updated.fails = (card.fails || 0) + 1;
  await db.put('cards', updated);
  await db.put('reviews', {
    id: uid(),
    cardId: card.id,
    deckId: card.deckId,
    ts: now,
    day: dayKey(now),
    rating,
    mode,
    wasNew: card.state === 'new',
    prevState: card.state,
    interval: updated.interval,
  });
  return updated;
}

/** Cartes les plus ratées (pour le mode « cartes difficiles » et les stats). */
export async function hardestCards(rootDeckId = null, limit = 30) {
  const decks = await db.getAll('decks');
  const ids = new Set(rootDeckId ? descendantIds(rootDeckId, decks) : decks.map(d => d.id));
  return (await db.getAll('cards'))
    .filter(c => ids.has(c.deckId) && (c.fails || 0) > 0)
    .map(c => ({ card: c, rate: (c.fails || 0) / Math.max(1, c.seen || 0) }))
    .sort((a, b) => (b.card.fails - a.card.fails) || (b.rate - a.rate))
    .slice(0, limit);
}
