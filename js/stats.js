// =====================================================================
// stats.js — Calculs des statistiques (fonctions « pures » : elles
// reçoivent les données et renvoient des chiffres, sans rien stocker).
// =====================================================================

import { dayKey, addDays, endOfToday } from './utils.js';

/** Nombre de réponses par jour : Map('AAAA-MM-JJ' → nombre). */
export function answersPerDay(reviews) {
  const m = new Map();
  for (const r of reviews) m.set(r.day, (m.get(r.day) || 0) + 1);
  return m;
}

/** Nouvelles cartes étudiées pour la première fois, par jour, sur n jours. */
export function learnedPerDay(reviews, days = 30, today = dayKey()) {
  const m = new Map();
  for (const r of reviews) if (r.wasNew && r.mode === 'review') m.set(r.day, (m.get(r.day) || 0) + 1);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = addDays(today, -i);
    out.push({ day: k, value: m.get(k) || 0 });
  }
  return out;
}

/** Taux de réussite (en %) : réponses autres que « À revoir » / total. */
export function successRate(reviews) {
  const list = reviews.filter(r => r.mode === 'review' || r.mode === 'exam');
  if (!list.length) return null;
  const ok = list.filter(r => r.rating > 1).length;
  return Math.round((ok / list.length) * 100);
}

/** Taux de réussite par paquet : [{deckId, rate, total}]. */
export function successByDeck(reviews) {
  const groups = new Map();
  for (const r of reviews) {
    if (r.mode !== 'review' && r.mode !== 'exam') continue;
    if (!groups.has(r.deckId)) groups.set(r.deckId, []);
    groups.get(r.deckId).push(r);
  }
  return [...groups.entries()]
    .map(([deckId, list]) => ({ deckId, rate: successRate(list), total: list.length }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Prévision de la charge : nombre de cartes à réviser pour chacun des
 * n prochains jours (les cartes en retard comptent pour aujourd'hui).
 */
export function forecast(cards, days = 14, now = Date.now()) {
  const today = dayKey(now);
  const eod = endOfToday(now);
  const counts = new Array(days).fill(0);
  for (const c of cards) {
    if (c.state === 'new') continue;
    if (c.due < eod) { counts[0]++; continue; }
    const k = dayKey(c.due);
    for (let i = 1; i < days; i++) {
      if (addDays(today, i) === k) { counts[i]++; break; }
    }
  }
  return counts.map((value, i) => ({ day: addDays(today, i), value }));
}

/** Série de jours consécutifs avec au moins une révision. */
export function streak(perDay, today = dayKey()) {
  let n = 0;
  let k = today;
  // Si on n'a pas encore révisé aujourd'hui, la série n'est pas cassée
  if (!perDay.get(k)) k = addDays(k, -1);
  while (perDay.get(k)) { n++; k = addDays(k, -1); }
  return n;
}

/**
 * Données de la carte de chaleur : semaines (colonnes) × 7 jours (lignes),
 * du lundi au dimanche, sur n semaines jusqu'à aujourd'hui.
 */
export function heatmap(perDay, weeks = 26, today = dayKey()) {
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7; // 0 = lundi
  const start = addDays(today, -dow - (weeks - 1) * 7);
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const k = addDays(start, w * 7 + i);
      col.push({ day: k, value: k > today ? null : (perDay.get(k) || 0) });
    }
    cols.push(col);
  }
  return cols;
}

/** Niveau de couleur 0..4 pour la carte de chaleur. */
export function heatLevel(v) {
  if (!v) return 0;
  if (v < 10) return 1;
  if (v < 30) return 2;
  if (v < 60) return 3;
  return 4;
}
