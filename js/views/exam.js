// =====================================================================
// views/exam.js — Mode examen : quiz chronométré sur un paquet.
// Les questions sont des QCM fabriqués à partir des cartes du paquet
// (les mauvaises réponses sont les versos d'autres cartes), sans IA et
// donc hors connexion. Le moteur de quiz (runQuiz) sert aussi au quiz IA.
// =====================================================================

import { listDecks, cardsOfDecks, descendantIds, recordAnswer, getMedia } from '../data.js';
import { explainErrors } from '../ai/prompts.js';
import { esc, shuffle, renderCardText, renderMarkdown } from '../utils.js';
import { $, go, icon, header, deckOptions, toast } from '../ui.js';

export async function render(el, params) {
  const decks = await listDecks();
  if (!decks.length) { go('/'); return; }
  const preset = params.deck && params.deck !== 'all' ? params.deck : decks[0].id;

  el.innerHTML = `
    ${header('Mode examen', { back: '/' })}
    <div class="page">
      <form id="exam-form" class="stack">
        <label class="field"><span>Paquet</span><select name="deck">${deckOptions(decks, preset)}</select></label>
        <label class="field"><span>Nombre de questions</span>
          <select name="count"><option>10</option><option selected>20</option><option>30</option><option>50</option><option value="0">Toutes</option></select>
        </label>
        <label class="field"><span>Temps total</span>
          <select name="time"><option value="300">5 minutes</option><option value="600" selected>10 minutes</option><option value="1200">20 minutes</option><option value="1800">30 minutes</option><option value="0">Sans limite</option></select>
        </label>
        <p class="hint">QCM à 4 choix créés à partir de tes cartes (fonctionne hors connexion). Le planning de révision n'est pas modifié.</p>
        <button class="btn btn-primary btn-block btn-big" type="submit">${icon('timer')} Commencer</button>
      </form>
    </div>`;

  $('#exam-form', el).onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const ids = descendantIds(f.deck.value, decks);
    const cards = (await cardsOfDecks(ids)).filter(c => c.front || c.frontImg);
    if (!cards.length) { toast('Ce paquet ne contient aucune carte', 'error'); return; }
    const count = Number(f.count.value) || cards.length;
    const questions = buildQuestions(cards, count);
    const deckName = decks.find(d => d.id === f.deck.value)?.name || '';
    cleanupQuiz = await runQuiz(el, { title: `Examen · ${deckName}`, questions, timeLimit: Number(f.time.value), backHref: `#/deck/${f.deck.value}` });
  };
  return () => cleanupQuiz && cleanupQuiz();
}
let cleanupQuiz = null;

/**
 * Fabrique des QCM à partir des cartes. Si le paquet a moins de 4
 * réponses différentes, la question devient « auto-évaluée ».
 */
export function buildQuestions(cards, count) {
  const picked = shuffle(cards).slice(0, count);
  const allBacks = [...new Set(cards.map(c => c.back.trim()).filter(Boolean))];
  return picked.map(card => {
    const right = card.back.trim();
    const others = shuffle(allBacks.filter(b => b !== right)).slice(0, 3);
    if (!right || others.length < 3) {
      return { question: card.front, card, selfGrade: true, correctText: card.back };
    }
    const choices = shuffle([right, ...others]);
    return { question: card.front, card, choices, answer: choices.indexOf(right), correctText: right };
  });
}

/**
 * Moteur de quiz.
 * questions : [{question, choices?, answer?, explanation?, card?, selfGrade?, correctText}]
 * timeLimit : secondes (0 = sans limite)
 */
