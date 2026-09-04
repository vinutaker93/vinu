/**
 * Shopify Restock Watcher — service worker
 *
 * Rôle : interroger périodiquement l'API publique d'une boutique Shopify
 * (`/products/<handle>.js`) pour savoir si une variante précise est de nouveau
 * en stock. Dès qu'elle l'est : ajout au panier (`/cart/add.js`) puis ouverture
 * de la page de paiement.
 *
 * L'extension s'arrête là : elle ne lit, ne remplit et ne stocke AUCUNE donnée
 * de paiement. Le formulaire de checkout est rempli par l'utilisateur, ou par
 * l'autofill natif de Chrome (Paramètres → Saisie automatique → Moyens de paiement).
 *
 * Détail d'implémentation important : les requêtes réseau ne sont pas émises
 * depuis ce service worker mais injectées dans l'onglet de la boutique via
 * chrome.scripting. Une requête partie du worker serait considérée comme
 * cross-site et n'emporterait pas les cookies SameSite de Shopify — le panier
 * serait alors créé dans une session anonyme, invisible depuis l'onglet.
 */

import { report } from './discord.js';

const ALARM_NAME = 'restock-poll';

// chrome.alarms ne descend pas sous la minute : chaque réveil enchaîne donc une
// rafale de vérifications rapprochées pendant ~55 s, puis rend la main.
const BURST_DURATION_MS = 55_000;
const MIN_POLL_MS = 2_000;
const DEFAULT_POLL_SECONDS = 5;
const MAX_LOG_ENTRIES = 30;

const STATE_KEYS = [
  'watching',
  'siteOrigin',
  'productHandle',
  'variantId',
  'variantTitle',
  'productTitle',
  'pollSeconds',
  'tabId',
  'notified'
];

