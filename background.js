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
  const openedIds = [];
  for (let i = 0; i < RAFFLE_LINKS.length; i++) {
    const url = RAFFLE_LINKS[i];
    await new Promise((resolve) => {
      chrome.tabs.create({ url, active: false }, (tab) => {
        void chrome.runtime.lastError;
        if (tab) openedIds.push(tab.id);
        setTimeout(resolve, 350);
      });
    });
  }

  // Pendant une campagne multi-comptes, ces onglets seront fermés
  // automatiquement dès que le compte atteint 7/7 participations.
  const campaignForThisEmail = await getCampaign();
  if (
    campaignForThisEmail &&
    campaignForThisEmail.running &&
    campaignForThisEmail.accounts[campaignForThisEmail.index] &&
    campaignForThisEmail.accounts[campaignForThisEmail.index].email === key
  ) {
    campaignForThisEmail.raffleTabIds = (campaignForThisEmail.raffleTabIds || []).concat(openedIds);
    await setCampaign(campaignForThisEmail);
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

// --- Campagne multi-comptes ---------------------------------------------
// Traite tous les comptes enregistrés l'un après l'autre, entièrement sans
// intervention : inscription -> profil -> 7 participations -> déconnexion ->
// compte suivant (avec le proxy associé à sa ligne), jusqu'à épuisement de
// la liste. Piloté par un petit automate stocké dans chrome.storage.local.
const ACCOUNT_TIMEOUT_MS = 8 * 60 * 1000; // sécurité anti-blocage par compte

async function getCampaign() {
  const { campaign } = await storage.get(['campaign']);
  return campaign || null;
}
function setCampaign(c) {
  return storage.set({ campaign: c });
}

async function startCampaign() {
  const { accounts = [], proxyLines = [] } = await storage.get(['accounts', 'proxyLines']);
  if (accounts.length === 0) return { ok: false, error: 'Aucun compte enregistré.' };

  const existing = await getCampaign();
  if (existing && existing.running) return { ok: false, error: 'Une campagne est déjà en cours.' };

  const campaign = {
    running: true,
    accounts: accounts.map((a, i) => ({ email: a.email, proxy: proxyLines[i] || '' })),
    index: 0,
    phase: 'register', // 'register' = inscription/profil/participations en cours | 'logout' = transition
    pendingLogoutEmail: null,
    tabId: null,
    raffleTabIds: [],
    finishedIndexes: {},
    startedAt: Date.now(),
    startedAccountAt: Date.now(),
  };

  const first = campaign.accounts[0];
  await storage.set({ myEmail: first.email });
  await applyProxy(first.proxy || null);

  const tab = await new Promise((resolve) =>
    chrome.tabs.create({ url: 'https://www.pokelite.fr/mon-compte/', active: true }, resolve)
  );
  campaign.tabId = tab && tab.id;
  await setCampaign(campaign);

  await notifyDiscord({
    status: 'info',
    title: '🚀 Campagne multi-comptes démarrée',
    email: first.email,
    item: `${campaign.accounts.length} compte(s) au total`,
    progress: `Compte 1/${campaign.accounts.length}`,
    description:
      'Inscription, profil puis 7 participations pour chaque compte, avec déconnexion et changement de proxy automatiques entre chacun.',
  });

  return { ok: true, count: campaign.accounts.length };
}

async function stopCampaign() {
  const c = await getCampaign();
  if (!c || !c.running) return { ok: true };

  const tabIds = (c.raffleTabIds || []).slice();
  const current = c.accounts[c.index];
  c.running = false;
  c.phase = 'stopped';
  await setCampaign(c);
  tabIds.forEach((id) => chrome.tabs.remove(id, () => void chrome.runtime.lastError));

  await notifyDiscord({
    status: 'warning',
    title: '⏹ Campagne arrêtée manuellement',
    email: current ? current.email : '—',
    item: `${c.index}/${c.accounts.length} compte(s) traité(s)`,
    description: 'La campagne multi-comptes a été arrêtée avant la fin de la liste.',
  });
  return { ok: true };
}

// Un compte a atteint 7/7 participations : notifie, ferme ses onglets, et
// enchaîne sur la déconnexion + le compte suivant (ou termine la campagne).
async function accountFinished(index) {
  const c = await getCampaign();
  if (!c || !c.running || c.index !== index) return;
  const acc = c.accounts[index];
  if (!acc) return;

  const tabIds = (c.raffleTabIds || []).slice();
  c.raffleTabIds = [];
  await setCampaign(c);
  tabIds.forEach((id) => chrome.tabs.remove(id, () => void chrome.runtime.lastError));

  const isLast = index + 1 >= c.accounts.length;
  await notifyDiscord({
    status: 'success',
    title: isLast ? '✅ Dernier compte terminé' : '✅ Compte terminé — passage au suivant',
    email: acc.email,
    item: `${RAFFLE_LINKS.length}/${RAFFLE_LINKS.length} tirages`,
    progress: `Compte ${index + 1}/${c.accounts.length}`,
    description: isLast
      ? 'La campagne va se terminer.'
      : 'Déconnexion puis inscription automatique du compte suivant...',
  });

  if (isLast) {
    c.running = false;
    c.phase = 'done';
    await setCampaign(c);
    if (c.tabId) chrome.tabs.remove(c.tabId, () => void chrome.runtime.lastError);
    await notifyDiscord({
      status: 'success',
      title: '🏁 Campagne terminée',
      email: '—',
      item: `${c.accounts.length} compte(s)`,
      description: `Les ${c.accounts.length} comptes ont été traités : inscription, profil et ${RAFFLE_LINKS.length} participations chacun.`,
    });
    return;
  }

  c.phase = 'logout';
  c.pendingLogoutEmail = acc.email;
  c.logoutStartedAt = Date.now();
  await setCampaign(c);

  if (c.tabId) {
    chrome.tabs.update(c.tabId, { url: 'https://www.pokelite.fr/mon-compte/' }, () => void chrome.runtime.lastError);
  } else {
    const tab = await new Promise((resolve) =>
      chrome.tabs.create({ url: 'https://www.pokelite.fr/mon-compte/', active: false }, resolve)
    );
    c.tabId = tab && tab.id;
    await setCampaign(c);
  }
}

// Le content script confirme qu'il vient de se déconnecter : on bascule sur
// le compte suivant (email + proxy) et on relance la page pour l'inscription.
async function handleCampaignStage(stage, email, tabId) {
  const c = await getCampaign();
  if (!c || !c.running) return;

  if (stage === 'logged-out') {
    if (c.phase !== 'logout' || c.pendingLogoutEmail !== email) return; // signal obsolète, ignoré

    c.index += 1;
    c.pendingLogoutEmail = null;
    c.phase = 'register';
    c.startedAccountAt = Date.now();
    await setCampaign(c);

    if (c.index >= c.accounts.length) {
      c.running = false;
      await setCampaign(c);
      return;
    }

    const next = c.accounts[c.index];
    await storage.set({ myEmail: next.email });
    await applyProxy(next.proxy || null);

    const tid = tabId || c.tabId;
    if (tid) {
      chrome.tabs.update(tid, { url: 'https://www.pokelite.fr/mon-compte/' }, () => void chrome.runtime.lastError);
    } else {
      const tab = await new Promise((resolve) =>
        chrome.tabs.create({ url: 'https://www.pokelite.fr/mon-compte/', active: false }, resolve)
      );
      const fresh = await getCampaign();
      if (fresh && fresh.running) {
        fresh.tabId = tab && tab.id;
        await setCampaign(fresh);
      }
    }
  }
}

// Détecte quand le compte en cours atteint 7/7 participations.
async function onDoneByEmailChanged(doneByEmail) {
  const c = await getCampaign();
  if (!c || !c.running || c.phase !== 'register') return;
  const acc = c.accounts[c.index];
  if (!acc) return;
  const count = Object.keys(doneByEmail[acc.email] || {}).length;
  if (count >= RAFFLE_LINKS.length && !c.finishedIndexes[c.index]) {
    c.finishedIndexes[c.index] = true;
    await setCampaign(c);
    await accountFinished(c.index);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.doneByEmail) {
    onDoneByEmailChanged(changes.doneByEmail.newValue || {});
  }
});

