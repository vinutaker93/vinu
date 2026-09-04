const els = {
  productUrl: document.getElementById('productUrl'),
  loadBtn: document.getElementById('loadBtn'),
  variantRow: document.getElementById('variantRow'),
  variantSelect: document.getElementById('variantSelect'),
  pollSeconds: document.getElementById('pollSeconds'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  status: document.getElementById('status'),
  log: document.getElementById('log')
};

const DEFAULT_POLL_SECONDS = 5;

/** Extrait l'origine et le handle d'une URL de page produit Shopify. */
function parseProductUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const match = url.pathname.match(/\/products\/([^/?#]+)/);
  if (!match) return null;

  return { origin: url.origin, handle: match[1] };
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function renderVariants(variants, selectedId) {
  els.variantSelect.replaceChildren();

  for (const variant of variants) {
    const option = document.createElement('option');
    option.value = String(variant.id);
    option.textContent = `${variant.title} — ${variant.available ? 'en stock' : 'rupture'}`;
    if (selectedId != null && variant.id === selectedId) option.selected = true;
    els.variantSelect.append(option);
  }

  els.variantRow.hidden = variants.length === 0;
}

function renderWatchingUI(watching, state = {}) {
  els.startBtn.hidden = watching;
  els.stopBtn.hidden = !watching;
  els.loadBtn.disabled = watching;
  els.productUrl.disabled = watching;
  els.variantSelect.disabled = watching;
  els.pollSeconds.disabled = watching;

  if (watching) {
    const label = [state.productTitle, state.variantTitle].filter(Boolean).join(' — ');
    setStatus(`🔍 Surveillance active${label ? ` : ${label}` : ''}`);
  }
}

async function renderLog() {
  const { logEntries = [] } = await chrome.storage.local.get('logEntries');
  els.log.replaceChildren();

  for (const entry of logEntries) {
    const line = document.createElement('div');
    line.className = 'log-entry';
    line.textContent = entry;
    els.log.append(line);
  }
}

async function restore() {
  const state = await chrome.storage.local.get([
    'watching',
    'siteOrigin',
    'productHandle',
    'variantId',
    'variantTitle',
    'productTitle',
    'pollSeconds',
    'variants'
  ]);

  if (state.siteOrigin && state.productHandle) {
    els.productUrl.value = `${state.siteOrigin}/products/${state.productHandle}`;
  }
  els.pollSeconds.value = state.pollSeconds || DEFAULT_POLL_SECONDS;

  if (Array.isArray(state.variants) && state.variants.length > 0) {
    renderVariants(state.variants, state.variantId);
  }

  renderWatchingUI(Boolean(state.watching), state);
  if (!state.watching) {
    setStatus(state.productTitle ? `Prêt : ${state.productTitle}` : 'Inactif');
  }

  await renderLog();
}

els.loadBtn.addEventListener('click', async () => {
  const parsed = parseProductUrl(els.productUrl.value.trim());
  if (!parsed) {
    setStatus("URL invalide. Attendu : https://boutique.com/products/le-produit", true);
    return;
  }

  const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
  if (!granted) {
    setStatus('Permission refusée pour ce site — impossible de le surveiller.', true);
    return;
  }

  els.loadBtn.disabled = true;
  setStatus('Chargement du produit…');

  try {
    const res = await fetch(`${parsed.origin}/products/${parsed.handle}.js`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const product = await res.json();
    const variants = product.variants.map((v) => ({
      id: v.id,
      title: v.title,
      available: Boolean(v.available)
    }));

    await chrome.storage.local.set({
      siteOrigin: parsed.origin,
      productHandle: parsed.handle,
      productTitle: product.title,
      variants
    });

    renderVariants(variants);
    setStatus(`Produit chargé : ${product.title}`);
  } catch (err) {
    setStatus(`Chargement impossible : ${err.message}`, true);
  } finally {
    els.loadBtn.disabled = false;
  }
});

els.startBtn.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get([
    'siteOrigin',
    'productHandle',
    'productTitle',
    'variants'
  ]);

  if (!stored.siteOrigin || !stored.productHandle) {
    setStatus("Charge d'abord un produit.", true);
    return;
  }

  const variantId = Number(els.variantSelect.value);
  if (!variantId) {
    setStatus('Sélectionne une variante.', true);
    return;
  }

  const variant = (stored.variants || []).find((v) => v.id === variantId);
  const pollSeconds = Math.min(60, Math.max(2, Number(els.pollSeconds.value) || DEFAULT_POLL_SECONDS));

  // Réutilise l'onglet courant s'il est déjà sur la boutique, sinon le service
  // worker en ouvrira un en arrière-plan.
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = activeTab?.url?.startsWith(stored.siteOrigin) ? activeTab.id : null;

  await chrome.storage.local.set({
    variantId,
    variantTitle: variant?.title || '',
    pollSeconds,
    tabId,
    logEntries: []
  });

  await chrome.runtime.sendMessage({ type: 'START_WATCHING' });
  renderWatchingUI(true, { productTitle: stored.productTitle, variantTitle: variant?.title });
});

els.stopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_WATCHING' });
  renderWatchingUI(false);
  setStatus('Inactif');
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;

  if (changes.logEntries) await renderLog();

  if (changes.watching) {
    const state = await chrome.storage.local.get(['productTitle', 'variantTitle']);
    const watching = Boolean(changes.watching.newValue);
    renderWatchingUI(watching, state);
    if (!watching) setStatus('🛒 Terminé — le paiement est à compléter dans l’onglet ouvert.');
  }
});

restore();
