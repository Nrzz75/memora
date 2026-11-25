// =====================================================================
// views/ai.js — Assistant IA en plusieurs étapes
// ---------------------------------------------------------------------
//  Étape 1 « source »   : je colle un texte et/ou je prends des photos
//  Étape 2 « notions »  : l'IA liste TOUTES les notions ; je corrige
//  Étape 3 « génération » : cartes et/ou fiche, puis vérification auto
//  Étape 4 « aperçu »   : je modifie / retire des cartes, puis j'ajoute
//  (Quiz : étape 2 puis quiz QCM, avec explication de mes erreurs)
//
// Le brouillon est sauvegardé sur le téléphone après chaque étape payante :
// si l'app se ferme, on ne perd pas ce qui a déjà été généré.
// =====================================================================

import * as db from '../db.js';
import { listDecks, createDeck, createCards, cardsOfDecks, descendantIds } from '../data.js';
import { extractNotions, generateCards, generateSheet, verifyCoverage, completeSheet, quizFromCourse, quizFromCards } from '../ai/prompts.js';
import { runQuiz } from './exam.js';
import { compressImage, esc, uid, renderMarkdown, plural } from '../utils.js';
import { $, $$, go, toast, confirmDialog, header, icon, deckOptions } from '../ui.js';

const DRAFT_KEY = 'aiDraft';
let W = null;            // état de l'assistant (« wizard »)
let controller = null;   // pour annuler une génération en cours

function freshState(params = {}) {
  return {
    step: 'source',
    goal: 'both',            // 'cards' | 'sheet' | 'both' | 'quiz'
    density: 'standard',
    deckId: params.deck || localStorage.getItem('lastDeck') || '',
    newDeckName: '',
    quizSource: 'course',    // 'course' | 'deck'
    quizCount: 10,
    source: { text: '', images: [] },
    title: '',
    notions: [],
    warnings: [],
    cards: [],               // {id, front, back, notion}
    sheet: null,             // Markdown
    report: null,            // résultat de la vérification
    suggested: [],           // cartes proposées par la vérification
  };
}

async function saveDraft() {
  if (!W) return;
  await db.setSetting(DRAFT_KEY, { ...W, savedAt: Date.now() });
}
async function clearDraft() {
  await db.setSetting(DRAFT_KEY, null);
}

export async function render(el, params) {
  const draft = await db.getSetting(DRAFT_KEY);
  if (!W && draft && draft.step && draft.step !== 'source') {
    const ok = await confirmDialog("Tu as un travail IA non terminé. Veux-tu le reprendre ?", { okText: 'Reprendre', cancelText: 'Recommencer' });
    if (ok) W = draft; else { await clearDraft(); W = freshState(params); }
  }
  if (!W || params.reset) W = freshState(params);
  if (params.deck && W.step === 'source') W.deckId = params.deck;
  await draw(el);
  return () => { /* on garde W en mémoire pour revenir plus tard */ };
}

async function draw(el) {
  const apiKey = await db.getSetting('apiKey');
  if (!apiKey) {
    el.innerHTML = `
      ${header('Créer avec l\'IA')}
      <div class="page">
        <div class="card-box">
          <h2>Clé API nécessaire</h2>
          <p>Pour utiliser l'IA, colle d'abord ta clé API Claude dans les Réglages. L'explication pour l'obtenir s'y trouve (usage payant, quelques centimes par cours en général).</p>
          <a class="btn btn-primary btn-block" href="#/settings?section=ai">Aller aux Réglages</a>
        </div>
      </div>`;
    return;
  }
  const views = { source: drawSource, notions: drawNotions, preview: drawPreview };
  await (views[W.step] || drawSource)(el);
}