// Filet de sécurité : si un compte reste bloqué (page cassée, case
// introuvable, déconnexion qui échoue...) on force le passage au suivant
// plutôt que de laisser la campagne geler indéfiniment.
async function checkCampaignWatchdog() {
  const c = await getCampaign();
  if (!c || !c.running) return;

  const started = c.phase === 'logout' ? c.logoutStartedAt || c.startedAccountAt : c.startedAccountAt;
  if (!started || Date.now() - started < ACCOUNT_TIMEOUT_MS) return;

  const acc = c.accounts[c.index];
  await notifyDiscord({
    status: 'error',
    title: '⏱ Compte bloqué — passage forcé au suivant',
    email: acc ? acc.email : '—',
    item: `Phase : ${c.phase === 'logout' ? 'déconnexion' : 'inscription / participations'}`,
    progress: `Compte ${c.index + 1}/${c.accounts.length}`,
    description: `Aucune progression détectée depuis plus de ${Math.round(ACCOUNT_TIMEOUT_MS / 60000)} minutes. Le compte est ignoré, la campagne continue avec le suivant.`,
  });

  if (c.phase === 'logout') {
    c.index += 1;
    c.pendingLogoutEmail = null;
    c.phase = 'register';
    c.startedAccountAt = Date.now();
    await setCampaign(c);
    if (c.index >= c.accounts.length) {
      c.running = false;
      await setCampaign(c);
      return;
    }
    const next = c.accounts[c.index];
    await storage.set({ myEmail: next.email });
    await applyProxy(next.proxy || null);
    if (c.tabId) {
      chrome.tabs.update(c.tabId, { url: 'https://www.pokelite.fr/mon-compte/' }, () => void chrome.runtime.lastError);
    } else {
      const tab = await new Promise((resolve) =>
        chrome.tabs.create({ url: 'https://www.pokelite.fr/mon-compte/', active: false }, resolve)
      );
      c.tabId = tab && tab.id;
      await setCampaign(c);
    }
  } else {
    c.finishedIndexes[c.index] = true;
    await setCampaign(c);
    await accountFinished(c.index);
  }
}