export async function runQuiz(el, { title, questions, timeLimit = 0, backHref = '#/' }) {
  let i = 0;
  const results = []; // {q, ok, mine}
  let answered = false;
  const endAt = timeLimit ? Date.now() + timeLimit * 1000 : 0;
  let timer = null;
  let finished = false;

  const tick = () => {
    const t = $('#time-left', el);
    if (!endAt || !t) return;
    const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    t.classList.toggle('danger', left <= 30);
    if (left <= 0) finish(true);
  };
  if (endAt) timer = setInterval(tick, 500);

  const draw = async () => {
    if (finished) return;
    const q = questions[i];
    if (!q) return finish(false);
    const img = q.card ? await getMedia(q.card.frontImg) : null;
    el.innerHTML = `
      <header class="topbar study-top">
        <a class="icon-btn" href="${backHref}" aria-label="Quitter">${icon('close')}</a>
        <h1>${esc(title)}</h1>
        <div class="topbar-actions"><span class="timer" id="time-left">${endAt ? '' : '∞'}</span></div>
      </header>
      <div class="study">
        <div class="quiz-progress">Question ${i + 1} / ${questions.length}</div>
        <div class="flashcard"><div class="fc-front">${img ? `<img src="${img}" alt="">` : ''}<div class="fc-text">${renderCardText(q.question)}</div></div></div>
        <div id="quiz-zone" class="stack">
          ${q.selfGrade
            ? `<button class="btn btn-primary btn-block btn-big" id="reveal">Voir la réponse</button>`
            : q.choices.map((c, k) => `<button class="choice" data-k="${k}">${renderCardText(c)}</button>`).join('')}
        </div>
      </div>`;
    tick();
    answered = false;
    if (q.selfGrade) {
      $('#reveal', el).onclick = () => {
        $('#quiz-zone', el).innerHTML = `
          <div class="card-box"><div class="fc-text">${renderCardText(q.correctText)}</div></div>
          <div class="answer-btns two">
            <button class="ans ans-1" data-ok="0"><span class="ans-label">Faux</span></button>
            <button class="ans ans-3" data-ok="1"><span class="ans-label">Juste</span></button>
          </div>`;
        el.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => record(b.dataset.ok === '1', b.dataset.ok === '1' ? q.correctText : '(faux)'));
      };
    } else {
      el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
        if (answered) return;
        answered = true;
        const k = Number(b.dataset.k);
        const ok = k === q.answer;
        el.querySelectorAll('[data-k]').forEach(x => {
          const kk = Number(x.dataset.k);
          if (kk === q.answer) x.classList.add('right');
          else if (kk === k) x.classList.add('wrong');
          x.disabled = true;
        });
        const zone = $('#quiz-zone', el);
        if (q.explanation) zone.insertAdjacentHTML('beforeend', `<div class="explain ${ok ? 'ok' : 'ko'}">${renderCardText(q.explanation)}</div>`);
        zone.insertAdjacentHTML('beforeend', `<button class="btn btn-primary btn-block" id="next">Suivante</button>`);
        $('#next', el).onclick = () => record(ok, q.choices[k], true);
        if (navigator.vibrate) navigator.vibrate(ok ? 10 : [30, 40, 30]);
      });
    }
  };

  const record = async (ok, mine) => {
    const q = questions[i];
    results.push({ q, ok, mine });
    if (q.card) await recordAnswer(q.card, ok ? 3 : 1, 'exam');
    i++;
    draw();
  };

  const finish = async (timeUp) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    const score = results.filter(r => r.ok).length;
    const errors = results.filter(r => !r.ok);
    const unanswered = questions.length - results.length;
    const pct = questions.length ? Math.round((score / questions.length) * 100) : 0;
    el.innerHTML = `
      ${header('Résultat', { back: backHref.slice(1) })}
      <div class="page">
        <section class="card-box center">
          ${timeUp ? '<p class="danger">⏰ Temps écoulé !</p>' : ''}
          <div class="score">${score} / ${questions.length}</div>
          <p>${pct} % de bonnes réponses${unanswered ? ` · ${unanswered} sans réponse` : ''}</p>
        </section>
        ${errors.length ? `
          <h2 class="section-title">Mes erreurs</h2>
          <ul class="error-list">${errors.map(r => `
            <li><strong>${renderCardText(r.q.question)}</strong>
              <span class="right-answer">✔ ${renderCardText(r.q.correctText)}</span>
              ${r.mine && r.mine !== '(faux)' ? `<span class="wrong-answer">✘ ${renderCardText(r.mine)}</span>` : ''}
            </li>`).join('')}</ul>
          <button class="btn btn-primary btn-block" id="explain">${icon('ai')} Expliquer mes erreurs avec l'IA</button>
          <div id="explanation"></div>` : (results.length ? '<p class="center">Aucune erreur, parfait ! 🏆</p>' : '')}
        <a class="btn btn-block" href="${backHref}">Terminer</a>
      </div>`;
    const btn = $('#explain', el);
    if (btn) btn.onclick = async () => {
      btn.disabled = true;
      const out = $('#explanation', el);
      out.innerHTML = `<div class="loading"><span class="spinner"></span> L'IA prépare les explications…</div>`;
      try {
        const md = await explainErrors(errors.map(r => ({ question: r.q.question, correct: r.q.correctText, mine: r.mine === '(faux)' ? '' : r.mine })));
        out.innerHTML = `<article class="sheet-content card-box">${renderMarkdown(md)}</article>`;
        btn.remove();
      } catch (e) {
        out.innerHTML = `<div class="banner banner-error">${esc(e.message)}</div>`;
        btn.disabled = false;
      }
    };
  };

  await draw();
  return () => { finished = true; clearInterval(timer); };
}
