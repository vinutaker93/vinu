/* Pokelite Helper — service worker
 * - ouverture automatique des 7 liens du tirage (une fois par compte)
 * - proxy par compte (persistant, associé ligne par ligne)
 * - webhook Discord fiable (file d'attente + retries) au format "rapport complet"
 */

// Les 7 liens du tirage 30e anniversaire Pokémon (ME5-5)
const RAFFLE_LINKS = [
  'https://www.pokelite.fr/produit/coffret-amphinobi-ex-30%e1%b5%89-anniversaire-pokemon-me5-5/',
  'https://www.pokelite.fr/produit/coffret-nymphali-ex-30%e1%b5%89-anniversaire-pokemon-me5-5/',
  'https://www.pokelite.fr/produit/coffret-poster-30%e1%b5%89-anniversaire-pokemon-me5-5/',
  'https://www.pokelite.fr/produit/duopack-30%e1%b5%89-anniversaire-pokemon-me5-5/',
  'https://www.pokelite.fr/produit/etb-30%e1%b5%89-anniversaire-pokemon-me5-5/',
  'https://www.pokelite.fr/produit/pokebox-30%e1%b5%89-anniversaire-pokemon-me5-5/',
  'https://www.pokelite.fr/produit/tripack-30%e1%b5%89-anniversaire-pokemon-me5-5/',
];

const storage = {
  get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  },
  set(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  },
};

// --- Ouverture des 7 liens ---------------------------------------------
// Le suivi est fait PAR EMAIL : chaque nouveau compte réouvre les 7 liens.
async function openRaffleLinks(email, { force = false } = {}) {
  const key = email || '__default__';
  const { raffleOpenedByEmail = {} } = await storage.get(['raffleOpenedByEmail']);

  if (!force && raffleOpenedByEmail[key]) {
    return { ok: true, opened: false, reason: 'already-opened' };
  }

  raffleOpenedByEmail[key] = Date.now();
  await storage.set({ raffleOpenedByEmail, raffleLinksOpened: true });

  // Ouverture séquentielle et espacée : certains sites/proxies rejettent
  // 7 requêtes simultanées, ce qui faisait échouer une partie des onglets.
  for (let i = 0; i < RAFFLE_LINKS.length; i++) {
    const url = RAFFLE_LINKS[i];
    await new Promise((resolve) => {
      chrome.tabs.create({ url, active: false }, () => {
        void chrome.runtime.lastError;
        setTimeout(resolve, 350);
      });
    });
  }

  await notifyDiscord({
    kind: 'raffle-open',
    email: key,
    site: 'pokelite.fr',
    status: 'info',
    title: '🚀 Ouverture des 7 liens du tirage',
    description: `Le compte est prêt (email + prénom/nom enregistrés). Les ${RAFFLE_LINKS.length} pages du tirage viennent d'être ouvertes automatiquement.`,
  });

  return { ok: true, opened: true, count: RAFFLE_LINKS.length };
}

// --- Proxy --------------------------------------------------------------
// Formats acceptés :
//   host:port
//   host:port:user:pass
//   user:pass@host:port
//   scheme://... (http, https, socks4, socks5)
let activeProxyCreds = null;

function parseProxyLine(line) {
  let s = String(line || '').trim();
  if (!s) return null;

  let scheme = 'http';
  const schemeMatch = s.match(/^(https?|socks[45]):\/\//i);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    s = s.slice(schemeMatch[0].length);
  }

  let host, port, username, password;

  if (s.includes('@')) {
    const at = s.lastIndexOf('@');
    const creds = s.slice(0, at);
    const hostPort = s.slice(at + 1);
    const ci = creds.indexOf(':');
    username = ci === -1 ? creds : creds.slice(0, ci);
    password = ci === -1 ? '' : creds.slice(ci + 1);
    [host, port] = hostPort.split(':');
  } else {
    const parts = s.split(':');
    if (parts.length >= 4) {
      [host, port, username] = parts;
      password = parts.slice(3).join(':');
    } else if (parts.length === 2) {
      [host, port] = parts;
    } else {
      return null;
    }
  }

  if (!host || !port || Number.isNaN(Number(port))) return null;
  return {
    scheme,
    host: host.trim(),
    port: Number(port),
    username: username || null,
    password: password || null,
  };
}

