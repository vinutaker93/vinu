import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DISCORD_QUEUE_PATH, ensureDirs } from './config.js';
import { maskProxy } from './proxy.js';

export const BRAND = 'TIGRE AIO';
export const DEFAULT_LOGO =
  'https://cdn.discordapp.com/attachments/1023333501312962690/1545161251431121037/image-1788465467838.png?ex=6a9b230e&is=6a99d18e&hm=ca1e5b8efbcba2e08c9b185c0f1bad0faa31b8de25f6261a14500958ed23ac41&';

const COLORS = {
  success: 0x2ecc71,
  error: 0xe74c3c,
  warning: 0xe67e22,
  info: 0x5865f2,
};

const STATUS_LABEL = {
  success: '✅ Confirmée',
  error: '❌ Échec',
  warning: '⚠️ À vérifier',
  info: 'ℹ️ Information',
};

function frDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    iso: d.toISOString(),
  };
}

// Contrairement à l'extension Chrome (v2/v3, embed masqué pour un usage
// partagé), ce CLI est un outil perso : le webhook affiche tout en clair —
// site, produit, lien cliquable, image du produit. Seuls les identifiants du
// proxy restent masqués (host:port visible, jamais le user:pass).
function buildEmbed(payload, logoUrl) {
  const ts = payload.timestamp || Date.now();
  const { date, time, iso } = frDateTime(ts);
  const status = payload.status || 'info';
  const logo = logoUrl || DEFAULT_LOGO;

  const fields = [
    { name: '📧 Compte', value: `\`${payload.email || '—'}\``, inline: true },
    { name: '🌐 Site', value: payload.site || 'pokelite.fr', inline: true },
    { name: '📌 Statut', value: STATUS_LABEL[status] || status, inline: true },
  ];

  if (payload.item) fields.push({ name: '🎁 Produit', value: payload.item, inline: false });
  if (payload.step) fields.push({ name: '🧩 Étape', value: payload.step, inline: true });
  if (payload.profileName) fields.push({ name: '👤 Identité', value: payload.profileName, inline: true });
  if (payload.proxyLine) {
    const masked = maskProxy(payload.proxyLine);
    if (masked) fields.push({ name: '🔌 Proxy', value: masked, inline: true });
  }
  fields.push({ name: '📅 Date', value: date, inline: true });
  fields.push({ name: '⏰ Heure', value: `${time} (heure locale)`, inline: true });
  if (payload.progress) fields.push({ name: '📊 Avancement', value: payload.progress, inline: true });
  if (payload.detail) fields.push({ name: '📝 Détail', value: String(payload.detail).slice(0, 1000), inline: false });

  const embed = {
    author: { name: BRAND, icon_url: logo },
    title: payload.title || STATUS_LABEL[status] || BRAND,
    color: COLORS[status] || COLORS.info,
    fields,
    footer: { text: `${BRAND} • ${payload.email || 'compte inconnu'}`, icon_url: logo },
    timestamp: iso,
  };
  if (payload.description) embed.description = String(payload.description).slice(0, 3800);
  // Lien de la page produit : titre cliquable, en clair (outil perso).
  if (payload.url) embed.url = payload.url;
  // Image du produit en vignette.
  if (payload.image) embed.thumbnail = { url: payload.image };

  return embed;
}

async function postToDiscord(webhookUrl, body) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    let retryAfter = 2;
    try {
      const j = await res.json();
      if (j && j.retry_after) retryAfter = Number(j.retry_after) > 100 ? Number(j.retry_after) / 1000 : Number(j.retry_after);
    } catch (_) {}
    const e = new Error('rate-limited');
    e.retryAfter = retryAfter;
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return true;
}

async function loadQueue() {
  await ensureDirs();
  if (!existsSync(DISCORD_QUEUE_PATH)) return [];
  try {
    return JSON.parse(await readFile(DISCORD_QUEUE_PATH, 'utf8'));
  } catch (_) {
    return [];
  }
}

async function saveQueue(queue) {
  await ensureDirs();
  await writeFile(DISCORD_QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');
}

async function enqueue(body) {
  const queue = await loadQueue();
  queue.push({ body, tries: 0, at: Date.now() });
  await saveQueue(queue.slice(-200));
}

// Rejoue la file d'attente (messages qui avaient échoué lors d'un run
// précédent). Équivalent du bouton "Renvoyer la file d'attente" du popup.
export async function flushDiscordQueue(webhookUrl) {
  if (!webhookUrl) return { ok: false, error: 'Aucun webhook configuré.' };
  const queue = await loadQueue();
  if (queue.length === 0) return { ok: true, flushed: 0, remaining: 0 };

  const remaining = [];
  let flushed = 0;
  for (const item of queue) {
    try {
      await postToDiscord(webhookUrl, item.body);
      flushed++;
      await new Promise((r) => setTimeout(r, 400)); // évite le rate-limit Discord
    } catch (_) {
      item.tries = (item.tries || 0) + 1;
      if (item.tries < 8) remaining.push(item);
    }
  }
  await saveQueue(remaining);
  return { ok: true, flushed, remaining: remaining.length };
}

// Envoie une notification : 3 tentatives immédiates avec backoff, puis mise
// en file d'attente locale (rejouée par flushDiscordQueue au run suivant).
export async function notifyDiscord({ webhookUrl, logoUrl }, payload) {
  if (!webhookUrl) return { ok: false, error: 'Aucun webhook configuré.' };

  const body = {
    username: BRAND,
    avatar_url: logoUrl || DEFAULT_LOGO,
    embeds: [buildEmbed(payload, logoUrl)],
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await postToDiscord(webhookUrl, body);
      return { ok: true };
    } catch (err) {
      const wait = err && err.retryAfter ? err.retryAfter * 1000 : 800 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, Math.min(wait, 6000)));
    }
  }
  await enqueue(body);
  return { ok: false, queued: true };
}
