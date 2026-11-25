// =====================================================================
// ai/claude.js — Connexion à l'API Claude (Anthropic)
// ---------------------------------------------------------------------
// L'app n'a pas de serveur : le téléphone appelle directement l'API avec
// TA clé (stockée uniquement sur ton téléphone). On utilise fetch() en
// mode « streaming » : la réponse arrive petit à petit, ce qui évite les
// délais d'attente et permet d'afficher la progression.
//
// Pourquoi fetch() et pas le SDK officiel d'Anthropic ? L'app est écrite
// en JavaScript pur, sans outil de compilation ni dépendance : le SDK
// demanderait npm + un « bundler ». fetch() appelle exactement la même API.
// =====================================================================

import * as db from '../db.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Modèles proposés dans les réglages (prix indicatifs par million de « tokens »). */
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — le plus fiable (recommandé)', price: '4 $ en entrée / 20 $ en sortie' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — bon équilibre, ≈ 2× moins cher', price: '2 $ / 10 $' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — très économique, moins précis', price: '0,10 $ / 0,50 $' },
];

/** Erreur « propre » avec un message compréhensible en français. */
export class AIError extends Error {
  constructor(kind, message, detail = '') {
    super(message);
    this.kind = kind;     // 'no-key' | 'invalid-key' | 'network' | 'quota' | 'rate' | 'overloaded' | 'refusal' | 'truncated' | 'too-large' | 'other'
    this.detail = detail; // message technique d'origine (pour info)
  }
}

/**
 * Appelle Claude.
 * @param {object} o
 *   system     : consignes générales (texte)
 *   content    : contenu du message (texte ou tableau de blocs texte/image)
 *   schema     : (facultatif) schéma JSON → la réponse sera un objet JSON valide
 *   maxTokens  : longueur maximale de la réponse
 *   effort     : 'low' | 'medium' | 'high' (profondeur de réflexion)
 *   onProgress : fonction appelée avec le nombre de caractères reçus
 *   signal     : AbortController.signal pour annuler
 * @returns {Promise<string|object>} texte, ou objet si schema fourni
 */
export async function callClaude({ system, content, schema = null, maxTokens = 32000, effort = 'medium', onProgress = null, signal = null }) {
  const apiKey = (await db.getSetting('apiKey') || '').trim();
  if (!apiKey) {
    throw new AIError('no-key', "Aucune clé API enregistrée. Va dans Réglages → Intelligence artificielle pour coller ta clé.");
  }
  if (!navigator.onLine) {
    throw new AIError('network', "Pas de connexion internet. L'IA a besoin du réseau (le reste de l'app marche hors connexion).");
  }
  const model = await db.getSetting('model') || 'claude-opus-5-5';
  // Haiku n'a pas de modèle de secours côté serveur : on n'active les
  // « fallbacks » que pour Opus et Sonnet.
  let useFallbacks = !model.startsWith('claude-haiku');

  const body = {
    model,
    max_tokens: maxTokens,
    stream: true,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort },
  };
  if (schema) body.output_config.format = { type: 'json_schema', schema };

  let attempt = 0;
  while (true) {
    attempt++;
    const reqBody = { ...body };
    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      // Autorise l'appel direct depuis un navigateur (pas de serveur ici)
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (useFallbacks) {
      // Si un filtre de sécurité refuse à tort, l'API réessaie seule sur
      // un autre modèle au lieu de renvoyer un refus.
      reqBody.fallbacks = 'default';
      headers['anthropic-beta'] = FALLBACK_BETA;
    }

    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(reqBody), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw new AIError('aborted', 'Génération annulée.');
      throw new AIError('network', "Impossible de joindre le serveur de Claude. Vérifie ta connexion internet puis réessaie.", String(e));
    }

    if (!res.ok) {
      const info = await readError(res);
      // Si l'option « fallbacks » n'est pas acceptée, on réessaie sans
      if (res.status === 400 && useFallbacks && /fallback/i.test(info.message)) {
        useFallbacks = false; attempt--; continue;
      }
      // Erreurs temporaires : on réessaie automatiquement (2 fois max)
      if ([429, 500, 502, 503, 504, 529].includes(res.status) && attempt <= 2 && !/credit|billing|spend/i.test(info.message)) {
        const wait = Number(res.headers.get('retry-after')) || attempt * 4;
        await sleep(Math.min(30, wait) * 1000);
        continue;
      }
      throw toAIError(res.status, info);
    }

    const { text, stopReason } = await readStream(res, onProgress);
    if (stopReason === 'refusal') {
      throw new AIError('refusal', "Claude a refusé de traiter ce contenu (filtre de sécurité). Essaie de reformuler ou de retirer la partie sensible.");
    }
    if (stopReason === 'max_tokens') {
      throw new AIError('truncated', "La réponse était trop longue et a été coupée. Découpe ton cours en plusieurs parties et recommence.");
    }
    if (!schema) return text.trim();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new AIError('other', "La réponse de l'IA est illisible. Réessaie.", text.slice(0, 300));
    }
  }
}

