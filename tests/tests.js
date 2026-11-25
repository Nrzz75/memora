// =====================================================================
// tests/tests.js — Tests automatiques (s'exécutent dans le navigateur)
// Ouvre tests/index.html via le serveur local pour les lancer.
// =====================================================================

import { schedule, previewIntervals, formatDelay, newCardState, CONFIG } from '../js/sm2.js';
import { dayKey, addDays, renderMarkdown, renderCardText, esc } from '../js/utils.js';
import { parseCSV, rowsToCards, toCSV, detectDelimiter } from '../js/csv.js';
import { forecast, streak, successRate, heatmap, learnedPerDay } from '../js/stats.js';
import * as db from '../js/db.js';
import * as data from '../js/data.js';
import { buildBackup, restoreBackup, validateBackup } from '../js/backup.js';
import { callClaude, AIError } from '../js/ai/claude.js';
import { buildQuestions } from '../js/views/exam.js';
import { makeICS } from '../js/reminders.js';

// ---------- Mini-outil de test ----------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function eq(a, b, msg = '') {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg} attendu ${B}, obtenu ${A}`);
}
function ok(v, msg = 'condition fausse') { if (!v) throw new Error(msg); }
async function rejects(promise, check) {
  try { await promise; } catch (e) { check(e); return; }
  throw new Error("une erreur était attendue");
}

const MIN = 60000, DAY = 86400000;
const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime();

// =====================================================================
// SM-2
// =====================================================================
test('SM-2 : nouvelle carte « À revoir » → 1 min', () => {
  const r = schedule(newCardState(), 1, NOW);
  eq(r.state, 'learning'); eq(r.step, 0); eq(r.due - NOW, 1 * MIN);
});
test('SM-2 : nouvelle carte « Difficile » → 5,5 min', () => {
  const r = schedule(newCardState(), 2, NOW);
  eq(r.state, 'learning'); eq(r.due - NOW, 5.5 * MIN);
});
test('SM-2 : nouvelle carte « Bien » → étape 2 (10 min)', () => {
  const r = schedule(newCardState(), 3, NOW);
  eq(r.state, 'learning'); eq(r.step, 1); eq(r.due - NOW, 10 * MIN);
});
test('SM-2 : nouvelle carte « Facile » → révision dans 4 j', () => {
  const r = schedule(newCardState(), 4, NOW);
  eq(r.state, 'review'); eq(r.interval, 4); eq(r.due - NOW, 4 * DAY);
});
test('SM-2 : fin d\'apprentissage « Bien » → 1 j', () => {
  const c = { ...newCardState(), state: 'learning', step: 1 };
  const r = schedule(c, 3, NOW);
  eq(r.state, 'review'); eq(r.interval, 1);
});
test('SM-2 : apprentissage « Bien » ×2 puis révision', () => {
  let c = schedule(newCardState(), 3, NOW);
  c = schedule(c, 3, NOW + 10 * MIN);
  eq(c.state, 'review'); eq(c.interval, 1); eq(c.reps, 2);
});
const rev = { ...newCardState(), state: 'review', interval: 10, ease: 2.5, due: NOW };
test('SM-2 : révision « Difficile » → ×1,2 et facilité −0,15', () => {
  const r = schedule(rev, 2, NOW);
  eq(r.interval, 12); eq(Math.round(r.ease * 100), 235);
});
test('SM-2 : révision « Bien » → × facilité (25 j)', () => {
  const r = schedule(rev, 3, NOW);
  eq(r.interval, 25); eq(r.ease, 2.5);
});
test('SM-2 : révision « Facile » → bonus (33 j) et facilité +0,15', () => {
  const r = schedule(rev, 4, NOW);
  eq(r.interval, 33); eq(Math.round(r.ease * 100), 265);
});
test('SM-2 : ordre des intervalles Difficile < Bien < Facile', () => {
  const p = previewIntervals(rev, NOW);
  ok(p[1] < p[2] && p[2] < p[3] && p[3] < p[4], JSON.stringify(p));
});
test('SM-2 : oubli → réapprentissage 10 min, oublis +1, facilité −0,2', () => {
  const r = schedule(rev, 1, NOW);
  eq(r.state, 'relearning'); eq(r.lapses, 1); eq(r.due - NOW, 10 * MIN);
  eq(Math.round(r.ease * 100), 230); eq(r.interval, 1);
  const r2 = schedule(r, 3, NOW + 10 * MIN);
  eq(r2.state, 'review'); eq(r2.interval, 1);
});
test('SM-2 : la facilité ne descend jamais sous 130 %', () => {
  let c = { ...rev, ease: 1.35 };
  for (let i = 0; i < 5; i++) c = schedule({ ...c, state: 'review', interval: 5 }, 1, NOW);
  eq(c.ease, CONFIG.minEase);
});
test('SM-2 : intervalle plafonné à 100 ans', () => {
  const r = schedule({ ...rev, interval: 30000, ease: 3 }, 4, NOW);
  eq(r.interval, CONFIG.maxInterval);
});
test('SM-2 : révision en retard → intervalle plus long', () => {
  const late = schedule({ ...rev, due: NOW - 10 * DAY }, 3, NOW);
  ok(late.interval > 25, `obtenu ${late.interval}`);
});
test('SM-2 : la carte d\'origine n\'est pas modifiée', () => {
  const c = { ...rev };
  schedule(c, 4, NOW);
  eq(c.interval, 10);
});
test('Affichage des délais', () => {
  eq(formatDelay(30 * 1000), '< 1 min');
  eq(formatDelay(MIN), '1 min');
  eq(formatDelay(5.5 * MIN), '6 min');
  eq(formatDelay(3 * 3600000), '3 h');
  eq(formatDelay(DAY), '1 j');
  eq(formatDelay(45 * DAY), '1,5 mois');
  eq(formatDelay(400 * DAY), '1,1 an');
  eq(formatDelay(800 * DAY), '2,2 ans');
});

