// =====================================================================
// views/settings.js — Réglages : objectif, IA (clé API), rappels,
// données (CSV, sauvegarde / restauration), à propos.
// =====================================================================

import * as db from '../db.js';
import { listDecks, descendantIds, deckPath, ensureDeckPath, createCards } from '../data.js';
import { parseCSV, rowsToCards, toCSV } from '../csv.js';
import { exportBackupJSON, restoreBackup } from '../backup.js';
import { MODELS, testKey } from '../ai/claude.js';
import {
  capabilities, askNotificationPermission, registerPeriodicSync, unregisterPeriodicSync,
  showNotification, makeICS,
} from '../reminders.js';
import { esc, formatDate, saveFile, readFileText, plural } from '../utils.js';
import { $, toast, confirmDialog, alertDialog, header, icon, deckOptions } from '../ui.js';
import { APP_NAME, APP_VERSION } from '../config.js';

export async function render(el, params) {
  const s = await db.getAllSettings();
  const decks = await listDecks();
  const cap = await capabilities();
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;

  el.innerHTML = `
    ${header('Réglages', { back: '/' })}
    <div class="page settings">

      <section class="card-box" id="sec-goal">
        <h2>Objectif et révisions</h2>
        <label class="field"><span>Objectif quotidien (nombre de réponses)</span>
          <input id="goal" type="number" min="1" max="2000" inputmode="numeric" value="${s.dailyGoal}"></label>
        <label class="field"><span>Nouvelles cartes par jour (valeur par défaut des nouveaux paquets)</span>
          <input id="newpd" type="number" min="0" max="9999" inputmode="numeric" value="${s.defaultNewPerDay}"></label>
        <small class="muted">Chaque paquet a son propre réglage (bouton ✎ dans le paquet).</small>
      </section>

      <section class="card-box" id="sec-ai">
        <h2>Intelligence artificielle</h2>
        <details ${s.apiKey ? '' : 'open'}>
          <summary>Comment obtenir ma clé API Claude ?</summary>
          <ol class="howto">
            <li>Va sur <b>console.anthropic.com</b> et crée un compte (e-mail).</li>
            <li>Dans <b>Billing</b> (Facturation), ajoute un moyen de paiement et un peu de crédit (par ex. 5 $).</li>
            <li>Dans <b>API Keys</b>, clique sur <b>Create Key</b>, donne-lui un nom, puis <b>copie</b> la clé (elle commence par <code>sk-ant-</code>). Elle ne s'affiche qu'une fois.</li>
            <li>Colle-la ci-dessous puis touche « Tester ».</li>
          </ol>
          <p class="banner banner-warn"><span><b>L'usage est payant</b>, facturé par Anthropic selon la quantité de texte traitée. En général quelques centimes à quelques dizaines de centimes par cours. Fixe une limite de dépense dans la console (Limits) pour être tranquille.</span></p>
          <p class="muted small">La clé est enregistrée uniquement sur ce téléphone (jamais dans les sauvegardes). Toute personne ayant accès à ton téléphone déverrouillé pourrait la voir : en cas de doute, supprime-la dans la console Anthropic et crées-en une autre.</p>
        </details>
        <label class="field"><span>Clé API</span>
          <div class="input-row">
            <input id="apikey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(s.apiKey)}">
            <button class="btn btn-small" id="showkey" type="button">Voir</button>
          </div>
        </label>
        <label class="field"><span>Modèle</span>
          <select id="model">${MODELS.map(m => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
          <small class="muted" id="model-price"></small>
        </label>
        <div class="grid-2">
          <button class="btn btn-primary btn-block" id="savekey">Enregistrer et tester</button>
          <button class="btn btn-block" id="delkey">Effacer la clé</button>
        </div>
        <p id="key-status" class="small"></p>
      </section>

      <section class="card-box" id="sec-reminders">
        <h2>Rappels</h2>
        <label class="switch-row"><span>Me rappeler de réviser</span><input id="rem-on" type="checkbox" ${s.remindersOn ? 'checked' : ''}></label>
        <label class="field"><span>Heure du rappel</span><input id="rem-time" type="time" value="${esc(s.reminderTime)}"></label>
        ${reminderHelp(cap)}
        <div class="stack">
          <button class="btn btn-block" id="notif-perm">${icon('bell')} ${cap.permission === 'granted' ? 'Notifications autorisées ✓ (tester)' : 'Autoriser les notifications'}</button>
          <button class="btn btn-primary btn-block" id="ics">${icon('download')} Ajouter le rappel à mon calendrier</button>
        </div>
      </section>

      <section class="card-box" id="sec-data">
        <h2>Données</h2>
        <p class="muted small">Dernière sauvegarde : ${s.lastBackup ? formatDate(s.lastBackup) : 'jamais'}${est ? ` · espace utilisé : ${(est.usage / 1048576).toFixed(1)} Mo` : ''}</p>
        <h3>Sauvegarde complète (avec images)</h3>
        <div class="grid-2">
          <button class="btn btn-primary btn-block" id="backup">${icon('download')} Sauvegarder</button>
          <button class="btn btn-block" id="restore">${icon('upload')} Restaurer</button>
        </div>
        <input type="file" id="restore-file" accept=".json,application/json" hidden>
        <label class="field"><span>Me rappeler de sauvegarder tous les</span>
          <select id="backup-every">${[3, 7, 14, 30].map(n => `<option value="${n}" ${n === s.backupEveryDays ? 'selected' : ''}>${n} jours</option>`).join('')}</select></label>
        <p class="hint">Garde ce fichier en lieu sûr (iCloud Drive, Google Drive, e-mail…). Il permet de tout récupérer si tu changes de téléphone ou si le navigateur efface ses données.</p>

        <h3>Cartes au format CSV (tableur)</h3>
        <label class="field"><span>Paquet</span>
          <select id="csv-deck"><option value="">Tous les paquets</option>${deckOptions(decks)}</select></label>
        <div class="grid-2">
          <button class="btn btn-block" id="csv-export">${icon('download')} Exporter CSV</button>
          <button class="btn btn-block" id="csv-import">${icon('upload')} Importer CSV</button>
        </div>
        <input type="file" id="csv-file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden>
        <p class="hint">Colonnes : <code>paquet;recto;verso</code> (la colonne paquet est facultative ; sous-paquets avec <code>::</code>, ex. <code>Histoire::XXe siècle</code>). Séparateur ; , ou tabulation détecté automatiquement. À l'import sans colonne paquet, les cartes vont dans le paquet choisi ci-dessus (ou un paquet « Import »).</p>
      </section>

      <section class="card-box">
        <h2>À propos</h2>
        <p>${esc(APP_NAME)} · version ${APP_VERSION}</p>
        <p class="muted small">Tes données restent sur ce téléphone (aucune synchronisation). Mode : ${cap.standalone ? 'application installée ✓' : 'navigateur (installe l\'app pour une meilleure expérience)'}.</p>
      </section>
    </div>`;

  // Fait défiler jusqu'à la section demandée (ex. #/settings?section=ai)
  if (params.section) $(`#sec-${params.section}`, el)?.scrollIntoView({ block: 'start' });

  // --- Objectif ---
  $('#goal', el).onchange = e => db.setSetting('dailyGoal', Math.max(1, parseInt(e.target.value, 10) || 50));
  $('#newpd', el).onchange = e => db.setSetting('defaultNewPerDay', Math.max(0, parseInt(e.target.value, 10) || 0));

  // --- IA ---
  const price = () => { $('#model-price', el).textContent = 'Prix par million de tokens : ' + (MODELS.find(m => m.id === $('#model', el).value)?.price || ''); };
  price();
  $('#model', el).onchange = async e => { await db.setSetting('model', e.target.value); price(); toast('Modèle enregistré'); };
  $('#showkey', el).onclick = () => {
    const i = $('#apikey', el);
    i.type = i.type === 'password' ? 'text' : 'password';
    $('#showkey', el).textContent = i.type === 'password' ? 'Voir' : 'Cacher';
  };
  $('#savekey', el).onclick = async () => {
    const key = $('#apikey', el).value.trim();
    const st = $('#key-status', el);
    if (!key) { st.textContent = 'Colle ta clé d\'abord.'; return; }
    if (!key.startsWith('sk-ant-')) { st.innerHTML = '<span class="danger">Cette clé ne ressemble pas à une clé Claude (elle doit commencer par « sk-ant- »).</span>'; return; }
    await db.setSetting('apiKey', key);
    st.innerHTML = '<span class="spinner"></span> Test en cours…';
    try {
      await testKey();
      st.innerHTML = '<span class="ok">✓ Clé enregistrée et fonctionnelle.</span>';
    } catch (e) {
      st.innerHTML = `<span class="danger">${esc(e.message)}</span>`;
    }
  };
  $('#delkey', el).onclick = async () => {
    if (!await confirmDialog('Effacer la clé API de ce téléphone ?', { okText: 'Effacer', danger: true })) return;
    await db.setSetting('apiKey', '');
    $('#apikey', el).value = '';
    $('#key-status', el).textContent = 'Clé effacée.';
  };

  // --- Rappels ---
  $('#rem-on', el).onchange = async e => {
    await db.setSetting('remindersOn', e.target.checked);
    if (e.target.checked) {
      if (cap.notifications && Notification.permission === 'default') await askNotificationPermission();
      const ok = await registerPeriodicSync();
      toast(ok ? 'Rappels activés (réveil périodique Android activé)' : 'Rappels activés', 'success');
    } else {
      await unregisterPeriodicSync();
      toast('Rappels désactivés');
    }
  };
  $('#rem-time', el).onchange = e => db.setSetting('reminderTime', e.target.value || '19:00');
  $('#notif-perm', el).onclick = async () => {
    if (!cap.notifications) {
      await alertDialog(cap.platform === 'ios'
        ? "Sur iPhone, les notifications ne sont disponibles qu'une fois l'app installée sur l'écran d'accueil (Partager → Sur l'écran d'accueil), avec iOS 16.4 ou plus récent. Ouvre ensuite l'app depuis son icône et reviens ici."
        : "Ce navigateur ne gère pas les notifications.");
      return;
    }
    const p = await askNotificationPermission();
    if (p === 'granted') {
      await showNotification(APP_NAME, 'Les notifications fonctionnent ✓');
      if (s.remindersOn) await registerPeriodicSync();
    } else {
      toast('Notifications refusées. Tu peux les autoriser dans les réglages du téléphone.', 'error', 4000);
    }
  };
  $('#ics', el).onclick = async () => {
    const time = $('#rem-time', el).value || '19:00';
    await db.setSetting('reminderTime', time);
    const url = location.href.split('#')[0];
    await saveFile('rappel-revision.ics', makeICS(time, APP_NAME, url), 'text/calendar');
    await alertDialog("Ouvre le fichier téléchargé (rappel-revision.ics) puis choisis « Ajouter au calendrier ». Tu recevras une alerte chaque jour à l'heure choisie. Pour changer l'heure plus tard, modifie l'événement directement dans ton calendrier.", 'Rappel calendrier');
  };

  // --- Sauvegarde ---
  $('#backup', el).onclick = async () => {
    const json = await exportBackupJSON();
    const date = new Date().toISOString().slice(0, 10);
    await saveFile(`sauvegarde-memora-${date}.json`, json, 'application/json');
    toast('Sauvegarde créée', 'success');
  };
  $('#restore', el).onclick = () => $('#restore-file', el).click();
  $('#restore-file', el).onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await readFileText(file));
      const ok = await confirmDialog(`Restaurer cette sauvegarde (${obj?.data?.cards?.length ?? '?'} cartes) ?\nToutes les données actuelles seront REMPLACÉES.`, { okText: 'Restaurer', danger: true });
      if (!ok) return;
      const r = await restoreBackup(obj);
      await alertDialog(`Restauration terminée : ${plural(r.decks, 'paquet')}, ${plural(r.cards, 'carte')}.`);
      location.hash = '#/';
    } catch (err) {
      alertDialog(err instanceof SyntaxError ? "Fichier illisible : ce n'est pas un fichier JSON valide." : err.message, 'Restauration impossible');
    }
  };
  $('#backup-every', el).onchange = e => db.setSetting('backupEveryDays', Number(e.target.value));

  // --- CSV ---
  $('#csv-export', el).onclick = async () => {
    const all = await listDecks();
    const sel = $('#csv-deck', el).value;
    const ids = new Set(sel ? descendantIds(sel, all) : all.map(d => d.id));
    const cards = (await db.getAll('cards')).filter(c => ids.has(c.deckId));
    if (!cards.length) { toast('Aucune carte à exporter', 'error'); return; }
    const rows = cards.map(c => ({ deckPath: deckPath(c.deckId, all, '::'), front: c.front, back: c.back }));
    await saveFile(`cartes-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows), 'text/csv');
    toast(`${plural(cards.length, 'carte exportée', 'cartes exportées')}`, 'success');
  };
  $('#csv-import', el).onclick = () => $('#csv-file', el).click();
  $('#csv-file', el).onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = rowsToCards(parseCSV(await readFileText(file)));
      if (!parsed.length) { alertDialog('Aucune carte trouvée dans ce fichier.'); return; }
      const all = await listDecks();
      const sel = $('#csv-deck', el).value;
      const noDeck = parsed.some(c => !c.deckPath);
      if (!await confirmDialog(`Importer ${plural(parsed.length, 'carte')} ?${noDeck ? `\nLes cartes sans paquet iront dans « ${sel ? all.find(d => d.id === sel).name : 'Import'} ».` : ''}`, { okText: 'Importer' })) return;
      let fallback = sel ? all.find(d => d.id === sel) : null;
      const toCreate = [];
      const cache = new Map();
      for (const c of parsed) {
        let deck;
        if (c.deckPath) {
          if (!cache.has(c.deckPath)) cache.set(c.deckPath, await ensureDeckPath(c.deckPath, all));
          deck = cache.get(c.deckPath);
        } else {
          if (!fallback) fallback = await ensureDeckPath('Import', all);
          deck = fallback;
        }
        toCreate.push({ deckId: deck.id, front: c.front, back: c.back });
      }
      await createCards(toCreate);
      toast(`${plural(toCreate.length, 'carte importée', 'cartes importées')} ✓`, 'success', 3500);
    } catch (err) {
      alertDialog("Impossible de lire ce fichier : " + err.message, 'Import CSV');
    }
  };
}

/** Explication honnête de ce qui marche sur ce téléphone. */
function reminderHelp(cap) {
  const lines = [];
  if (cap.platform === 'ios') {
    lines.push("<b>Sur iPhone :</b> une PWA ne peut pas se réveiller toute seule à une heure précise (Apple ne le permet pas sans serveur).");
    lines.push("✔ Le <b>badge</b> (nombre de cartes du jour sur l'icône) marche si l'app est installée et les notifications autorisées (iOS 16.4+). Il se met à jour quand tu ouvres l'app.");
    lines.push("✔ <b>Solution fiable :</b> le rappel dans ton <b>Calendrier</b> (bouton ci-dessous), qui sonne chaque jour.");
    lines.push("✔ Un rappel s'affiche aussi dans l'app si l'heure est passée et que tu n'as pas révisé.");
  } else if (cap.platform === 'android') {
    lines.push("<b>Sur Android :</b> si l'app est installée, Chrome peut la réveiller environ une fois par jour pour t'envoyer une notification s'il reste des cartes — mais <b>l'heure exacte n'est pas garantie</b> (c'est le téléphone qui décide).");
    lines.push("✔ <b>Solution fiable :</b> le rappel dans <b>Google Agenda</b> (bouton ci-dessous).");
    lines.push("✔ Badge : selon le lanceur, un point ou un chiffre sur l'icône.");
  } else {
    lines.push("Les rappels à heure fixe ne sont pas fiables pour une app web sans serveur. Le rappel par calendrier (bouton ci-dessous) est la solution la plus sûre.");
  }
  lines.push(`<span class="muted">Ici : notifications ${cap.notifications ? (cap.permission === 'granted' ? 'autorisées' : cap.permission === 'denied' ? 'refusées' : 'non demandées') : 'indisponibles'} · badge ${cap.badge ? 'disponible' : 'indisponible'} · réveil périodique ${cap.periodicSync ? 'disponible' : 'indisponible'}${cap.standalone ? '' : ' · app non installée'}.</span>`);
  return `<div class="help-box">${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
}
