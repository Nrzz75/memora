// =====================================================================
// reminders.js — Badge sur l'icône, notifications et rappels
// ---------------------------------------------------------------------
// Ce que les PWA savent faire (honnêtement) :
//  • Badge (chiffre sur l'icône) : iPhone (iOS 16.4+, app installée et
//    notifications autorisées) et ordinateur. Android : souvent un simple
//    point, selon le lanceur.
//  • Notification à heure fixe SANS serveur : impossible de façon fiable.
//    - Android/Chrome : « synchronisation périodique » → le téléphone
//      réveille l'app de temps en temps (≈ 1 fois/jour, heure non garantie).
//    - iPhone : aucune exécution en arrière-plan pour les PWA.
//  • Solutions de repli fiables : rappel ajouté au CALENDRIER (fichier
//    .ics avec alarme quotidienne) + rappel dans l'app à l'ouverture.
// =====================================================================

import * as db from './db.js';
import { dayKey } from './utils.js';

export function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** Ce que ce téléphone / navigateur permet. */
export async function capabilities() {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  return {
    platform: platform(),
    standalone: isStandalone(),
    notifications: 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    badge: 'setAppBadge' in navigator,
    periodicSync: !!(reg && 'periodicSync' in reg),
  };
}

/** Met à jour le chiffre sur l'icône de l'app (si possible). */
export async function updateBadge(count) {
  try {
    if (!('setAppBadge' in navigator)) return false;
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
    return true;
  } catch (e) {
    return false; // pas autorisé (ex. notifications refusées sur iPhone)
  }
}

/** Demande l'autorisation d'afficher des notifications. */
export async function askNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

/** Active la synchronisation périodique (Android/Chrome uniquement). */
export async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return false;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return false;
    await reg.periodicSync.register('daily-reminder', { minInterval: 12 * 60 * 60 * 1000 });
    return true;
  } catch (e) {
    return false;
  }
}

export async function unregisterPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.unregister('daily-reminder');
  } catch (e) { /* rien */ }
}

/** Affiche une notification tout de suite (via le service worker). */
export async function showNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'daily-reminder',
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Rappel « dans l'app » : si l'heure du rappel est passée et que je n'ai
 * pas encore révisé aujourd'hui, on renvoie un message à afficher.
 */
export async function inAppReminder(dueCount) {
  const s = await db.getAllSettings();
  if (!s.remindersOn || dueCount <= 0) return null;
  const [h, m] = (s.reminderTime || '19:00').split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return null;
  const today = await db.getByIndex('reviews', 'day', dayKey());
  if (today.length) return null;
  return `C'est l'heure de réviser : ${dueCount} carte${dueCount > 1 ? 's' : ''} t'attend${dueCount > 1 ? 'ent' : ''}.`;
}

/**
 * Fichier calendrier (.ics) : un événement chaque jour à l'heure choisie,
 * avec une alarme. Fonctionne avec Calendrier (iPhone) et Google Agenda.
 */
export function makeICS(time, appName, appUrl) {
  const [h, m] = time.split(':').map(Number);
  const p = n => String(n).padStart(2, '0');
  // Heure « locale » (sans fuseau) : le rappel suit l'heure du téléphone
  const fmt = dt => `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}T${p(dt.getHours())}${p(dt.getMinutes())}00`;
  const today = new Date();
  const startD = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, h, m);
  const endD = new Date(startD.getTime() + 15 * 60 * 1000);
  const start = fmt(startD);
  const end = fmt(endD);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Memora//FR', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:rappel-revision-${Date.now()}@flashcards`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:Réviser mes cartes (${appName})`,
    `DESCRIPTION:Ouvre ${appName} pour tes révisions du jour : ${appUrl}`,
    `URL:${appUrl}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:Réviser mes cartes`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