// =====================================================================
// Utilitaires
// =====================================================================
test('Jour : la journée commence à 4 h', () => {
  eq(dayKey(new Date(2026, 10, 25, 3, 0).getTime()), '2026-11-24');
  eq(dayKey(new Date(2026, 10, 25, 5, 0).getTime()), '2026-11-25');
  eq(addDays('2026-12-31', 1), '2027-01-01');
  eq(addDays('2026-03-01', -1), '2026-02-28');
});
test('Sécurité : le HTML des cartes et fiches est neutralisé', () => {
  ok(!renderCardText('<img src=x onerror=alert(1)>').includes('<img'));
  ok(!renderMarkdown('# Titre\n<script>alert(1)</script>').includes('<script>'));
  eq(esc('"a"&<b>'), '&quot;a&quot;&amp;&lt;b&gt;');
});
test('Markdown : titres, listes, gras, tableau, citation', () => {
  const html = renderMarkdown('# Titre\n- un **gras**\n- deux\n\n1. a\n2. b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> retenir');
  ok(html.includes('<h2>Titre</h2>'), html);
  ok(html.includes('<ul><li>un <strong>gras</strong></li>') || html.includes('<ul>\n<li>un <strong>gras</strong></li>'), html);
  ok(html.includes('<ol>'), 'ol');
  ok(html.includes('<th>A</th>') && html.includes('<td>2</td>'), 'tableau');
  ok(!html.includes('---'), 'séparateur de tableau retiré');
  ok(html.includes('<blockquote>retenir</blockquote>'), 'citation');
});