function applyProxy(proxyLine) {
  return new Promise((resolve) => {
    const parsed = proxyLine ? parseProxyLine(proxyLine) : null;

    if (!parsed) {
      activeProxyCreds = null;
      chrome.storage.local.set({ activeProxyLine: '' });
      chrome.proxy.settings.clear({ scope: 'regular' }, () =>
        resolve({ ok: true, cleared: true })
      );
      return;
    }

    activeProxyCreds = parsed;
    chrome.storage.local.set({ activeProxyLine: String(proxyLine).trim() });

    const config = {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: parsed.scheme, host: parsed.host, port: parsed.port },
        bypassList: ['localhost', '127.0.0.1', '<local>'],
      },
    };
    chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => {
      const err = chrome.runtime.lastError;
      resolve(
        err
          ? { ok: false, error: err.message }
          : { ok: true, host: parsed.host, port: parsed.port, scheme: parsed.scheme }
      );
    });
  });
}

// Ré-applique le proxy du compte actif au démarrage du service worker
// (le worker MV3 est tué régulièrement : sans ça le proxy « sautait »).
async function restoreActiveProxy() {
  const { activeProxyLine } = await storage.get(['activeProxyLine']);
  if (activeProxyLine) await applyProxy(activeProxyLine);
}
chrome.runtime.onStartup.addListener(restoreActiveProxy);
chrome.runtime.onInstalled.addListener(restoreActiveProxy);
restoreActiveProxy();