// ---------------------------------------------------------------------
// Étape 1 : la source
// ---------------------------------------------------------------------
async function drawSource(el) {
  const decks = await listDecks();
  const isQuiz = W.goal === 'quiz';
  el.innerHTML = `
    ${header('Créer avec l\'IA')}
    <div class="page">
      <div class="segmented" role="tablist">
        ${[['both', 'Cartes + fiche'], ['cards', 'Cartes'], ['sheet', 'Fiche'], ['quiz', 'Quiz']].map(([v, l]) =>
          `<button type="button" data-goal="${v}" class="${W.goal === v ? 'active' : ''}">${l}</button>`).join('')}
      </div>

      ${isQuiz ? `
        <div class="segmented small">
          <button type="button" data-qs="course" class="${W.quizSource === 'course' ? 'active' : ''}">Depuis un cours</button>
          <button type="button" data-qs="deck" class="${W.quizSource === 'deck' ? 'active' : ''}">Depuis un paquet</button>
        </div>` : ''}

      ${isQuiz && W.quizSource === 'deck' ? `
        <label class="field"><span>Paquet</span><select id="quiz-deck">${deckOptions(decks, W.deckId)}</select></label>
      ` : `
        <label class="field"><span>Ton cours (colle le texte)</span>
          <textarea id="src-text" rows="7" placeholder="Colle ici le texte de ton cours…">${esc(W.source.text)}</textarea>
        </label>
        <div class="field">
          <span>Et/ou des photos (cours, cahier, manuel)</span>
          <div class="img-tools">
            <button type="button" class="btn btn-small" id="take-photo">${icon('camera')} Prendre une photo</button>
            <button type="button" class="btn btn-small" id="pick-photo">${icon('image')} Importer</button>
            <input type="file" accept="image/*" capture="environment" id="cam" hidden>
            <input type="file" accept="image/*" multiple id="gallery" hidden>
          </div>
          <div class="thumbs" id="thumbs"></div>
          <small>Une photo par page, bien éclairée et nette. Jusqu'à 20 pages.</small>
        </div>
      `}

      ${isQuiz ? `
        <label class="field"><span>Nombre de questions</span>
          <select id="quiz-count">${[5, 10, 15, 20, 30].map(n => `<option ${n === W.quizCount ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>` : ''}

      ${W.goal === 'cards' || W.goal === 'both' ? `
        <label class="field"><span>Ajouter les cartes dans</span>
          <select id="target-deck">
            <option value="__new">➕ Nouveau paquet (nommé d'après le cours)</option>
            ${deckOptions(decks, W.deckId)}
          </select>
        </label>
        <label class="field"><span>Quantité de cartes</span>
          <select id="density">
            <option value="standard" ${W.density === 'standard' ? 'selected' : ''}>Standard (l'essentiel, ≥ 1 carte par notion)</option>
            <option value="detailed" ${W.density === 'detailed' ? 'selected' : ''}>Détaillé (plusieurs cartes par notion)</option>
          </select>
        </label>` : ''}

      <button class="btn btn-primary btn-block btn-big" id="go">${icon('ai')} ${isQuiz && W.quizSource === 'deck' ? 'Créer le quiz' : 'Lister les notions du cours'}</button>
      <p class="hint">${isQuiz && W.quizSource === 'deck' ? '' : "L'IA commence toujours par lister toutes les notions du cours : tu pourras corriger cette liste avant toute génération. "}Chaque appel utilise ta clé API (payant).</p>
    </div>`;

  // Choix de l'objectif
  $$('[data-goal]', el).forEach(b => b.onclick = () => { keepSource(el); W.goal = b.dataset.goal; drawSource(el); });
  $$('[data-qs]', el).forEach(b => b.onclick = () => { keepSource(el); W.quizSource = b.dataset.qs; drawSource(el); });

  // Photos
  const thumbs = $('#thumbs', el);
  const drawThumbs = () => {
    if (!thumbs) return;
    thumbs.innerHTML = W.source.images.map((src, i) => `
      <div class="thumb"><img src="${src}" alt="Page ${i + 1}"><span>${i + 1}</span>
        <button type="button" class="icon-btn img-remove" data-rm="${i}" aria-label="Retirer">${icon('close')}</button></div>`).join('');
    $$('[data-rm]', thumbs).forEach(b => b.onclick = () => { W.source.images.splice(Number(b.dataset.rm), 1); drawThumbs(); });
  };
  drawThumbs();
  const addFiles = async files => {
    for (const f of files) {
      if (W.source.images.length >= 20) { toast('20 photos maximum', 'error'); break; }
      try { W.source.images.push(await compressImage(f, 1600, 0.8)); } catch (e) { toast(e.message, 'error'); }
    }
    drawThumbs();
  };
  if ($('#take-photo', el)) {
    $('#take-photo', el).onclick = () => $('#cam', el).click();
    $('#pick-photo', el).onclick = () => $('#gallery', el).click();
    $('#cam', el).onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
    $('#gallery', el).onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  }

  $('#go', el).onclick = async () => {
    keepSource(el);
    if (W.goal === 'quiz' && W.quizSource === 'deck') return startDeckQuiz(el);
    if (!W.source.text.trim() && !W.source.images.length) { toast('Colle un texte ou ajoute une photo', 'error'); return; }
    const ok = await runStep(el, 'Lecture du cours et liste des notions…', async (signal, onProgress) => {
      const res = await extractNotions(W.source, { signal, onProgress });
      W.title = res.title || 'Cours';
      W.notions = (res.notions || []).map(n => ({ id: uid(), title: n.title, summary: n.summary }));
      W.warnings = res.warnings || [];
      W.step = 'notions';
      await saveDraft();
    });
    if (ok) draw(el); // affiche la liste des notions
  };
}

/** Recopie dans W ce qui a été saisi à l'étape 1. */
function keepSource(el) {
  const t = $('#src-text', el); if (t) W.source.text = t.value;
  const d = $('#target-deck', el); if (d) W.deckId = d.value;
  const q = $('#quiz-deck', el); if (q) W.deckId = q.value;
  const n = $('#density', el); if (n) W.density = n.value;
  const c = $('#quiz-count', el); if (c) W.quizCount = Number(c.value);
}

// ---------------------------------------------------------------------
// Étape 2 : liste des notions (modifiable)
// ---------------------------------------------------------------------
function drawNotions(el) {
  el.innerHTML = `
    ${header('Notions du cours', { actions: `<button class="icon-btn" id="restart" aria-label="Recommencer">${icon('close')}</button>` })}
    <div class="page">
      <label class="field"><span>Titre du cours</span><input id="title" type="text" value="${esc(W.title)}"></label>
      ${W.warnings.length ? `<div class="banner banner-warn"><span>⚠️ ${W.warnings.map(esc).join('<br>')}</span></div>` : ''}
      <p class="hint">Vérifie la liste : <b>ajoute</b> ce qui manque, <b>supprime</b> ce qui est inutile, <b>corrige</b> si besoin. La génération couvrira exactement ces ${W.notions.length} notions.</p>
      <ol class="notion-list" id="notions">
        ${W.notions.map((n, i) => `
          <li data-i="${i}">
            <div class="notion-head">
              <span class="notion-num">${i + 1}</span>
              <input class="n-title" type="text" value="${esc(n.title)}" aria-label="Titre de la notion">
              <button class="icon-btn small" data-del="${i}" aria-label="Supprimer la notion">${icon('trash')}</button>
            </div>
            <textarea class="n-summary" rows="2" aria-label="Ce qu'il faut retenir">${esc(n.summary)}</textarea>
          </li>`).join('')}
      </ol>
      <button class="btn btn-block" id="add-notion">${icon('plus')} Ajouter une notion</button>
      <button class="btn btn-primary btn-block btn-big" id="validate">${icon('check')} Valider et ${W.goal === 'quiz' ? 'créer le quiz' : 'générer'}</button>
    </div>`;

  const collect = () => {
    W.title = $('#title', el).value.trim() || W.title;
    $$('#notions li', el).forEach(li => {
      const n = W.notions[Number(li.dataset.i)];
      n.title = $('.n-title', li).value.trim();
      n.summary = $('.n-summary', li).value.trim();
    });
    W.notions = W.notions.filter(n => n.title || n.summary);
  };
  $$('[data-del]', el).forEach(b => b.onclick = () => { collect(); W.notions.splice(Number(b.dataset.del), 1); saveDraft(); drawNotions(el); });
  $('#add-notion', el).onclick = () => {
    collect();
    W.notions.push({ id: uid(), title: '', summary: '' });
    drawNotions(el);
    const last = $$('.n-title', el).pop(); last?.focus();
  };
  $('#restart', el).onclick = () => restart(el);
  $('#validate', el).onclick = async () => {
    collect();
    if (!W.notions.length) { toast('La liste est vide', 'error'); return; }
    await saveDraft();
    if (W.goal === 'quiz') return startCourseQuiz(el);
    await generateAll(el);
  };
}

// ---------------------------------------------------------------------
// Étape 3 : génération + vérification
// ---------------------------------------------------------------------
async function generateAll(el) {
  const wantCards = W.goal !== 'sheet';
  const wantSheet = W.goal !== 'cards';
  const steps = [];
  if (wantCards) steps.push('cards');
  if (wantSheet) steps.push('sheet');
  steps.push('verify');
  const label = { cards: 'Création des cartes', sheet: 'Rédaction de la fiche', verify: 'Vérification : chaque notion est-elle couverte ?' };

  for (const s of steps) {
    // Si l'étape est déjà faite (reprise d'un brouillon), on la saute
    if (s === 'cards' && W.cards.length) continue;
    if (s === 'sheet' && W.sheet) continue;
    const ok = await runStep(el, label[s], async (signal, onProgress) => {
      if (s === 'cards') {
        const res = await generateCards(W.source, W.notions, { density: W.density, signal, onProgress });
        W.cards = (res.cards || []).map(c => ({ id: uid(), front: c.front, back: c.back, notion: c.notion }));
      } else if (s === 'sheet') {
        W.sheet = await generateSheet(W.source, W.notions, { signal, onProgress });
      } else {
        await runVerification(signal, onProgress);
      }
      await saveDraft();
    }, steps.map(x => ({ label: label[x], done: (x === 'cards' && W.cards.length) || (x === 'sheet' && !!W.sheet) })));
    if (!ok) return; // erreur ou annulation : on reste sur l'écran actuel
  }
  W.step = 'preview';
  await saveDraft();
  draw(el);
}

/** Vérification : contrôle local (numéros de notions) + contrôle par l'IA. */
async function runVerification(signal, onProgress) {
  const res = await verifyCoverage(W.notions, W.goal === 'sheet' ? [] : W.cards, W.sheet, { signal, onProgress });
  const byNum = new Map((res.coverage || []).map(c => [c.notion, c]));
  const withCards = new Set(W.cards.map(c => c.notion));
  W.report = W.notions.map((n, i) => {
    const num = i + 1;
    const ai = byNum.get(num);
    // Une notion est couverte si : au moins une carte porte son numéro
    // (contrôle local) ET l'IA confirme que la carte permet de la réviser.
    const cardsOk = W.goal === 'sheet' || (withCards.has(num) && (ai ? ai.cards_ok : true));
    return {
      num, title: n.title,
      cardsOk,
      sheetOk: W.sheet ? (ai ? ai.sheet_ok : false) : true,
      comment: ai ? ai.comment : "Notion non vérifiée par l'IA",
    };
  });
  W.suggested = W.goal === 'sheet' ? [] : (res.missing_cards || []).map(c => ({ id: uid(), front: c.front, back: c.back, notion: c.notion }));
}

/**
 * Affiche un écran d'attente pendant un appel IA, avec bouton Annuler.
 * Renvoie true si tout s'est bien passé.
 */
async function runStep(el, label, fn, checklist = null) {
  controller = new AbortController();
  let chars = 0;
  el.innerHTML = `
    ${header('IA au travail')}
    <div class="page center">
      <div class="working">
        <span class="spinner big"></span>
        <h2>${esc(label)}</h2>
        ${checklist ? `<ul class="checklist">${checklist.map(c => `<li class="${c.done ? 'done' : c.label === label ? 'current' : ''}">${c.done ? '✓' : c.label === label ? '…' : '○'} ${esc(c.label)}</li>`).join('')}</ul>` : ''}
        <p class="muted" id="progress">Envoi au serveur…</p>
        <p class="hint">Cela peut prendre une à plusieurs minutes pour un long cours. Garde l'app ouverte.</p>
        <button class="btn" id="cancel">Annuler</button>
      </div>
    </div>`;
  $('#cancel', el).onclick = () => controller.abort();
  const onProgress = n => { chars = n; const p = $('#progress', el); if (p) p.textContent = `Réception… ${chars.toLocaleString('fr-FR')} caractères`; };
  try {
    await fn(controller.signal, onProgress);
    return true;
  } catch (e) {
    if (e.kind === 'aborted') toast('Annulé');
    await showError(el, e);
    return false;
  } finally {
    controller = null;
  }
}

async function showError(el, e) {
  const retry = W.step;
  el.innerHTML = `
    ${header('Créer avec l\'IA')}
    <div class="page">
      <div class="card-box error-box">
        <h2>${e.kind === 'aborted' ? 'Génération annulée' : 'Problème avec l\'IA'}</h2>
        <p>${esc(e.message || String(e))}</p>
        ${e.kind === 'invalid-key' || e.kind === 'no-key' || e.kind === 'quota' ? `<a class="btn btn-block" href="#/settings?section=ai">Ouvrir les Réglages</a>` : ''}
        <button class="btn btn-primary btn-block" id="back">Revenir</button>
        <p class="hint">Rien n'est perdu : ce qui a déjà été généré est gardé.</p>
      </div>
    </div>`;
  $('#back', el).onclick = () => { W.step = retry; draw(el); };
}

// ---------------------------------------------------------------------
// Étape 4 : aperçu, vérification et ajout
// ---------------------------------------------------------------------
async function drawPreview(el) {
  const decks = await listDecks();
  const wantCards = W.goal !== 'sheet';
  const missingCards = (W.report || []).filter(r => !r.cardsOk);
  const missingSheet = (W.report || []).filter(r => !r.sheetOk);
  const allOk = !missingCards.length && !missingSheet.length;

  el.innerHTML = `
    ${header('Aperçu', { actions: `<button class="icon-btn" id="restart" aria-label="Tout abandonner">${icon('trash')}</button>` })}
    <div class="page">
      <section class="card-box report ${allOk ? 'ok' : 'warn'}">
        <h2>${allOk ? `✓ Les ${W.notions.length} notions sont couvertes` : '⚠️ Vérification : des notions ne sont pas couvertes'}</h2>
        ${missingCards.length ? `<p><b>Sans carte :</b></p><ul>${missingCards.map(r => `<li>${r.num}. ${esc(r.title)}${r.comment ? ` — <span class="muted">${esc(r.comment)}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${W.suggested.length ? `<button class="btn btn-primary btn-block" id="add-suggested">${icon('plus')} Ajouter ${W.suggested.length > 1 ? `les ${W.suggested.length} cartes proposées` : 'la carte proposée'} pour combler</button>` : ''}
        ${missingSheet.length ? `<p><b>Absentes de la fiche :</b></p><ul>${missingSheet.map(r => `<li>${r.num}. ${esc(r.title)}</li>`).join('')}</ul>
          <button class="btn btn-block" id="complete-sheet">${icon('ai')} Compléter la fiche</button>` : ''}
        <button class="btn btn-ghost btn-small" id="reverify">Revérifier</button>
      </section>

      ${wantCards ? `
        <h2 class="section-title">${plural(W.cards.length, 'carte')}</h2>
        <p class="hint">Modifie directement le texte, ou retire une carte avec ✕.</p>
        <ul class="preview-cards" id="pcards">
          ${W.cards.map((c, i) => `
            <li data-i="${i}">
              <div class="pc-head"><span class="tag">Notion ${c.notion}${W.notions[c.notion - 1] ? ' · ' + esc(W.notions[c.notion - 1].title) : ''}</span>
                <button class="icon-btn small" data-rm="${i}" aria-label="Retirer la carte">${icon('close')}</button></div>
              <textarea class="pc-front" rows="2" aria-label="Recto">${esc(c.front)}</textarea>
              <textarea class="pc-back" rows="2" aria-label="Verso">${esc(c.back)}</textarea>
            </li>`).join('')}
        </ul>
        <label class="field"><span>Paquet de destination</span>
          <select id="dest">
            <option value="__new" ${!decks.some(d => d.id === W.deckId) ? 'selected' : ''}>➕ Nouveau paquet : « ${esc(W.title)} »</option>
            ${deckOptions(decks, W.deckId)}
          </select>
        </label>` : ''}

      ${W.sheet ? `
        <h2 class="section-title">Fiche de révision</h2>
        <div class="segmented small"><button type="button" class="active" id="sheet-view">Aperçu</button><button type="button" id="sheet-edit">Modifier</button></div>
        <article class="sheet-content card-box" id="sheet-box">${renderMarkdown(W.sheet)}</article>` : ''}

      <button class="btn btn-primary btn-block btn-big" id="save">${icon('check')} ${wantCards ? `Ajouter ${plural(W.cards.length, 'carte')}${W.sheet ? ' et la fiche' : ''}` : 'Enregistrer la fiche'}</button>
    </div>`;

  // Recopie les modifications des cartes
  const collect = () => {
    $$('#pcards li', el).forEach(li => {
      const c = W.cards[Number(li.dataset.i)];
      c.front = $('.pc-front', li).value.trim();
      c.back = $('.pc-back', li).value.trim();
    });
    const sb = $('#sheet-text', el); if (sb) W.sheet = sb.value;
    const d = $('#dest', el); if (d) W.deckId = d.value;
  };
  $$('[data-rm]', el).forEach(b => b.onclick = () => { collect(); W.cards.splice(Number(b.dataset.rm), 1); saveDraft(); drawPreview(el); });
  $('#restart', el).onclick = () => restart(el);

  const addS = $('#add-suggested', el);
  if (addS) addS.onclick = () => {
    collect();
    W.cards.push(...W.suggested);
    const added = new Set(W.suggested.map(c => c.notion));
    W.report = W.report.map(r => added.has(r.num) ? { ...r, cardsOk: true, comment: '' } : r);
    W.suggested = [];
    saveDraft();
    toast('Cartes ajoutées à l\'aperçu', 'success');
    drawPreview(el);
  };
  const comp = $('#complete-sheet', el);
  if (comp) comp.onclick = async () => {
    collect();
    const missing = missingSheet.map(r => W.notions[r.num - 1]).filter(Boolean);
    const ok = await runStep(el, 'Complément de la fiche…', async (signal, onProgress) => {
      const extra = await completeSheet(W.source, missing, { signal, onProgress });
      W.sheet = W.sheet.trimEnd() + '\n\n' + extra;
      W.report = W.report.map(r => ({ ...r, sheetOk: true }));
      await saveDraft();
    });
    if (ok) drawPreview(el);
  };
  $('#reverify', el).onclick = async () => {
    collect();
    const ok = await runStep(el, 'Vérification…', async (signal, onProgress) => { await runVerification(signal, onProgress); await saveDraft(); });
    if (ok) drawPreview(el);
  };

  // Aperçu / modification de la fiche
  const sv = $('#sheet-view', el), se = $('#sheet-edit', el);
  if (se) {
    se.onclick = () => {
      se.classList.add('active'); sv.classList.remove('active');
      $('#sheet-box', el).innerHTML = `<textarea id="sheet-text" rows="18" class="mono">${esc(W.sheet)}</textarea>`;
    };
    sv.onclick = () => {
      collect();
      sv.classList.add('active'); se.classList.remove('active');
      $('#sheet-box', el).innerHTML = renderMarkdown(W.sheet);
    };
  }

  $('#save', el).onclick = async () => {
    collect();
    const btn = $('#save', el);
    btn.disabled = true;
    try {
      const result = await saveAll(decks);
      await clearDraft();
      W = null;
      toast(result.message, 'success', 3500);
      go(result.href);
    } catch (e) {
      btn.disabled = false;
      toast("Erreur lors de l'enregistrement : " + e.message, 'error');
    }
  };
}

/** Enregistre la fiche et les cartes (liées entre elles). */
async function saveAll(decks) {
  const wantCards = W.goal !== 'sheet';
  const cards = W.cards.filter(c => c.front && c.back);
  let deckId = W.deckId;
  if (wantCards && (!deckId || deckId === '__new' || !decks.some(d => d.id === deckId))) {
    deckId = (await createDeck(W.title || 'Cours')).id;
  }
  if (wantCards) localStorage.setItem('lastDeck', deckId);
  let sheetId = null;
  if (W.sheet) {
    sheetId = uid();
    await db.put('sheets', {
      id: sheetId,
      title: W.title || 'Fiche',
      content: W.sheet,
      deckId: wantCards ? deckId : null,
      notions: W.notions.map(n => ({ title: n.title, summary: n.summary })),
      cardIds: [],
      createdAt: Date.now(),
    });
  }
  let created = [];
  if (wantCards && cards.length) {
    created = await createCards(cards.map(c => ({ deckId, front: c.front, back: c.back, sheetId })));
  }
  if (sheetId) {
    const s = await db.get('sheets', sheetId);
    s.cardIds = created.map(c => c.id);
    await db.put('sheets', s);
  }
  if (wantCards) return { message: `${plural(created.length, 'carte ajoutée', 'cartes ajoutées')}${sheetId ? ' + fiche' : ''}`, href: `/deck/${deckId}` };
  return { message: 'Fiche enregistrée', href: `/sheet/${sheetId}` };
}

async function restart(el) {
  if (!await confirmDialog('Abandonner ce travail ? Ce qui a été généré sera perdu.', { okText: 'Abandonner', danger: true })) return;
  await clearDraft();
  W = freshState();
  draw(el);
}

// ---------------------------------------------------------------------
// Quiz IA
// ---------------------------------------------------------------------
async function startCourseQuiz(el) {
  let questions = null;
  const ok = await runStep(el, 'Création du quiz…', async (signal, onProgress) => {
    const res = await quizFromCourse(W.source, W.notions, W.quizCount, { signal, onProgress });
    questions = normalizeQuiz(res.questions);
  });
  if (!ok) return;
  W.step = 'source';
  await clearDraft();
  await runQuiz(el, { title: `Quiz · ${W.title}`, questions, timeLimit: 0, backHref: '#/ai' });
}

async function startDeckQuiz(el) {
  const decks = await listDecks();
  if (!W.deckId || !decks.some(d => d.id === W.deckId)) { toast('Choisis un paquet', 'error'); return; }
  const cards = (await cardsOfDecks(descendantIds(W.deckId, decks))).filter(c => c.front && c.back);
  if (!cards.length) { toast('Ce paquet ne contient pas de cartes texte', 'error'); return; }
  let questions = null;
  const ok = await runStep(el, 'Création du quiz…', async (signal, onProgress) => {
    // On envoie au plus 300 cartes (les plus ratées en premier)
    const sample = cards.sort((a, b) => (b.fails || 0) - (a.fails || 0)).slice(0, 300);
    const res = await quizFromCards(sample, W.quizCount, { signal, onProgress });
    questions = normalizeQuiz(res.questions);
  });
  if (!ok) return;
  const name = decks.find(d => d.id === W.deckId)?.name || '';
  await runQuiz(el, { title: `Quiz · ${name}`, questions, timeLimit: 0, backHref: '#/ai' });
}

/** Sécurise les questions reçues (4 choix, index valide). */
function normalizeQuiz(list = []) {
  return list
    .filter(q => q.question && Array.isArray(q.choices) && q.choices.length >= 2)
    .map(q => {
      const answer = Math.min(Math.max(0, q.answer | 0), q.choices.length - 1);
      return { question: q.question, choices: q.choices, answer, explanation: q.explanation, correctText: q.choices[answer] };
    });
}