// =====================================================================
// CSV
// =====================================================================
test('CSV : guillemets, retours à la ligne, point-virgule', () => {
  const rows = parseCSV('paquet;recto;verso\nHist::XXe;"Date ; ""armistice"" ?";"11 nov.\n1918"\n');
  eq(rows.length, 2);
  eq(rows[1], ['Hist::XXe', 'Date ; "armistice" ?', '11 nov.\n1918']);
});
test('CSV : détection du séparateur', () => {
  eq(detectDelimiter('a\tb\tc'), '\t');
  eq(detectDelimiter('a,b,c'), ',');
  eq(detectDelimiter('a;b;c'), ';');
});
test('CSV : sans en-tête (recto,verso) et (paquet,recto,verso)', () => {
  eq(rowsToCards(parseCSV('Q1,R1\nQ2,R2')), [{ deckPath: '', front: 'Q1', back: 'R1' }, { deckPath: '', front: 'Q2', back: 'R2' }]);
  eq(rowsToCards(parseCSV('P;Q;R'))[0], { deckPath: 'P', front: 'Q', back: 'R' });
});
test('CSV : en-tête anglais (front/back)', () => {
  eq(rowsToCards(parseCSV('front,back\nHello,Bonjour'))[0], { deckPath: '', front: 'Hello', back: 'Bonjour' });
});
test('CSV : export puis import = identique', () => {
  const rows = [
    { deckPath: 'Histoire::XXe siècle', front: 'Armistice ?', back: '11 novembre "1918"' },
    { deckPath: 'Maths', front: 'a;b', back: 'ligne1\nligne2' },
  ];
  eq(rowsToCards(parseCSV(toCSV(rows))), rows);
});

// =====================================================================
// Statistiques
// =====================================================================
test('Stats : prévision (retards comptés aujourd\'hui)', () => {
  const now = NOW;
  const cards = [
    { state: 'review', due: now - 5 * DAY },
    { state: 'review', due: now + 1000 },
    { state: 'review', due: now + 1 * DAY },
    { state: 'new', due: 0 },
  ];
  const f = forecast(cards, 3, now);
  eq(f.map(x => x.value), [2, 1, 0]);
});
test('Stats : série de jours', () => {
  const m = new Map([['2026-11-25', 3], ['2026-11-24', 1], ['2026-11-23', 2], ['2026-11-21', 5]]);
  eq(streak(m, '2026-11-25'), 3);
  eq(streak(m, '2026-11-26'), 3); // pas encore révisé aujourd'hui : série gardée
  eq(streak(new Map(), '2026-11-25'), 0);
});
test('Stats : taux de réussite', () => {
  eq(successRate([{ mode: 'review', rating: 1 }, { mode: 'review', rating: 3 }, { mode: 'review', rating: 4 }, { mode: 'practice', rating: 1 }]), 67);
  eq(successRate([]), null);
});
test('Stats : carte de chaleur (26 semaines, lundi en premier)', () => {
  const h = heatmap(new Map([['2026-11-25', 4]]), 26, '2026-11-25');
  eq(h.length, 26);
  eq(h[0][0].day, '2026-06-01'); // un lundi
  const last = h[25];
  eq(last[2].day, '2026-11-25'); eq(last[2].value, 4); // mercredi
  eq(last[3].value, null); // jour futur
});
test('Stats : cartes apprises par jour', () => {
  const l = learnedPerDay([{ day: '2026-11-25', wasNew: true, mode: 'review' }, { day: '2026-11-25', wasNew: false, mode: 'review' }], 3, '2026-11-25');
  eq(l.map(x => x.value), [0, 0, 1]);
});

// =====================================================================
// Base de données (création, révision, import, sauvegarde)
// =====================================================================
async function resetDB() {
  for (const s of db.STORES) await db.clear(s);
}

test('Données : paquets et sous-paquets', async () => {
  await resetDB();
  const a = await data.createDeck('Histoire', null, 2);
  const b = await data.createDeck('XXe siècle', a.id, 1);
  const decks = await data.listDecks();
  eq(data.deckPath(b.id, decks), 'Histoire › XXe siècle');
  eq(data.descendantIds(a.id, decks).length, 2);
  const tree = data.deckTree(decks);
  eq(tree.length, 1); eq(tree[0].children[0].deck.name, 'XXe siècle');
});

