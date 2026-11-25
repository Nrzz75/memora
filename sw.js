// =====================================================================
// sw.js — « Service worker » : permet à l'app de fonctionner HORS
// CONNEXION en gardant une copie de tous ses fichiers sur le téléphone.
// Il gère aussi le rappel périodique (Android) et les notifications.
//
// ⚠️ Quand tu modifies un fichier de l'app, augmente CACHE_VERSION :
// les téléphones téléchargeront alors la nouvelle version.
// =====================================================================

const CACHE_VERSION = 'v1';
const CACHE = `flashcards-${CACHE_VERSION}`;

// Tous les fichiers de l'app (chemins relatifs : marche aussi sur GitHub Pages)
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/sm2.js',
  './js/utils.js',
  './js/data.js',
  './js/stats.js',
  './js/csv.js',
  './js/backup.js',
  './js/reminders.js',
  './js/ui.js',
  './js/ai/claude.js',
  './js/ai/prompts.js',
  './js/views/home.js',
  './js/views/decks.js',
  './js/views/cardEditor.js',
  './js/views/review.js',
  './js/views/exam.js',
  './js/views/ai.js',
  './js/views/sheets.js',
  './js/views/stats.js',
  './js/views/settings.js',
];

// Installation : on télécharge et on garde tous les fichiers
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // un fichier manquant (ex. icône) ne doit pas bloquer l'installation
      Promise.all(FILES.map(f => cache.add(new Request(f, { cache: 'reload' })).catch(() => null)))
    )
  );
});

// Activation : on supprime les anciennes versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('flashcards-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// L'app demande d'utiliser tout de suite la nouvelle version
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Requêtes : d'abord la copie locale (rapide, hors connexion), sinon internet.
// Les appels à l'API Claude (autre site) ne passent jamais par le cache.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      // Hors connexion : pour une page, on renvoie l'app
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});

// ---------------------------------------------------------------------
// Rappel périodique (Android / Chrome, app installée uniquement)
// ---------------------------------------------------------------------
self.addEventListener('periodicsync', event => {
  if (event.tag === 'daily-reminder') event.waitUntil(dailyCheck());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./#/study/all');
  })());
});

const DAY_START_HOUR = 4;
function dayKey(ts) {
  const d = new Date(ts - DAY_START_HOUR * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function idb(fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('flashcards-db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      Promise.resolve(fn(db)).then(r => { db.close(); resolve(r); }, e => { db.close(); reject(e); });
    };
  });
}
function getAll(db, name) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(name)) return resolve([]);
    const r = db.transaction(name).objectStore(name).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Compte les cartes du jour et envoie une notification si besoin. */
async function dailyCheck() {
  const { settings, cards, decks, reviews } = await idb(async db => ({
    settings: Object.fromEntries((await getAll(db, 'settings')).map(s => [s.key, s.value])),
    cards: await getAll(db, 'cards'),
    decks: await getAll(db, 'decks'),
    reviews: await getAll(db, 'reviews'),
  }));
  const now = Date.now();
  const today = dayKey(now);
  const eod = new Date(now - DAY_START_HOUR * 3600000); eod.setHours(24 + DAY_START_HOUR, 0, 0, 0);

  // Cartes dues (révisions + apprentissage) + nouvelles dans la limite de chaque paquet
  let due = cards.filter(c => c.state !== 'new' && c.due < eod.getTime()).length;
  const todayReviews = reviews.filter(r => r.day === today);
  for (const d of decks) {
    const studied = todayReviews.filter(r => r.wasNew && r.mode === 'review' && r.deckId === d.id).length;
    const avail = cards.filter(c => c.deckId === d.id && c.state === 'new').length;
    due += Math.min(avail, Math.max(0, (d.newPerDay ?? 20) - studied));
  }

  if (self.navigator.setAppBadge) {
    try { due ? await self.navigator.setAppBadge(due) : await self.navigator.clearAppBadge(); } catch (e) { /* rien */ }
  }

  if (!settings.remindersOn || !due || todayReviews.length) return;
  const [h, m] = String(settings.reminderTime || '19:00').split(':').map(Number);
  const d = new Date();
  if (d.getHours() * 60 + d.getMinutes() < h * 60 + m) return;
  if (settings.lastNotifiedDay === today) return;

  await self.registration.showNotification('C\'est l\'heure de réviser', {
    body: `${due} carte${due > 1 ? 's' : ''} t'attend${due > 1 ? 'ent' : ''} aujourd'hui.`,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'daily-reminder',
  });
  await idb(db => new Promise(res => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key: 'lastNotifiedDay', value: today });
    tx.oncomplete = res;
    tx.onerror = res;
  }));
}
