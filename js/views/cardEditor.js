// =====================================================================
// views/cardEditor.js — Formulaire rapide pour créer / modifier une carte
// (texte + image au recto et/ou au verso).
// =====================================================================

import * as db from '../db.js';
import { listDecks, createCard, updateCard, deleteCard, saveMedia, getMedia, deleteMedia, resetCard } from '../data.js';
import { compressImage, esc, formatDate } from '../utils.js';
import { $, go, toast, confirmDialog, header, icon, deckOptions, empty } from '../ui.js';

export async function render(el, params) {
  const decks = await listDecks();
  if (!decks.length) {
    el.innerHTML = `${header('Nouvelle carte', { back: '/decks' })}<div class="page">${empty("Crée d'abord un paquet pour y ranger tes cartes.", `<a class="btn btn-primary" href="#/deck/new">${icon('plus')} Créer un paquet</a>`)}</div>`;
    return;
  }
  const card = params.id ? await db.get('cards', params.id) : null;
  if (params.id && !card) { go('/decks'); return; }
  const lastDeck = localStorage.getItem('lastDeck');
  const deckId = card?.deckId || params.deck || (decks.some(d => d.id === lastDeck) ? lastDeck : decks[0].id);

  // Images : on garde la data URL en mémoire tant que la carte n'est pas enregistrée
  const imgs = {
    front: card?.frontImg ? await getMedia(card.frontImg) : null,
    back: card?.backImg ? await getMedia(card.backImg) : null,
  };
  const imgChanged = { front: false, back: false };

  el.innerHTML = `
    ${header(card ? 'Modifier la carte' : 'Nouvelle carte', { back: `/deck/${deckId}` })}
    <div class="page">
      <form id="card-form" class="stack">
        <label class="field"><span>Paquet</span>
          <select name="deckId">${deckOptions(decks, deckId)}</select>
        </label>
        ${side('front', 'Recto (question)', card?.front)}
        ${side('back', 'Verso (réponse)', card?.back)}
        <p class="hint">Mise en forme : **gras**, *italique*, ==surligné==.</p>
        <button class="btn btn-primary btn-block btn-big" type="submit">${card ? 'Enregistrer' : 'Ajouter la carte'}</button>
        ${card ? '' : '<p class="hint center">La carte est ajoutée et le formulaire se vide pour la suivante.</p>'}
        ${card ? `
          <div class="card-meta muted small">
            Créée le ${formatDate(card.createdAt)} · ${card.seen || 0} réponse(s) · ${card.fails || 0} oubli(s)
            ${card.state === 'review' ? ` · prochain passage : ${formatDate(card.due)}` : ''}
          </div>
          <div class="grid-2">
            <button class="btn btn-block" type="button" id="reset">Remettre à zéro</button>
            <button class="btn btn-danger btn-block" type="button" id="delete">${icon('trash')} Supprimer</button>
          </div>` : ''}
      </form>
    </div>`;

  const form = $('#card-form', el);
  if (!card) form.front.focus();

  // --- Gestion des images ---
  for (const s of ['front', 'back']) {
    const input = $(`#file-${s}`, el);
    const cam = $(`#cam-${s}`, el);
    $(`[data-pick="${s}"]`, el).onclick = () => input.click();
    $(`[data-cam="${s}"]`, el).onclick = () => cam.click();
    const onFile = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        imgs[s] = await compressImage(file);
        imgChanged[s] = true;
        drawImg(s);
      } catch (err) {
        toast(err.message, 'error');
      }
      e.target.value = '';
    };
    input.onchange = onFile;
    cam.onchange = onFile;
    drawImg(s);
  }
  function drawImg(s) {
    const box = $(`#img-${s}`, el);
    box.innerHTML = imgs[s]
      ? `<img src="${imgs[s]}" alt=""><button type="button" class="icon-btn img-remove" aria-label="Retirer l'image">${icon('close')}</button>`
      : '';
    const rm = box.querySelector('.img-remove');
    if (rm) rm.onclick = () => { imgs[s] = null; imgChanged[s] = true; drawImg(s); };
  }

  // --- Enregistrement ---
  form.onsubmit = async e => {
    e.preventDefault();
    const front = form.front.value.trim();
    const back = form.back.value.trim();
    if (!front && !imgs.front) { toast('Le recto est vide', 'error'); form.front.focus(); return; }
    const deck = form.deckId.value;
    localStorage.setItem('lastDeck', deck);

    // Enregistre les images modifiées (et supprime les anciennes)
    const saveImg = async (s, oldId) => {
      if (!imgChanged[s]) return oldId || null;
      if (oldId) await deleteMedia(oldId);
      return imgs[s] ? saveMedia(imgs[s]) : null;
    };
    if (card) {
      const updated = {
        ...card, deckId: deck, front, back,
        frontImg: await saveImg('front', card.frontImg),
        backImg: await saveImg('back', card.backImg),
      };
      await updateCard(updated);
      toast('Carte enregistrée', 'success');
      history.back();
    } else {
      await createCard({
        deckId: deck, front, back,
        frontImg: await saveImg('front', null),
        backImg: await saveImg('back', null),
      });
      toast('Carte ajoutée ✓', 'success', 1500);
      // Formulaire vidé pour enchaîner rapidement
      form.front.value = '';
      form.back.value = '';
      imgs.front = imgs.back = null;
      imgChanged.front = imgChanged.back = false;
      drawImg('front'); drawImg('back');
      form.front.focus();
    }
  };

  if (card) {
    $('#delete', el).onclick = async () => {
      if (!await confirmDialog('Supprimer définitivement cette carte ?', { okText: 'Supprimer', danger: true })) return;
      await deleteCard(card);
      toast('Carte supprimée');
      go(`/deck/${card.deckId}`);
    };
    $('#reset', el).onclick = async () => {
      if (!await confirmDialog('Remettre cette carte à zéro ? Elle redeviendra une « nouvelle » carte.', { okText: 'Remettre à zéro' })) return;
      await updateCard(resetCard(card));
      toast('Carte remise à zéro');
      go(`/deck/${card.deckId}`);
    };
  }
}

function side(s, label, value = '') {
  return `
    <div class="field">
      <span>${label}</span>
      <textarea name="${s}" rows="3" placeholder="${s === 'front' ? 'ex. En quelle année a eu lieu l\'armistice ?' : 'ex. 1918 (11 novembre)'}">${esc(value || '')}</textarea>
      <div class="img-tools">
        <button type="button" class="btn btn-small btn-ghost" data-cam="${s}">${icon('camera')} Photo</button>
        <button type="button" class="btn btn-small btn-ghost" data-pick="${s}">${icon('image')} Image</button>
        <input type="file" accept="image/*" capture="environment" id="cam-${s}" hidden>
        <input type="file" accept="image/*" id="file-${s}" hidden>
      </div>
      <div class="img-preview" id="img-${s}"></div>
    </div>`;
}