test('Données : limite de nouvelles cartes par paquet', async () => {
  await resetDB();
  const a = await data.createDeck('A', null, 2);
  const b = await data.createDeck('B', a.id, 1);
  await data.createCards([1, 2, 3].map(i => ({ deckId: a.id, front: 'a' + i, back: 'x' })));
  await data.createCards([1, 2].map(i => ({ deckId: b.id, front: 'b' + i, back: 'y' })));
  eq((await data.dueCards(a.id)).counts.new, 3); // 2 (A) + 1 (B)
  eq((await data.dueCards(b.id)).counts.new, 1);
});

test('Données : session de révision complète', async () => {
  await resetDB();
  const a = await data.createDeck('A', null, 20);
  await data.createCards([1, 2, 3].map(i => ({ deckId: a.id, front: 'Q' + i, back: 'R' + i })));
  const s = await data.StudySession.create(a.id);
  let c = s.next();
  ok(c, 'une carte attendue');
  // « Bien » : la carte passe en apprentissage (10 min) et reste dans la session
  const u = await s.answer(c, 3);
  eq(u.state, 'learning');
  eq(s.learning.length, 1);
  // Les autres cartes passent avant
  ok(s.next().id !== c.id, 'les cartes non vues passent d\'abord');
  // « Facile » sur toutes les cartes restantes → fin
  let guard = 0;
  while ((c = s.next()) && guard++ < 20) await s.answer(c, 4);
  eq(s.next(), null);
  const cards = await db.getAll('cards');
  ok(cards.every(x => x.state === 'review'), 'toutes en révision');
  const reviews = await db.getAll('reviews');
  eq(reviews.length, 4);
  eq(reviews.filter(r => r.wasNew).length, 3);
  // Le lendemain : plus de nouvelles cartes, rien à réviser (intervalles ≥ 1 j... sauf demain)
  eq((await data.dueCards(a.id)).counts.new, 0);
});

test('Données : la limite du jour tient compte des cartes déjà vues', async () => {
  await resetDB();
  const a = await data.createDeck('A', null, 2);
  await data.createCards([1, 2, 3, 4].map(i => ({ deckId: a.id, front: 'Q' + i, back: 'R' })));
  const s = await data.StudySession.create(a.id);
  await s.answer(s.next(), 4);
  eq((await data.dueCards(a.id)).counts.new, 1);
});

test('Données : mode « cartes difficiles » ne change pas le planning', async () => {
  await resetDB();
  const a = await data.createDeck('A');
  const [c] = await data.createCards([{ deckId: a.id, front: 'Q', back: 'R' }]);
  const after = await data.recordAnswer(c, 1, 'practice');
  eq(after.state, 'new'); eq(after.fails, 1);
  const hard = await data.hardestCards(a.id);
  eq(hard.length, 1);
});

test('Données : import CSV crée l\'arborescence', async () => {
  await resetDB();
  const decks = await data.listDecks();
  const d1 = await data.ensureDeckPath('Histoire::XXe siècle', decks);
  const d2 = await data.ensureDeckPath('histoire::XXe siècle', decks); // même paquet
  eq(d1.id, d2.id);
  eq((await data.listDecks()).length, 2);
});

test('Données : suppression d\'un paquet en cascade', async () => {
  await resetDB();
  const a = await data.createDeck('A');
  const b = await data.createDeck('B', a.id);
  const img = await data.saveMedia('data:image/jpeg;base64,AAAA');
  await data.createCard({ deckId: b.id, front: 'Q', back: 'R', frontImg: img });
  await data.deleteDeck(a.id);
  eq((await db.getAll('decks')).length, 0);
  eq((await db.getAll('cards')).length, 0);
  eq((await db.getAll('media')).length, 0);
});

