// =====================================================================
// utils.js — Petites fonctions utiles partout dans l'app
// =====================================================================

/** Identifiant unique (ex. « k3j9x2… »). */
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------- Dates ----------
// Comme Anki, la « journée » commence à 4 h du matin : réviser à 1 h du
// matin compte encore pour la veille.
export const DAY_START_HOUR = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Clé du jour « AAAA-MM-JJ » pour un horodatage. */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts - DAY_START_HOUR * 3600 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

/** Horodatage de la fin de la journée en cours (demain à 4 h). */
export function endOfToday(now = Date.now()) {
  const d = new Date(now - DAY_START_HOUR * 3600 * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + DAY_MS + DAY_START_HOUR * 3600 * 1000;
}

/** Ajoute n jours à une clé de jour. */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Date lisible : « 25 nov. 2026 ». */
export function formatDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- Texte ----------
/** Protège le texte avant de l'insérer dans la page (anti-injection HTML). */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Mise en forme simple dans une ligne : **gras**, *italique*, `code`. */
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>');
}

/** Texte de carte → HTML (retours à la ligne + mise en forme simple). */
export function renderCardText(text) {
  return inline(esc(text)).replace(/\n/g, '<br>');
}

/**
 * Mini-convertisseur Markdown → HTML pour les fiches.
 * Gère : titres (#), listes (- ou 1.), tableaux (| a | b |), citations (>),
 * séparateurs (---), paragraphes, gras/italique/code.
 * Le texte est d'abord protégé (esc) : aucun HTML externe n'est exécuté.
 */
export function renderMarkdown(md) {
  const lines = esc(md || '').split(/\r?\n/);
  const out = [];
  let list = null;   // 'ul' ou 'ol'
  let para = [];
  let table = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r));
    const cells = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => inline(c.trim()));
    let html = '<div class="table-wrap"><table>';
    rows.forEach((r, i) => {
      const tag = i === 0 ? 'th' : 'td';
      html += '<tr>' + cells(r).map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
    });
    out.push(html + '</table></div>');
    table = null;
  };
  const flushAll = () => { flushPara(); flushList(); flushTable(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); (table ||= []).push(line); continue; }
    flushTable();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushAll();
      const lvl = Math.min(4, m[1].length + 1); // # → h2 (h1 = titre de la fiche)
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushAll(); out.push('<hr>');
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
      flushAll(); out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else {
      flushList(); para.push(line);
    }
  }
  flushAll();
  return out.join('\n');
}

// ---------- Images ----------
/**
 * Compresse une photo avant stockage : redimensionnée (1280 px max) et
 * convertie en JPEG. Renvoie une data URL (texte « data:image/jpeg;base64,… »).
 */
export async function compressImage(file, maxSize = 1280, quality = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Impossible de lire l'image."));
      i.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';           // fond blanc (pour les PNG transparents)
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Fichiers ----------
/**
 * Enregistre un fichier : sur téléphone on ouvre le menu « Partager »
 * (pour l'envoyer dans Fichiers, Drive, mail…), sinon téléchargement.
 */
export async function saveFile(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const file = new File([blob], filename, { type: mime });
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // sinon on tente le téléchargement classique
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return 'downloaded';
}

/** Lit un fichier choisi par l'utilisateur en texte. */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Mélange un tableau (copie). */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pluriel simple : plural(3, 'carte') → « 3 cartes ». */
export function plural(n, word, pluralWord) {
  return `${n} ${n > 1 ? (pluralWord || word + 's') : word}`;
}
