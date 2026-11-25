// =====================================================================
// csv.js — Import / export des cartes au format CSV (tableur)
// ---------------------------------------------------------------------
// Format exporté (ouvrable dans Excel, LibreOffice, Google Sheets) :
//   paquet;recto;verso
//   Histoire::XXe siècle;Date de l'armistice ?;11 novembre 1918
// À l'import, le séparateur (; , ou tabulation) est détecté tout seul.
// La colonne « paquet » est facultative.
// =====================================================================

/** Découpe un texte CSV en lignes de cellules (gère les "guillemets"). */
export function parseCSV(text, delimiter = null) {
  text = text.replace(/^﻿/, ''); // retire le BOM éventuel
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }   // "" = guillemet
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Devine le séparateur en regardant la première ligne. */
export function detectDelimiter(text) {
  const first = text.split(/\r?\n/)[0] || '';
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let inQ = false;
  for (const ch of first) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ';';
}

/**
 * Transforme les lignes CSV en cartes {deckPath, front, back}.
 * Reconnaît un en-tête (paquet/recto/verso, deck/front/back…).
 */
export function rowsToCards(rows) {
  if (!rows.length) return [];
  const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const head = rows[0].map(norm);
  const find = names => head.findIndex(h => names.includes(h));
  let iDeck = find(['paquet', 'deck', 'paquets']);
  let iFront = find(['recto', 'front', 'question', 'devant']);
  let iBack = find(['verso', 'back', 'reponse', 'answer', 'derriere']);
  let data = rows;
  if (iFront >= 0 && iBack >= 0) {
    data = rows.slice(1);            // il y a un en-tête
  } else if (rows[0].length >= 3) {
    iDeck = 0; iFront = 1; iBack = 2;  // pas d'en-tête : paquet;recto;verso
  } else {
    iDeck = -1; iFront = 0; iBack = 1; // pas d'en-tête : recto;verso
  }
  return data
    .map(r => ({
      deckPath: iDeck >= 0 ? (r[iDeck] || '').trim() : '',
      front: (r[iFront] || '').trim(),
      back: (r[iBack] || '').trim(),
    }))
    .filter(c => c.front || c.back);
}

/** Protège une cellule pour l'export. */
function cell(v, delim) {
  const s = String(v ?? '');
  return /["\n\r]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Cartes → texte CSV. rows = [{deckPath, front, back}] */
export function toCSV(rows, delim = ';') {
  const lines = [['paquet', 'recto', 'verso'].join(delim)];
  for (const r of rows) lines.push([r.deckPath, r.front, r.back].map(v => cell(v, delim)).join(delim));
  return '﻿' + lines.join('\r\n'); // BOM : Excel lit bien les accents
}
