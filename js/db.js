// =====================================================================
// db.js — Stockage local dans le téléphone (IndexedDB)
// ---------------------------------------------------------------------
// Toutes les données restent sur l'appareil. Tables (« stores ») :
//   decks    : paquets (avec parentId pour les sous-paquets)
//   cards    : cartes (recto, verso, état SM-2…)
//   media    : images compressées (data URL), référencées par les cartes
//   reviews  : historique de chaque réponse (pour les statistiques)
//   sheets   : fiches de révision générées par l'IA
//   settings : réglages (clé API, objectif du jour…)
// =====================================================================

// La page de tests utilise une base séparée pour ne jamais toucher tes cartes
const DB_NAME = globalThis.__TEST_DB_NAME__ || 'flashcards-db';
const DB_VERSION = 1;
export const STORES = ['decks', 'cards', 'media', 'reviews', 'sheets', 'settings'];

let dbPromise = null;

/** Ouvre (ou crée) la base de données. */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('decks')) {
        const s = db.createObjectStore('decks', { keyPath: 'id' });
        s.createIndex('parentId', 'parentId');
      }
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'id' });
        s.createIndex('deckId', 'deckId');
        s.createIndex('due', 'due');
      }
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reviews')) {
        const s = db.createObjectStore('reviews', { keyPath: 'id' });
        s.createIndex('day', 'day');
        s.createIndex('cardId', 'cardId');
      }
      if (!db.objectStoreNames.contains('sheets')) db.createObjectStore('sheets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Transforme une requête IndexedDB en promesse. */
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

// ---------- Opérations génériques ----------
export async function get(name, id) {
  return wrap((await store(name)).get(id));
}
export async function getAll(name) {
  return wrap((await store(name)).getAll());
}
export async function put(name, obj) {
  return wrap((await store(name, 'readwrite')).put(obj));
}
export async function del(name, id) {
  return wrap((await store(name, 'readwrite')).delete(id));
}
export async function getByIndex(name, index, value) {
  return wrap((await store(name)).index(index).getAll(value));
}
export async function clear(name) {
  return wrap((await store(name, 'readwrite')).clear());
}

/** Écrit plusieurs objets d'un coup (une seule transaction, plus rapide). */
export async function putMany(name, list) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const s = tx.objectStore(name);
    for (const obj of list) s.put(obj);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Supprime plusieurs objets d'un coup. */
export async function delMany(name, ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const s = tx.objectStore(name);
    for (const id of ids) s.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Réglages (clé → valeur) ----------
export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  dailyGoal: 50,          // nombre de réponses visé par jour
  reminderTime: '19:00',
  remindersOn: false,
  lastBackup: 0,
  backupEveryDays: 7,
  defaultNewPerDay: 20,
};

export async function getSetting(key) {
  const row = await get('settings', key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}
export async function setSetting(key, value) {
  return put('settings', { key, value });
}
export async function getAllSettings() {
  const rows = await getAll('settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Demande au navigateur de ne pas effacer nos données (si possible). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) { /* pas grave */ }
  return false;
}