chrome.alarms.create('campaign-watchdog', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'campaign-watchdog') checkCampaignWatchdog();
});

// Si l'onglet piloté par la campagne est fermé manuellement, on en rouvre un
// à la prochaine action au lieu de rester bloqué sur un tabId mort.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const c = await getCampaign();
  if (c && c.running && c.tabId === tabId) {
    c.tabId = null;
    await setCampaign(c);
  }
});

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

// Identité du bot
const BRAND = 'TIGRE AIO';
const DEFAULT_LOGO =
  'https://cdn.discordapp.com/attachments/1023333501312962690/1545161251431121037/image-1788465467838.png?ex=6a9b230e&is=6a99d18e&hm=ca1e5b8efbcba2e08c9b185c0f1bad0faa31b8de25f6261a14500958ed23ac41&';

// Valeur affichée à la place de toute donnée confidentielle.
const HIDDEN = '///';

// Retire toute trace du site, des URLs et du nom des produits dans les textes
// libres : rien d'identifiable ne doit sortir dans le webhook.
function scrub(text) {
  if (!text) return text;
  return String(text)
    .replace(/https?:\/\/\S+/gi, HIDDEN)
    .replace(/\bwww\.\S+/gi, HIDDEN)
    .replace(/pokelite(\.fr)?/gi, HIDDEN)
    .replace(/pok[ée]mon/gi, HIDDEN);
}

function buildEmbed(payload, logoUrl) {
  const ts = payload.timestamp || Date.now();
  const { date, time, iso } = frDateTime(ts);
  const status = payload.status || 'info';
  const logo = logoUrl || DEFAULT_LOGO;

  const fields = [
    { name: '📧 Compte', value: `\`${payload.email || '—'}\``, inline: true },
    { name: '🌐 Site', value: 'private', inline: true },
    { name: '📌 Statut', value: STATUS_LABEL[status] || status, inline: true },
    { name: '🎁 Produit', value: HIDDEN, inline: true },
  ];

  if (payload.step) fields.push({ name: '🧩 Étape', value: scrub(payload.step), inline: true });
  if (payload.profileName)
    fields.push({ name: '👤 Identité', value: payload.profileName, inline: true });
  fields.push({ name: '🔌 Proxy', value: HIDDEN, inline: true });
  fields.push({ name: '📅 Date', value: date, inline: true });
  fields.push({ name: '⏰ Heure', value: `${time} (heure locale)`, inline: true });
  if (payload.progress) fields.push({ name: '📊 Avancement', value: payload.progress, inline: true });
  if (payload.detail) fields.push({ name: '📝 Détail', value: scrub(payload.detail).slice(0, 1000), inline: false });

  // Aucun lien n'est jamais publié : ni titre cliquable, ni champ « page ».
  const embed = {
    author: { name: BRAND, icon_url: logo },
    title: scrub(payload.title || STATUS_LABEL[status] || BRAND),
    color: COLORS[status] || COLORS.info,
    fields,
    thumbnail: { url: logo },
    footer: { text: `${BRAND} • ${payload.email || 'compte inconnu'}`, icon_url: logo },
    timestamp: iso,
  };
  if (payload.description) embed.description = scrub(payload.description).slice(0, 3800);

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
  const { webhookUrl, logoUrl } = await storage.get(['webhookUrl', 'logoUrl']);
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
    username: BRAND,
    avatar_url: logoUrl || DEFAULT_LOGO,
    embeds: [buildEmbed(payload, logoUrl)],
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

  if (msg.type === 'START_CAMPAIGN') {
    startCampaign().then(sendResponse);
    return true;
  }

  if (msg.type === 'STOP_CAMPAIGN') {
    stopCampaign().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_CAMPAIGN') {
    getCampaign().then((campaign) => sendResponse({ ok: true, campaign }));
    return true;
  }

  if (msg.type === 'CAMPAIGN_STAGE') {
    handleCampaignStage(msg.stage, msg.email, sender.tab && sender.tab.id).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
});
