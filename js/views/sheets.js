// =====================================================================
// views/sheets.js — Section « Fiches » : liste, lecture, modification,
// export PDF (via l'impression du téléphone → « Enregistrer en PDF »).
// =====================================================================

import * as db from '../db.js';
import { listDecks, deckPath } from '../data.js';
import { esc, formatDate, renderMarkdown, plural, saveFile } from '../utils.js';
import { $, go, toast, confirmDialog, header, icon, empty } from '../ui.js';
import { APP_NAME } from '../config.js';

export async function renderList(el) {
  const sheets = (await db.getAll('sheets')).sort((a, b) => b.createdAt - a.createdAt);
  const decks = await listDecks();
  el.innerHTML = `
    ${header('Fiches')}
    <div class="page">
      ${sheets.length ? `<ul class="sheet-list">${sheets.map(s => `
        <li><a href="#/sheet/${esc(s.id)}">
          <strong>${esc(s.title)}</strong>
          <span class="muted small">${formatDate(s.createdAt)}${s.deckId && decks.some(d => d.id === s.deckId) ? ' · ' + esc(deckPath(s.deckId, decks)) : ''} · ${plural(s.cardIds?.length || 0, 'carte liée', 'cartes liées')}</span>
        </a></li>`).join('')}</ul>`
        : empty("Aucune fiche pour l'instant. L'IA peut rédiger une fiche de révision complète à partir de ton cours.", `<a class="btn btn-primary" href="#/ai">${icon('ai')} Créer une fiche</a>`)}
    </div>`;
}

export async function renderDetail(el, params) {
  const sheet = await db.get('sheets', params.id);
  if (!sheet) { go('/sheets'); return; }
  const decks = await listDecks();
  const deck = decks.find(d => d.id === sheet.deckId);
  const cards = await db.getAll('cards');
  const linked = cards.filter(c => c.sheetId === sheet.id).length;
  let editing = false;
  // Le titre est déjà affiché en haut : on retire un éventuel « # Titre » en tête du texte
  const body = () => sheet.content.replace(/^\s*#\s+[^\n]*\n/, '');

  const draw = () => {
    el.innerHTML = `
      ${header('Fiche', { back: '/sheets', actions: `<button class="icon-btn" id="edit" aria-label="Modifier">${icon(editing ? 'check' : 'edit')}</button>` })}
      <div class="page">
        <div class="print-area">
          <h1 class="sheet-title">${esc(sheet.title)}</h1>
          <p class="muted small no-print">${formatDate(sheet.createdAt)}${deck ? ' · ' + esc(deckPath(deck.id, decks)) : ''}</p>
          ${editing
            ? `<label class="field"><span>Titre</span><input id="s-title" type="text" value="${esc(sheet.title)}"></label>
               <textarea id="s-content" rows="22" class="mono">${esc(sheet.content)}</textarea>`
            : `<article class="sheet-content">${renderMarkdown(body())}</article>`}
        </div>
        ${!editing ? `
          <div class="stack no-print">
            ${deck && linked ? `<a class="btn btn-primary btn-block" href="#/study/${esc(deck.id)}">${icon('play')} Réviser les ${linked} cartes liées</a>` : ''}
            <button class="btn btn-block" id="pdf">${icon('download')} Exporter en PDF</button>
            <button class="btn btn-block" id="html">${icon('download')} Télécharger (page web)</button>
            ${sheet.notions?.length ? `<details class="card-box"><summary>Liste des ${sheet.notions.length} notions</summary><ol>${sheet.notions.map(n => `<li><b>${esc(n.title)}</b> — ${esc(n.summary)}</li>`).join('')}</ol></details>` : ''}
            <button class="btn btn-danger btn-block" id="delete">${icon('trash')} Supprimer la fiche</button>
          </div>` : ''}
      </div>`;

    $('#edit', el).onclick = async () => {
      if (editing) {
        sheet.title = $('#s-title', el).value.trim() || sheet.title;
        sheet.content = $('#s-content', el).value;
        await db.put('sheets', sheet);
        toast('Fiche enregistrée', 'success');
      }
      editing = !editing;
      draw();
    };
    if (editing) return;

    $('#pdf', el).onclick = () => {
      // Le nom du PDF reprend le titre de la page
      const old = document.title;
      document.title = sheet.title;
      window.print();
      setTimeout(() => { document.title = old; }, 1000);
    };
    $('#html', el).onclick = () => {
      const css = `body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1d1d1f}
        h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4rem;text-align:left}
        th{background:#f2f2f5}mark{background:#ffe58a}blockquote{border-left:4px solid #ccc;margin:0;padding-left:1rem;color:#555}`;
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(sheet.title)}</title><style>${css}</style></head><body><h1>${esc(sheet.title)}</h1>${renderMarkdown(body())}<p style="color:#888;font-size:.8rem">Fiche créée avec ${esc(APP_NAME)}</p></body></html>`;
      saveFile(`${sheet.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'fiche'}.html`, html, 'text/html');
    };
    $('#delete', el).onclick = async () => {
      if (!await confirmDialog(`Supprimer la fiche « ${sheet.title} » ?\nLes cartes liées sont conservées.`, { okText: 'Supprimer', danger: true })) return;
      await db.del('sheets', sheet.id);
      toast('Fiche supprimée');
      go('/sheets');
    };
  };
  draw();
}
