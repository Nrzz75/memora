// =====================================================================
// sm2.js — Algorithme de répétition espacée (SM-2, version « à la Anki »)
// ---------------------------------------------------------------------
// Ce fichier ne dépend de rien d'autre : il prend une carte + une note
// (1 = À revoir, 2 = Difficile, 3 = Bien, 4 = Facile) et calcule le
// nouvel état de la carte et sa prochaine date de révision.
//
// États possibles d'une carte :
//   - "new"        : jamais étudiée
//   - "learning"   : en apprentissage (petites étapes en minutes)
//   - "review"     : apprise, révisée tous les X jours
//   - "relearning" : oubliée, on la réapprend (étapes en minutes)
// =====================================================================

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

// Réglages de l'algorithme (valeurs par défaut d'Anki)
export const CONFIG = {
  learningSteps: [1, 10],     // minutes : 1 min puis 10 min
  relearningSteps: [10],      // minutes après un oubli
  graduatingInterval: 1,      // jours : 1er intervalle après l'apprentissage
  easyInterval: 4,            // jours : si « Facile » dès le début
  startingEase: 2.5,          // facilité de départ (250 %)
  minEase: 1.3,               // facilité minimale (130 %)
  easyBonus: 1.3,             // bonus multiplicateur pour « Facile »
  hardFactor: 1.2,            // multiplicateur pour « Difficile »
  lapseInterval: 1,           // jours : intervalle après un oubli
  maxInterval: 36500,         // jours (100 ans)
};

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Crée l'état SM-2 initial d'une nouvelle carte. */
export function newCardState() {
  return {
    state: 'new',
    ease: CONFIG.startingEase,
    interval: 0,   // en jours
    step: 0,       // étape d'apprentissage en cours
    reps: 0,       // nombre total de réponses
    lapses: 0,     // nombre d'oublis (carte apprise puis ratée)
    due: 0,        // date de révision (millisecondes)
    lastReview: 0,
  };
}

/**
 * Calcule le nouvel état d'une carte après une réponse.
 * @param {object} card  la carte (avec ses champs SM-2)
 * @param {number} rating 1..4
 * @param {number} now   horodatage en ms (Date.now() par défaut)
 * @returns {object} nouvel état SM-2 (la carte d'origine n'est pas modifiée)
 */
export function schedule(card, rating, now = Date.now()) {
  const c = {
    state: card.state || 'new',
    ease: card.ease || CONFIG.startingEase,
    interval: card.interval || 0,
    step: card.step || 0,
    reps: (card.reps || 0) + 1,
    lapses: card.lapses || 0,
    due: card.due || 0,
    lastReview: now,
  };

  if (c.state === 'new' || c.state === 'learning') {
    return scheduleLearning(c, rating, now, CONFIG.learningSteps, false);
  }
  if (c.state === 'relearning') {
    return scheduleLearning(c, rating, now, CONFIG.relearningSteps, true);
  }
  return scheduleReview(c, rating, now);
}

// --- Cartes en apprentissage / réapprentissage (étapes en minutes) ---
function scheduleLearning(c, rating, now, steps, isRelearning) {
  const step = c.state === 'new' ? 0 : c.step;

  if (rating === RATING.AGAIN) {
    // Retour à la première étape
    c.state = isRelearning ? 'relearning' : 'learning';
    c.step = 0;
    c.due = now + steps[0] * MINUTE;
    return c;
  }

  if (rating === RATING.HARD) {
    // On répète l'étape en cours, un peu plus tard
    c.state = isRelearning ? 'relearning' : 'learning';
    c.step = step;
    let minutes;
    if (step === 0 && steps.length > 1) minutes = (steps[0] + steps[1]) / 2; // ex. 5,5 min
    else if (step === 0) minutes = steps[0] * 1.5;
    else minutes = steps[step];
    c.due = now + Math.round(minutes * MINUTE);
    return c;
  }

  if (rating === RATING.GOOD) {
    const next = step + 1;
    if (next < steps.length) {
      // Étape suivante
      c.state = isRelearning ? 'relearning' : 'learning';
      c.step = next;
      c.due = now + steps[next] * MINUTE;
      return c;
    }
    // Fin des étapes : la carte « diplôme » et passe en révision
    return graduate(c, now, isRelearning ? Math.max(1, c.interval) : CONFIG.graduatingInterval);
  }

  // EASY : diplôme immédiat avec un intervalle plus long
  if (isRelearning) return graduate(c, now, Math.max(1, c.interval) + 1);
  return graduate(c, now, CONFIG.easyInterval);
}

function graduate(c, now, intervalDays) {
  c.state = 'review';
  c.step = 0;
  c.interval = clampInterval(intervalDays);
  c.due = now + c.interval * DAY;
  return c;
}

// --- Cartes en révision (intervalles en jours) ---
function scheduleReview(c, rating, now) {
  const ivl = Math.max(1, c.interval);
  // Bonus si on révise en retard (comme Anki) : on tient compte du retard
  const daysLate = Math.max(0, Math.floor((now - c.due) / DAY));

  if (rating === RATING.AGAIN) {
    c.lapses += 1;
    c.ease = Math.max(CONFIG.minEase, c.ease - 0.2);
    c.interval = CONFIG.lapseInterval;
    c.state = 'relearning';
    c.step = 0;
    c.due = now + CONFIG.relearningSteps[0] * MINUTE;
    return c;
  }

  let newIvl;
  if (rating === RATING.HARD) {
    c.ease = Math.max(CONFIG.minEase, c.ease - 0.15);
    newIvl = Math.max(ivl + 1, Math.round(ivl * CONFIG.hardFactor));
  } else if (rating === RATING.GOOD) {
    const good = Math.round((ivl + daysLate / 2) * c.ease);
    newIvl = Math.max(ivl + 1, good);
  } else {
    // EASY
    const good = Math.max(ivl + 1, Math.round((ivl + daysLate / 2) * c.ease));
    newIvl = Math.max(good + 1, Math.round((ivl + daysLate) * c.ease * CONFIG.easyBonus));
    c.ease = c.ease + 0.15;
  }
  c.interval = clampInterval(newIvl);
  c.due = now + c.interval * DAY;
  return c;
}

function clampInterval(d) {
  return Math.min(CONFIG.maxInterval, Math.max(1, Math.round(d)));
}

/**
 * Renvoie les 4 délais prévus (en ms) pour afficher sous les boutons.
 * @returns {{1:number,2:number,3:number,4:number}}
 */
export function previewIntervals(card, now = Date.now()) {
  const out = {};
  for (const r of [1, 2, 3, 4]) out[r] = schedule(card, r, now).due - now;
  return out;
}

/** Transforme un délai en texte court : « 1 min », « 3 j », « 2 mois »… */
export function formatDelay(ms) {
  const min = ms / MINUTE;
  if (min < 1) return '< 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const d = ms / DAY;
  if (d < 30) return `${Math.round(d)} j`;
  if (d < 365) return `${trim(d / 30)} mois`;
  return `${trim(d / 365)} an${d / 365 >= 2 ? 's' : ''}`;
}

function trim(n) {
  const r = Math.round(n * 10) / 10;
  return String(r).replace('.', ',');
}