test('Sauvegarde : export / restauration (images comprises, sans la clé API)', async () => {
  await resetDB();
  await db.setSetting('apiKey', 'sk-ant-secret');
  const a = await data.createDeck('A');
  const img = await data.saveMedia('data:image/jpeg;base64,BBBB');
  await data.createCard({ deckId: a.id, front: 'Q', back: 'R', backImg: img });
  const backup = JSON.parse(JSON.stringify(await buildBackup()));
  ok(!JSON.stringify(backup).includes('sk-ant-secret'), 'la clé ne doit pas être dans la sauvegarde');
  validateBackup(backup);
  await resetDB();
  await db.setSetting('apiKey', 'sk-ant-autre');
  const r = await restoreBackup(backup);
  eq(r.cards, 1);
  eq((await db.getAll('media'))[0].data, 'data:image/jpeg;base64,BBBB');
  eq(await db.getSetting('apiKey'), 'sk-ant-autre'); // clé actuelle conservée
});
test('Sauvegarde : un fichier quelconque est refusé', () => {
  let threw = false;
  try { validateBackup({ hello: 1 }); } catch (e) { threw = true; }
  ok(threw);
});

test('Examen : QCM à 4 choix, bonne réponse présente', () => {
  const cards = [1, 2, 3, 4, 5].map(i => ({ front: 'Q' + i, back: 'R' + i }));
  const qs = buildQuestions(cards, 5);
  eq(qs.length, 5);
  for (const q of qs) {
    eq(q.choices.length, 4);
    eq(q.choices[q.answer], q.card.back);
    eq(new Set(q.choices).size, 4);
  }
  // Moins de 4 réponses différentes → auto-évaluation
  ok(buildQuestions(cards.slice(0, 2), 2).every(q => q.selfGrade));
});

test('Rappel calendrier : fichier .ics quotidien avec alarme', () => {
  const ics = makeICS('07:50', 'Test', 'https://exemple.github.io/app/');
  ok(ics.includes('RRULE:FREQ=DAILY'));
  ok(ics.includes('BEGIN:VALARM'));
  ok(/DTSTART:\d{8}T075000/.test(ics), 'heure de début');
  ok(/DTEND:\d{8}T080500/.test(ics), 'heure de fin (+15 min, passage à l\'heure suivante)');
});

