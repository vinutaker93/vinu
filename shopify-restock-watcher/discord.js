/**
 * Rapports Discord — identité VINULOG.
 *
 * Chaque évènement notable (démarrage, détection du stock, ajout au panier,
 * échec, arrêt) part dans un embed contenant le site, l'article, le lien, la
 * date, l'heure et l'action effectuée, illustré par la caricature de lynx.
 *
 * L'image est envoyée en pièce jointe multipart et référencée via
 * `attachment://` : pas d'hébergement externe à maintenir, et le rapport reste
 * illustré même hors ligne côté CDN tiers.
 *
 * Le webhook n'est jamais appelé en boucle : les vérifications « toujours en
 * rupture » ne produisent aucun message, et le service worker déduplique les
 * évènements répétés (cf. background.js).
 */

const WEBHOOK_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com'
]);

const BRAND = 'VINULOG';
const LYNX_FILE = 'vinulog-lynx.png';
const LYNX_PATH = `assets/${LYNX_FILE}`;

const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 10_000;
const FIELD_MAX = 1024;

/** Libellé et couleur de chaque évènement. */
export const EVENTS = {
  watch_started: { title: '▶️ Surveillance démarrée', color: 0x2f6fed },
  in_stock: { title: '✅ Produit disponible', color: 0x1f7a34 },
  added_to_cart: { title: '🛒 Ajouté au panier', color: 0x1f7a34 },
  add_failed: { title: '❌ Ajout au panier refusé', color: 0xb3261e },
  watch_stopped: { title: '⏹ Surveillance arrêtée', color: 0x6b6b70 },
  test: { title: '🔔 Test du webhook', color: 0xf0b429 }
};

export function isWebhookUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    WEBHOOK_HOSTS.has(url.hostname) &&
    url.pathname.startsWith('/api/webhooks/')
  );
}

/** Origine à autoriser (chrome.permissions) pour appeler ce webhook. */
export function webhookOrigin(raw) {
  try {
    return `${new URL(raw).origin}/*`;
  } catch {
    return null;
  }
}

function field(name, value, inline = false) {
  if (!value) return null;
  return { name, value: String(value).slice(0, FIELD_MAX), inline };
}

export function buildPayload(event, context = {}) {
  const meta = EVENTS[event] || EVENTS.test;
  const { siteOrigin, productHandle, productTitle, variantTitle, checkoutUrl, detail } = context;

  const productUrl =
    siteOrigin && productHandle ? `${siteOrigin}/products/${productHandle}` : null;
  const site = siteOrigin ? new URL(siteOrigin).hostname : null;
  const article = [productTitle, variantTitle].filter(Boolean).join(' — ');
  const action = meta.title.replace(/^\S+\s/, ''); // le libellé sans son emoji

  const now = new Date();

  const fields = [
    field('Site', site, true),
    field('Article', article, true),
    field('Action', action),
    field('Date', now.toLocaleDateString('fr-FR'), true),
    field('Heure', now.toLocaleTimeString('fr-FR'), true),
    field('Lien', productUrl),
    field('Paiement', checkoutUrl),
    field('Détail', detail)
  ].filter(Boolean);

  return {
    // Pas d'avatar_url : `attachment://` n'est accepté que dans les embeds, et
    // une valeur invalide ferait rejeter tout le message (400). L'avatar du bot
    // reste celui configuré côté Discord.
    username: BRAND,
    embeds: [
      {
        author: { name: BRAND },
        title: meta.title,
        url: productUrl || undefined,
        color: meta.color,
        fields,
        image: { url: `attachment://${LYNX_FILE}` },
        timestamp: now.toISOString(),
        footer: { text: BRAND }
      }
    ]
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function lynxBlob() {
  try {
    const res = await fetch(chrome.runtime.getURL(LYNX_PATH));
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** Corps multipart (embed + image) ; JSON simple si l'image est introuvable. */
async function buildBody(payload) {
  const blob = await lynxBlob();

  if (!blob) {
    const fallback = structuredClone(payload);
    delete fallback.embeds[0].image;
    return {
      body: JSON.stringify(fallback),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', blob, LYNX_FILE);
  // Pas d'en-tête Content-Type : le navigateur pose la frontière multipart.
  return { body: form, headers: undefined };
}

async function retryAfterMs(res) {
  // Discord renvoie retry_after (secondes) dans le corps, et l'en-tête en repli.
  try {
    const body = await res.clone().json();
    if (typeof body.retry_after === 'number') {
      return Math.min(body.retry_after * 1000, MAX_RETRY_WAIT_MS);
    }
  } catch {
    // corps non-JSON : on retombe sur l'en-tête
  }
  const header = Number(res.headers.get('retry-after'));
  return Number.isFinite(header) ? Math.min(header * 1000, MAX_RETRY_WAIT_MS) : 1_000;
}

/**
 * Poste un rapport, avec reprise sur erreur réseau, 429 et 5xx.
 * Un 4xx autre que 429 (webhook supprimé, token invalide) n'est pas réessayé.
 */
export async function sendWebhook(webhookUrl, payload) {
  const { body, headers } = await buildBody(payload);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(webhookUrl, { method: 'POST', headers, body });

      if (res.ok) return { ok: true };

      if (res.status === 429) {
        await sleep(await retryAfterMs(res));
        continue;
      }

      if (res.status >= 500) {
        if (attempt === MAX_ATTEMPTS) return { ok: false, error: `HTTP ${res.status}` };
        await sleep(2 ** attempt * 500);
        continue;
      }

      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { ok: false, error: `webhook invalide (HTTP ${res.status})` };
      }

      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) return { ok: false, error: err.message };
      await sleep(2 ** attempt * 500);
    }
  }

  return { ok: false, error: 'échec après plusieurs tentatives' };
}

/** Construit puis envoie un rapport. */
export async function report(webhookUrl, event, context) {
  return sendWebhook(webhookUrl, buildPayload(event, context));
}