chrome.webRequest.onAuthRequired.addListener(
  (details, asyncCallback) => {
    if (!details.isProxy || !activeProxyCreds || !activeProxyCreds.username) {
      asyncCallback({});
      return;
    }
    asyncCallback({
      authCredentials: {
        username: activeProxyCreds.username,
        password: activeProxyCreds.password || '',
      },
    });
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking']
);

// --- Discord ------------------------------------------------------------
const COLORS = {
  success: 0x2ecc71,
  error: 0xe74c3c,
  warning: 0xe67e22,
  info: 0x5865f2,
};

const STATUS_LABEL = {
  success: '✅ Participation confirmée',
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

function maskProxy(line) {
  if (!line) return '—';
  const p = parseProxyLine(line);
  if (!p) return '—';
  return p.username ? `${p.host}:${p.port} (auth)` : `${p.host}:${p.port}`;
}

function buildEmbed(payload, proxyLine) {
  const ts = payload.timestamp || Date.now();
  const { date, time, iso } = frDateTime(ts);
  const status = payload.status || 'info';

  const fields = [
    { name: '📧 Compte', value: `\`${payload.email || '—'}\``, inline: true },
    { name: '🌐 Site', value: payload.site || 'pokelite.fr', inline: true },
    { name: '📌 Statut', value: STATUS_LABEL[status] || status, inline: true },
    { name: '🎁 Item', value: payload.item || '—', inline: false },
  ];

  if (payload.step) fields.push({ name: '🧩 Étape', value: payload.step, inline: true });
  if (payload.profileName)
    fields.push({ name: '👤 Identité', value: payload.profileName, inline: true });
  fields.push({ name: '🔌 Proxy', value: maskProxy(proxyLine), inline: true });
  fields.push({ name: '📅 Date', value: date, inline: true });
  fields.push({ name: '⏰ Heure', value: `${time} (heure locale)`, inline: true });
  if (payload.progress) fields.push({ name: '📊 Avancement', value: payload.progress, inline: true });
  if (payload.detail) fields.push({ name: '📝 Détail', value: payload.detail.slice(0, 1000), inline: false });
  if (payload.url) fields.push({ name: '🔗 Page', value: payload.url.slice(0, 1000), inline: false });

  const embed = {
    title: payload.title || STATUS_LABEL[status] || 'Pokelite Helper',
    color: COLORS[status] || COLORS.info,
    fields,
    footer: { text: `Pokelite Helper v2.0 • ${payload.email || 'compte inconnu'}` },
    timestamp: iso,
  };
  if (payload.description) embed.description = payload.description.slice(0, 3800);
  if (payload.url) embed.url = payload.url;
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

// File d'attente persistante : si l'envoi échoue (proxy KO, réseau, worker tué),
// le message est réessayé plus tard au lieu d'être perdu.
let flushing = false;

async function enqueue(body) {
  const { discordQueue = [] } = await storage.get(['discordQueue']);
  discordQueue.push({ body, tries: 0, at: Date.now() });
  await storage.set({ discordQueue: discordQueue.slice(-200) });
  chrome.alarms.create('discord-flush', { delayInMinutes: 1 });
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const { discordQueue = [], webhookUrl } = await storage.get(['discordQueue', 'webhookUrl']);
    if (!webhookUrl || discordQueue.length === 0) return;

    const remaining = [];
    for (const item of discordQueue) {
      try {
        await postToDiscord(webhookUrl, item.body);
        await new Promise((r) => setTimeout(r, 400)); // évite le rate-limit Discord
      } catch (err) {
        item.tries = (item.tries || 0) + 1;
        if (item.tries < 8) remaining.push(item);
      }
    }
    await storage.set({ discordQueue: remaining });
    if (remaining.length) chrome.alarms.create('discord-flush', { delayInMinutes: 1 });
  } finally {
    flushing = false;
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'discord-flush') flushQueue();
});

async function notifyDiscord(payload) {
  const { webhookUrl, activeProxyLine } = await storage.get(['webhookUrl', 'activeProxyLine']);
  if (!webhookUrl) return { ok: false, error: 'Aucun webhook configuré' };

  // Anti-doublon : même compte + même page + même statut dans les 15 s.
  const dedupeKey = `${payload.email}|${payload.url || ''}|${payload.status}|${payload.step || ''}`;
  const { discordSeen = {} } = await storage.get(['discordSeen']);
  const now = Date.now();
  if (discordSeen[dedupeKey] && now - discordSeen[dedupeKey] < 15000) {
    return { ok: true, skipped: 'duplicate' };
  }
  discordSeen[dedupeKey] = now;
  for (const k of Object.keys(discordSeen)) {
    if (now - discordSeen[k] > 600000) delete discordSeen[k];
  }
  await storage.set({ discordSeen });

  const body = {
    username: 'Pokelite Helper',
    embeds: [buildEmbed(payload, activeProxyLine)],
  };

  // 3 tentatives immédiates avec backoff, puis mise en file d'attente.
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

// --- Messages -----------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'NOTIFY_DISCORD') {
    const payload = msg.payload || { status: 'info', description: msg.message };
    if (!payload.url && sender && sender.tab) payload.url = sender.tab.url;
    notifyDiscord(payload).then(sendResponse);
    return true;
  }

  if (msg.type === 'ACCOUNT_READY' || msg.type === 'ACCOUNT_CREATED') {
    openRaffleLinks(msg.email).then(sendResponse);
    return true;
  }

  if (msg.type === 'OPEN_RAFFLE_LINKS') {
    openRaffleLinks(msg.email, { force: true }).then(sendResponse);
    return true;
  }

  if (msg.type === 'APPLY_PROXY') {
    applyProxy(msg.proxy).then(sendResponse);
    return true;
  }

  if (msg.type === 'CLEAR_PROXY') {
    applyProxy(null).then(sendResponse);
    return true;
  }

  if (msg.type === 'FLUSH_DISCORD') {
    flushQueue().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_RAFFLE_LINKS') {
    sendResponse({ ok: true, links: RAFFLE_LINKS });
    return true;
  }
});