/** Lit la réponse en streaming (format « Server-Sent Events »). */
async function readStream(res, onProgress) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let blocks = [];         // texte de chaque bloc de la réponse
  let blockTypes = {};
  let stopReason = null;
  let received = 0;

  const handle = (evt) => {
    switch (evt.type) {
      case 'content_block_start':
        blockTypes[evt.index] = evt.content_block.type;
        // Un bloc « fallback » signifie : le 1er modèle a refusé, un autre
        // reprend. On jette le texte partiel reçu avant.
        if (evt.content_block.type === 'fallback') blocks = [];
        else if (evt.content_block.type === 'text') blocks.push({ index: evt.index, text: evt.content_block.text || '' });
        break;
      case 'content_block_delta':
        if (evt.delta.type === 'text_delta') {
          const b = blocks.find(x => x.index === evt.index);
          if (b) b.text += evt.delta.text;
          received += evt.delta.text.length;
          if (onProgress) onProgress(received);
        }
        break;
      case 'message_delta':
        if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
        break;
      case 'error': {
        const t = evt.error?.type || '';
        if (t === 'overloaded_error') throw new AIError('overloaded', "Les serveurs de Claude sont surchargés. Réessaie dans quelques minutes.");
        throw new AIError('other', `Erreur pendant la génération : ${evt.error?.message || t}`);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!dataLine) continue;
      let evt;
      try { evt = JSON.parse(dataLine); } catch { continue; }
      handle(evt);
    }
  }
  return { text: blocks.map(b => b.text).join(''), stopReason };
}

async function readError(res) {
  try {
    const j = await res.json();
    return { type: j?.error?.type || '', message: j?.error?.message || '' };
  } catch {
    return { type: '', message: res.statusText || '' };
  }
}

/** Traduit les codes d'erreur de l'API en messages clairs. */
function toAIError(status, { type, message }) {
  const m = message || '';
  if (status === 401) return new AIError('invalid-key', "Clé API invalide. Vérifie que tu l'as copiée en entier (elle commence par « sk-ant- »).", m);
  if (status === 403) return new AIError('invalid-key', "Cette clé API n'a pas l'autorisation d'utiliser ce service.", m);
  if (/credit balance|billing|purchase credits|spend limit|usage limit/i.test(m)) {
    return new AIError('quota', "Crédit épuisé ou limite de dépense atteinte sur ton compte Anthropic. Ajoute du crédit sur console.anthropic.com (Billing).", m);
  }
  if (status === 429) return new AIError('rate', "Trop de demandes en peu de temps (limite de ton compte). Patiente une minute puis réessaie.", m);
  if (status === 413) return new AIError('too-large', "Le contenu envoyé est trop gros (trop de photos ?). Envoie moins de pages à la fois.", m);
  if (status === 404) return new AIError('other', "Modèle introuvable. Choisis un autre modèle dans les Réglages.", m);
  if (status === 529 || type === 'overloaded_error') return new AIError('overloaded', "Les serveurs de Claude sont surchargés. Réessaie dans quelques minutes.", m);
  if (status >= 500) return new AIError('other', "Le service Claude a un problème temporaire. Réessaie un peu plus tard.", m);
  return new AIError('other', `Erreur de l'API (${status}) : ${m || type}`, m);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Petit test de la clé (réponse très courte, coût quasi nul). */
export async function testKey() {
  try {
    return await callClaude({
      system: 'Réponds uniquement « OK ».',
      content: 'Test',
      maxTokens: 300,
      effort: 'low',
    });
  } catch (e) {
    // Réponse coupée = la clé fonctionne quand même
    if (e.kind === 'truncated') return 'OK';
    throw e;
  }
}

/** Transforme une data URL d'image en bloc « image » pour l'API. */
export function imageBlock(dataUrl) {
  const [meta, data] = dataUrl.split(',');
  const media_type = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type, data } };
}