// =====================================================================
// Client IA (fausses réponses : aucun appel réel, rien n'est facturé)
// =====================================================================
const realFetch = globalThis.fetch;
let lastRequest = null;
/** Remplace fetch par une fausse API qui renvoie les événements donnés. */
function mockAPI({ status = 200, events = [], error = null }) {
  globalThis.fetch = async (url, init) => {
    lastRequest = { url, init, body: JSON.parse(init.body) };
    if (status !== 200) {
      return new Response(JSON.stringify({ type: 'error', error }), { status, headers: { 'content-type': 'application/json' } });
    }
    const sse = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    // Découpe en petits morceaux pour tester la reconstitution du flux
    const bytes = new TextEncoder().encode(sse);
    const stream = new ReadableStream({
      start(ctrl) { for (let i = 0; i < bytes.length; i += 17) ctrl.enqueue(bytes.slice(i, i + 17)); ctrl.close(); },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}
function textEvents(text, stop = 'end_turn', index = 0) {
  return [
    { type: 'message_start', message: { id: 'msg_test', model: 'claude-opus-5-5' } },
    { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index, delta: { type: 'text_delta', text: text.slice(0, 5) } },
    { type: 'content_block_delta', index, delta: { type: 'text_delta', text: text.slice(5) } },
    { type: 'content_block_stop', index },
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
}

test('IA : requête correcte et réponse JSON reconstituée', async () => {
  await db.setSetting('apiKey', 'sk-ant-test');
  await db.setSetting('model', 'claude-opus-5-5');
  mockAPI({ events: textEvents('{"cards":[{"front":"Q","back":"R","notion":1}]}') });
  const res = await callClaude({ system: 's', content: 'c', schema: { type: 'object' } });
  eq(res.cards[0].front, 'Q');
  const h = lastRequest.init.headers;
  eq(h['anthropic-version'], '2026-10-21');
  eq(h['x-api-key'], 'sk-ant-test');
  eq(h['anthropic-dangerous-direct-browser-access'], 'true');
  eq(lastRequest.body.model, 'claude-opus-5-5');
  eq(lastRequest.body.stream, true);
  eq(lastRequest.body.fallbacks, 'default');
  eq(lastRequest.body.output_config.format.type, 'json_schema');
  ok(!('thinking' in lastRequest.body), 'thinking omis (adaptatif par défaut)');
});
test('IA : pas de « fallbacks » avec Haiku', async () => {
  await db.setSetting('model', 'claude-haiku-5-5');
  mockAPI({ events: textEvents('Bonjour') });
  eq(await callClaude({ system: 's', content: 'c' }), 'Bonjour');
  ok(!('fallbacks' in lastRequest.body));
  ok(!('anthropic-beta' in lastRequest.init.headers));
  await db.setSetting('model', 'claude-opus-5-5');
});
test('IA : le texte d\'un modèle qui a refusé est jeté (bloc fallback)', async () => {
  mockAPI({ events: [
    { type: 'message_start', message: { id: 'm' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '{"partiel' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'fallback' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '{"ok":true}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ] });
  eq(await callClaude({ system: 's', content: 'c', schema: { type: 'object' } }), { ok: true });
});
test('IA : clé invalide → message clair', async () => {
  mockAPI({ status: 401, error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  await rejects(callClaude({ system: 's', content: 'c' }), e => { ok(e instanceof AIError); eq(e.kind, 'invalid-key'); });
});
test('IA : crédit épuisé → message clair', async () => {
  mockAPI({ status: 400, error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } });
  await rejects(callClaude({ system: 's', content: 'c' }), e => eq(e.kind, 'quota'));
});
test('IA : refus de sécurité → message clair', async () => {
  mockAPI({ events: textEvents('', 'refusal') });
  await rejects(callClaude({ system: 's', content: 'c' }), e => eq(e.kind, 'refusal'));
});
test('IA : réponse coupée → message clair', async () => {
  mockAPI({ events: textEvents('{"cards":[', 'max_tokens') });
  await rejects(callClaude({ system: 's', content: 'c', schema: {} }), e => eq(e.kind, 'truncated'));
});
test('IA : pas de réseau → message clair', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await rejects(callClaude({ system: 's', content: 'c' }), e => eq(e.kind, 'network'));
});
test('IA : sans clé → message clair', async () => {
  await db.setSetting('apiKey', '');
  await rejects(callClaude({ system: 's', content: 'c' }), e => eq(e.kind, 'no-key'));
});

// =====================================================================
// Lancement
// =====================================================================
(async () => {
  const ul = document.getElementById('results');
  let pass = 0, fail = 0;
  for (const t of tests) {
    const li = document.createElement('li');
    try {
      await t.fn();
      pass++;
      li.className = 'pass';
      li.textContent = '✓ ' + t.name;
    } catch (e) {
      fail++;
      li.className = 'fail';
      li.innerHTML = `✗ ${esc(t.name)}<pre>${esc(e.stack || e.message || e)}</pre>`;
    }
    ul.appendChild(li);
  }
  globalThis.fetch = realFetch;
  await resetDB().catch(() => {});
  const sum = document.getElementById('summary');
  sum.textContent = fail ? `${fail} test(s) en échec sur ${tests.length}` : `Tous les tests passent (${pass}/${tests.length}) ✓`;
  sum.className = fail ? 'fail' : 'pass';
  window.__TEST_RESULT__ = { pass, fail, total: tests.length };
})();