let burstRunning = false;

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  runBurst();
});

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runBurst();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_WATCHING') {
    (async () => {
      // `notified` repart à zéro : les rapports Discord sont dédupliqués par
      // session de surveillance, pas sur toute la vie de l'extension.
      await chrome.storage.local.set({ watching: true, notified: {} });
      await addLog('▶️ Surveillance démarrée.');
      ensureAlarm();
      notifyDiscord('watch_started', await getState());
      runBurst(); // volontairement non attendu : la rafale dure ~55 s
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'STOP_WATCHING') {
    (async () => {
      const state = await getState();
      await chrome.storage.local.set({ watching: false });
      await addLog('⏹ Surveillance arrêtée.');
      notifyDiscord('watch_stopped', state);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'CHECK_NOW') {
    (async () => {
      const state = await getState();
      await checkOnce(state);
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});

function getState() {
  return chrome.storage.local.get(STATE_KEYS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function addLog(message) {
  const { logEntries = [] } = await chrome.storage.local.get('logEntries');
  const stamped = `[${new Date().toLocaleTimeString('fr-FR')}] ${message}`;
  await chrome.storage.local.set({
    logEntries: [stamped, ...logEntries].slice(0, MAX_LOG_ENTRIES)
  });
}

/**
 * Une rafale de vérifications, déclenchée à chaque réveil de l'alarme.
 * Chaque tour fait au moins un appel d'API extension, ce qui repousse le délai
 * d'inactivité de 30 s au terme duquel Chrome tuerait le service worker.
 */
async function runBurst() {
  if (burstRunning) return;

  const initial = await getState();
  if (!initial.watching) return;

  burstRunning = true;
  try {
    const intervalMs = Math.max(
      MIN_POLL_MS,
      (initial.pollSeconds || DEFAULT_POLL_SECONDS) * 1000
    );
    const deadline = Date.now() + BURST_DURATION_MS;

    while (Date.now() < deadline) {
      const state = await getState();
      if (!state.watching) break;

      const stop = await checkOnce(state);
      if (stop) break;

      await sleep(intervalMs);
    }
  } finally {
    burstRunning = false;
  }
}

/**
 * @returns {Promise<boolean>} true si la surveillance doit s'arrêter
 *   (produit trouvé et ajouté au panier).
 */
async function checkOnce(state) {
  const { siteOrigin, productHandle, variantId, productTitle } = state;

  if (!siteOrigin || !productHandle || !variantId) {
    await addLog('⚠️ Configuration incomplète — recharge le produit dans le popup.');
    await chrome.storage.local.set({ watching: false });
    await notifyDiscord('watch_stopped', state, { detail: 'Configuration incomplète.' });
    return true;
  }

  let tabId;
  try {
    tabId = await ensureShopTab(state);
  } catch (err) {
    await addLog(`⚠️ Onglet boutique indisponible : ${err.message}`);
    return false;
  }

  const check = await runInTab(tabId, pageCheckStock, [siteOrigin, productHandle, variantId]);

  if (!check || !check.ok) {
    await addLog(`⚠️ Vérification impossible : ${check?.error || 'erreur inconnue'}`);
    return false;
  }

  if (!check.available) {
    await addLog('⏳ Toujours en rupture.');
    return false;
  }

  await addLog('✅ En stock ! Ajout au panier…');

  const notified = state.notified || {};
  if (!notified.inStock) {
    await chrome.storage.local.set({ notified: { ...notified, inStock: true } });
    await notifyDiscord('in_stock', state);
  }

  const added = await runInTab(tabId, pageAddToCart, [siteOrigin, variantId]);

  if (!added || !added.ok) {
    const reason = added?.error || 'erreur inconnue';
    await addLog(`❌ Ajout au panier refusé : ${reason}`);

    // Un même refus se répète à chaque tour : on ne rapporte que du nouveau.
    const flags = (await getState()).notified || {};
    if (flags.failReason !== reason) {
      await chrome.storage.local.set({ notified: { ...flags, failReason: reason } });
      await notifyDiscord('add_failed', state, { detail: reason });
    }
    return false; // souvent une rupture entre-temps : on continue de surveiller
  }

  await chrome.storage.local.set({ watching: false });
  await addLog('🛒 Ajouté au panier — ouverture du paiement. À toi de jouer.');

  await openCheckout(tabId, siteOrigin);
  notify(productTitle);
  await notifyDiscord('added_to_cart', state, { checkoutUrl: `${siteOrigin}/checkout` });

  return true;
}

/** Envoie un rapport VINULOG si un webhook est configuré et actif. */
async function notifyDiscord(event, state = {}, extra = {}) {
  const { discordWebhook, discordEnabled } = await chrome.storage.local.get([
    'discordWebhook',
    'discordEnabled'
  ]);
  if (!discordEnabled || !discordWebhook) return;

  const result = await report(discordWebhook, event, {
    siteOrigin: state.siteOrigin,
    productHandle: state.productHandle,
    productTitle: state.productTitle,
    variantTitle: state.variantTitle,
    ...extra
  });

  if (!result.ok) await addLog(`⚠️ Discord : ${result.error}`);
}

/**
 * Exécute une fonction dans le contexte de l'onglet boutique et renvoie son
 * résultat. Les fonctions injectées doivent être autonomes : elles sont
 * sérialisées, donc elles ne peuvent pas capturer de variables extérieures.
 */
async function runInTab(tabId, func, args) {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return injection?.result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Garantit un onglet ouvert sur l'origine de la boutique — nécessaire pour que
 * les requêtes partent avec les cookies de session du site.
 */
async function ensureShopTab(state) {
  const { tabId, siteOrigin, productHandle } = state;

  if (tabId != null) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith(siteOrigin)) return tab.id;
    } catch {
      // onglet fermé entre-temps : on en rouvre un ci-dessous
    }
  }

  const tab = await chrome.tabs.create({
    url: `${siteOrigin}/products/${productHandle}`,
    active: false
  });
  await chrome.storage.local.set({ tabId: tab.id });

  // Laisse la page charger avant la première injection.
  await sleep(1_500);
  return tab.id;
}

async function openCheckout(tabId, siteOrigin) {
  try {
    await chrome.tabs.update(tabId, { url: `${siteOrigin}/checkout`, active: true });
    const tab = await chrome.tabs.get(tabId);
    if (tab?.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (err) {
    await addLog(`⚠️ Ouverture du paiement impossible : ${err.message}`);
  }
}

function notify(productTitle) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Produit disponible !',
    message: `${productTitle || 'Le produit'} est dans ton panier. Termine le paiement toi-même.`,
    priority: 2
  });
}

/* ------------------------------------------------------------------ */
/* Fonctions injectées dans la page de la boutique (contexte du site)  */
/* ------------------------------------------------------------------ */

function pageCheckStock(siteOrigin, productHandle, variantId) {
  return fetch(`${siteOrigin}/products/${productHandle}.js`, { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((product) => {
      const variant = product.variants.find((v) => v.id === variantId);
      if (!variant) throw new Error('variante introuvable');
      return { ok: true, available: Boolean(variant.available) };
    })
    .catch((err) => ({ ok: false, error: err.message }));
}

function pageAddToCart(siteOrigin, variantId) {
  return fetch(`${siteOrigin}/cart/add.js`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] })
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text();
        let reason = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(body);
          reason = parsed.description || parsed.message || reason;
        } catch {
          // réponse non-JSON : on garde le code HTTP
        }
        throw new Error(reason);
      }
      return { ok: true };
    })
    .catch((err) => ({ ok: false, error: err.message }));
}
