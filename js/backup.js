// =====================================================================
// backup.js — Sauvegarde complète (JSON, images comprises) et restauration
// ---------------------------------------------------------------------
// La clé API n'est volontairement PAS incluse dans la sauvegarde : si tu
// envoies le fichier quelque part, ta clé ne part pas avec.
// =====================================================================

import * as db from './db.js';

const FORMAT = 'flashcards-backup';
const FORMAT_VERSION = 1;

/** Construit l'objet de sauvegarde avec toutes les données. */
export async function buildBackup() {
  const data = {};
  for (const name of db.STORES) data[name] = await db.getAll(name);
  data.settings = data.settings.filter(s => s.key !== 'apiKey');
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** Renvoie le texte JSON de la sauvegarde. */
export async function exportBackupJSON() {
  const backup = await buildBackup();
  await db.setSetting('lastBackup', Date.now());
  return JSON.stringify(backup);
}

/** Vérifie qu'un objet ressemble bien à une sauvegarde de l'app. */
export function validateBackup(obj) {
  if (!obj || obj.format !== FORMAT || !obj.data) {
    throw new Error("Ce fichier n'est pas une sauvegarde de l'application.");
  }
  if (obj.version > FORMAT_VERSION) {
    throw new Error("Cette sauvegarde vient d'une version plus récente de l'app. Mets l'app à jour d'abord.");
  }
  for (const name of ['decks', 'cards']) {
    if (!Array.isArray(obj.data[name])) throw new Error(`Sauvegarde incomplète (« ${name} » manquant).`);
  }
  return true;
}

/**
 * Restaure une sauvegarde : REMPLACE toutes les données actuelles
 * (la clé API actuelle est conservée).
 */
export async function restoreBackup(obj) {
  validateBackup(obj);
  const apiKey = await db.getSetting('apiKey');
  for (const name of db.STORES) {
    await db.clear(name);
    const list = Array.isArray(obj.data[name]) ? obj.data[name] : [];
    if (list.length) await db.putMany(name, list);
  }
  if (apiKey) await db.setSetting('apiKey', apiKey);
  await db.setSetting('lastBackup', Date.now());
  return {
    decks: obj.data.decks.length,
    cards: obj.data.cards.length,
  };
}

/** Faut-il rappeler de sauvegarder ? (aucune sauvegarde depuis N jours) */
export async function backupIsDue() {
  const s = await db.getAllSettings();
  const cards = await db.getAll('cards');
  if (!cards.length) return false;
  const days = (Date.now() - (s.lastBackup || 0)) / 86400000;
  return days >= (s.backupEveryDays || 7);
}
