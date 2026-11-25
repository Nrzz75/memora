// =====================================================================
// views/stats.js — Statistiques : régularité (carte de chaleur), cartes
// apprises par jour, taux de réussite, prévision, cartes les plus ratées.
// Graphiques dessinés en SVG, sans bibliothèque externe.
// =====================================================================

import * as db from '../db.js';
import { listDecks, deckPath, hardestCards } from '../data.js';
import { answersPerDay, learnedPerDay, successRate, successByDeck, forecast, streak, heatmap, heatLevel } from '../stats.js';
import { esc, dayKey, plural } from '../utils.js';
import { $, header, empty } from '../ui.js';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Format court d'une clé de jour : « 25 nov. » */
function shortDay(k) {
  const [, m, d] = k.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export async function render(el) {
  const [reviews, cards, decks] = await Promise.all([db.getAll('reviews'), db.getAll('cards'), listDecks()]);
  if (!reviews.length && !cards.length) {
    el.innerHTML = `${header('Statistiques')}<div class="page">${empty('Les statistiques apparaîtront après tes premières révisions.')}</div>`;
    return;
  }
  const perDay = answersPerDay(reviews);
  const today = dayKey();
  const last30 = reviews.filter(r => r.ts > Date.now() - 30 * 86400000);
  const rate30 = successRate(last30);
  const rateAll = successRate(reviews);
  const learned = learnedPerDay(reviews, 30);
  const fc = forecast(cards, 14);
  const byDeck = successByDeck(reviews);
  const hard = await hardestCards(null, 15);
  const known = cards.filter(c => c.state === 'review').length;
  const daysActive = [...perDay.keys()].length;

  el.innerHTML = `
    ${header('Statistiques')}
    <div class="page">
      <section class="tiles">
        <div class="tile"><b>${perDay.get(today) || 0}</b><span>${(perDay.get(today) || 0) > 1 ? 'réponses' : 'réponse'} aujourd'hui</span></div>
        <div class="tile"><b>${streak(perDay)}</b><span>${streak(perDay) > 1 ? 'jours' : 'jour'} de série</span></div>
        <div class="tile"><b>${rate30 ?? '–'}${rate30 != null ? ' %' : ''}</b><span>réussite (30 j)</span></div>
        <div class="tile"><b>${known}</b><span>cartes apprises / ${cards.length}</span></div>
      </section>

      <section class="card-box">
        <h2>Régularité</h2>
        <p class="muted small">${plural(daysActive, 'jour')} de révision · chaque case = un jour</p>
        ${heatmapSVG(perDay)}
        <div class="heat-legend"><span>moins</span>${[0, 1, 2, 3, 4].map(l => `<i class="h${l}"></i>`).join('')}<span>plus</span></div>
      </section>

      <section class="card-box">
        <h2>Nouvelles cartes apprises par jour</h2>
        <p class="muted small">30 derniers jours · total ${learned.reduce((s, x) => s + x.value, 0)}</p>
        ${barChart(learned, { id: 'learned' })}
      </section>

      <section class="card-box">
        <h2>Prévision de la charge</h2>
        <p class="muted small">Cartes à réviser les 14 prochains jours (aujourd'hui inclut les retards)</p>
        ${barChart(fc, { id: 'forecast', labelFirst: "auj." })}
      </section>

      <section class="card-box">
        <h2>Taux de réussite</h2>
        <p>Global : <b>${rateAll ?? '–'}${rateAll != null ? ' %' : ''}</b> <span class="muted small">(réponses autres que « À revoir »)</span></p>
        ${byDeck.length ? `<table class="data-table">
          <thead><tr><th>Paquet</th><th>Réussite</th><th>Réponses</th></tr></thead>
          <tbody>${byDeck.map(r => `<tr><td>${esc(deckPath(r.deckId, decks) || '(paquet supprimé)')}</td><td>${r.rate} %</td><td>${r.total}</td></tr>`).join('')}</tbody>
        </table>` : ''}
      </section>

      <section class="card-box">
        <h2>Cartes les plus ratées</h2>
        ${hard.length ? `<ol class="hard-list">${hard.map(h => `
          <li><a href="#/card/${esc(h.card.id)}"><span>${esc(h.card.front || '(image)')}</span>
            <span class="muted small">${plural(h.card.fails, 'oubli')} · ${Math.round(h.rate * 100)} % d'échec</span></a></li>`).join('')}</ol>
          <a class="btn btn-block" href="#/practice/all">S'entraîner sur ces cartes</a>`
        : '<p class="muted">Aucune carte ratée pour l\'instant.</p>'}
      </section>
    </div>
    <div class="chart-tip" id="chart-tip" hidden></div>`;

  // Infobulle au toucher / survol des graphiques
  const tip = $('#chart-tip', el);
  const show = (target, x, y) => {
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
    tip.style.top = Math.max(8, y - 44) + 'px'; // position « fixed » : relative à l'écran
  };
  el.querySelectorAll('[data-tip]').forEach(n => {
    n.addEventListener('pointerenter', e => show(n, e.clientX, e.clientY));
    n.addEventListener('pointerdown', e => show(n, e.clientX, e.clientY));
    n.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
}

/** Graphique en barres (une seule série). data = [{day, value}] */
function barChart(data, { labelFirst = null } = {}) {
  const W = 320, H = 120, padB = 18, padT = 14;
  const max = Math.max(1, ...data.map(d => d.value));
  const n = data.length;
  const slot = W / n;
  const bw = Math.max(3, slot - 2); // 2 px d'espace entre les barres
  const bars = data.map((d, i) => {
    const h = d.value ? Math.max(2, (d.value / max) * (H - padB - padT)) : 0;
    const x = i * slot + (slot - bw) / 2;
    const y = H - padB - h;
    const label = i === 0 && labelFirst ? labelFirst : shortDay(d.day);
    // Zone de toucher plus grande que la barre (toute la hauteur)
    return `<g data-tip="${label} : ${d.value}">
      <rect class="hit" x="${i * slot}" y="0" width="${slot}" height="${H - padB}"/>
      ${h ? `<path class="bar" d="${roundedTop(x, y, bw, h, Math.min(4, bw / 2))}"/>` : ''}
    </g>`;
  }).join('');
  // Étiquettes de l'axe : première, milieu, dernière
  const ticks = [0, Math.floor(n / 2), n - 1].map(i => {
    const label = i === 0 && labelFirst ? labelFirst : shortDay(data[i].day);
    return `<text x="${i * slot + slot / 2}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${label}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Graphique, maximum ${max}">
    <line class="baseline" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>
    <text class="max-label" x="0" y="10">max ${max}</text>
    ${bars}${ticks}
  </svg>`;
}

/** Rectangle aux coins supérieurs arrondis (la base reste droite sur l'axe). */
function roundedTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Carte de chaleur des jours révisés (26 semaines). */
function heatmapSVG(perDay) {
  const cols = heatmap(perDay, 26);
  const s = 11, g = 2;
  const W = cols.length * (s + g), H = 7 * (s + g) + 12;
  let cells = '';
  let monthLabels = '';
  let lastMonth = -1;
  cols.forEach((col, ci) => {
    const m = Number(col[0].day.split('-')[1]) - 1;
    if (m !== lastMonth) {
      if (ci < cols.length - 2) monthLabels += `<text x="${ci * (s + g)}" y="8">${MONTHS[m]}</text>`;
      lastMonth = m;
    }
    col.forEach((cell, ri) => {
      if (cell.value === null) return;
      cells += `<rect data-tip="${shortDay(cell.day)} : ${cell.value} réponse${cell.value > 1 ? 's' : ''}" class="h${heatLevel(cell.value)}" x="${ci * (s + g)}" y="${12 + ri * (s + g)}" width="${s}" height="${s}" rx="2"/>`;
    });
  });
  return `<div class="heat-wrap"><svg class="heatmap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calendrier de régularité">${monthLabels}${cells}</svg></div>`;
}
