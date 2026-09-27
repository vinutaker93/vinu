const $ = (id) => document.getElementById(id);

// Logo TIGRE AIO par défaut (modifiable dans le popup).
const DEFAULT_LOGO =
  'https://cdn.discordapp.com/attachments/1023333501312962690/1545161251431121037/image-1788465467838.png?ex=6a9b230e&is=6a99d18e&hm=ca1e5b8efbcba2e08c9b185c0f1bad0faa31b8de25f6261a14500958ed23ac41&';

const emailEl = $('email');
const emailSelectEl = $('emailSelect');
const activeProxyInfoEl = $('activeProxyInfo');
const sessionInfoEl = $('sessionInfo');
const webhookEl = $('webhook');
const logoEl = $('logo');
const emailFileEl = $('emailFile');
const passwordFileEl = $('passwordFile');
const passwordTextEl = $('passwordText');
const passwordCountEl = $('passwordCount');
const proxyFileEl = $('proxyFile');
const proxyTextEl = $('proxyText');
const proxyCountEl = $('proxyCount');
const autoProxyEl = $('autoProxy');
const statusEl = $('status');

function flashStatus(text, ms = 2000) {
  statusEl.textContent = text;
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => (statusEl.textContent = ''), ms);
}

const store = {
  get: (keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
  set: (obj) => new Promise((r) => chrome.storage.local.set(obj, r)),
};

// État : accounts = [{ email }], proxyLines = ['ligne1', 'ligne2', ...],
// passwordLines = ['mdp1', 'mdp2', ...]. Le proxy/mot de passe d'un compte =
// proxyLines[index]/passwordLines[index] du compte. Ces deux listes sont
// stockées séparément des comptes : elles survivent à tout changement de
// compte (même principe pour les deux, même bug évité).
async function loadAll() {
  const data = await store.get([
    'myEmail',
    'accounts',
    'savedEmails',
    'webhookUrl',
    'logoUrl',
    'proxyLines',
    'passwordLines',
    'autoApplyProxy',
  ]);

  let accounts = data.accounts;
  if (!accounts) {
    const emails = data.savedEmails || (data.myEmail ? [data.myEmail] : []);
    accounts = emails.map((email) => ({ email }));
  }

  let proxyLines = data.proxyLines;
  if (!proxyLines) {
    // migration depuis l'ancien format (proxy stocké dans chaque compte)
    proxyLines = accounts.map((a) => a.proxy || '').filter(Boolean);
  }

  const passwordLines = data.passwordLines || [];

  return {
    myEmail: data.myEmail || '',
    accounts,
    proxyLines,
    passwordLines,
    webhookUrl: data.webhookUrl || '',
    logoUrl: data.logoUrl || DEFAULT_LOGO,
    autoApplyProxy: data.autoApplyProxy !== false,
  };
}

function proxyFor(accounts, proxyLines, email) {
  const i = accounts.findIndex((a) => a.email === email);
  if (i === -1) return '';
  return proxyLines[i] || '';
}

function passwordFor(accounts, passwordLines, email) {
  const i = accounts.findIndex((a) => a.email === email);
  if (i === -1) return '';
  return passwordLines[i] || '';
}

function render({ myEmail, accounts, proxyLines, passwordLines }) {
  emailSelectEl.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— aucun —';
  emailSelectEl.appendChild(empty);

  accounts.forEach((acc, i) => {
    const opt = document.createElement('option');
    opt.value = acc.email;
    const tags = [proxyLines[i] ? 'proxy' : '', passwordLines[i] ? 'mdp' : ''].filter(Boolean);
    opt.textContent = `${i + 1}. ${acc.email}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    emailSelectEl.appendChild(opt);
  });

  const exists = accounts.some((a) => a.email === myEmail);
  emailSelectEl.value = exists ? myEmail : '';
  const p = proxyFor(accounts, proxyLines, myEmail);
  activeProxyInfoEl.textContent = `Proxy : ${p || '—'}`;
  proxyCountEl.textContent = `${proxyLines.length} proxy(s) enregistré(s) · ${accounts.length} compte(s).`;
  proxyTextEl.value = proxyLines.join('\n');
  passwordCountEl.textContent = `${passwordLines.filter(Boolean).length} mot(s) de passe enregistré(s) · ${accounts.length} compte(s).`;
  passwordTextEl.value = passwordLines.join('\n');
  refreshSessionInfo(myEmail);
  refreshRaffleButtonLabel();
}

// --- Sessions -----------------------------------------------------------
function humanDelay(ms) {
  const h = Math.round(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}

function refreshSessionInfo(email) {
  if (!email) {
    sessionInfoEl.textContent = 'Session : —';
    return;
  }
  chrome.runtime.sendMessage({ type: 'GET_SESSIONS' }, (res) => {
    const s = res && res.sessions && res.sessions[email];
    if (!s) {
      sessionInfoEl.textContent = 'Session : aucune sauvegarde';
      return;
    }
    if (!s.loggedIn) {
      sessionInfoEl.textContent = 'Session : sauvegardée mais NON connectée';
      return;
    }
    const left = s.expiresAt ? s.expiresAt - Date.now() : null;
    if (left === null) {
      sessionInfoEl.textContent = 'Session : sauvegardée (durée inconnue)';
    } else if (left <= 0) {
      sessionInfoEl.textContent = 'Session : ⚠️ expirée';
    } else {
      sessionInfoEl.textContent = `Session : ✅ valide encore ~${humanDelay(left)}`;
    }
  });
}

async function refresh() {
  const state = await loadAll();
  render(state);
  return state;
}

(async function init() {
  const state = await refresh();
  emailEl.value = state.myEmail;
  webhookEl.value = state.webhookUrl;
  logoEl.value = state.logoUrl;
  autoProxyEl.checked = state.autoApplyProxy;
  // On persiste la forme normalisée dès l'ouverture (migration incluse).
  await store.set({
    accounts: state.accounts,
    proxyLines: state.proxyLines,
    passwordLines: state.passwordLines,
    logoUrl: state.logoUrl,
  });
})();

// --- Comptes ------------------------------------------------------------
$('save').addEventListener('click', async () => {
  const email = emailEl.value.trim();
  const webhookUrl = webhookEl.value.trim();
  const { accounts, proxyLines, passwordLines } = await loadAll();
  if (email && !accounts.some((a) => a.email === email)) accounts.push({ email });
  await store.set({
    myEmail: email,
    accounts,
    webhookUrl,
    logoUrl: logoEl.value.trim() || DEFAULT_LOGO,
    autoApplyProxy: autoProxyEl.checked,
  });
  render({ myEmail: email, accounts, proxyLines, passwordLines });
  flashStatus('Sauvegardé.', 1500);
});

emailSelectEl.addEventListener('change', async () => {
  const email = emailSelectEl.value;
  if (!email) return;
  emailEl.value = email;
  const { accounts, proxyLines, passwordLines } = await loadAll();
  // NOTE : on ne touche jamais à proxyLines/passwordLines ici — c'est ce qui
  // effaçait ces listes à chaque changement de compte.
  await store.set({ myEmail: email });
  render({ myEmail: email, accounts, proxyLines, passwordLines });

  const proxy = proxyFor(accounts, proxyLines, email);
  if (autoProxyEl.checked && proxy) {
    chrome.runtime.sendMessage({ type: 'APPLY_PROXY', proxy }, (res) => {
      flashStatus(res && res.ok ? `Compte actif : ${email} · proxy ${proxy}` : 'Proxy : erreur.', 2500);
    });
  } else {
    flashStatus(`Compte actif : ${email}`);
  }
});

$('restoreSession').addEventListener('click', () => {
  const email = emailSelectEl.value || emailEl.value.trim();
  if (!email) return flashStatus('Sélectionne d’abord un compte.');
  chrome.runtime.sendMessage({ type: 'RESTORE_SESSION', email }, (res) => {
    if (!res || !res.ok) return flashStatus((res && res.error) || 'Restauration impossible.', 3000);
    flashStatus(
      res.expired
        ? `Session restaurée (${res.restored}/${res.total}) mais expirée — tu seras sûrement déconnecté.`
        : `Session restaurée : ${res.restored}/${res.total} cookies.`,
      3500
    );
    refresh();
  });
});

$('saveSession').addEventListener('click', () => {
  const email = emailSelectEl.value || emailEl.value.trim();
  if (!email) return flashStatus('Sélectionne d’abord un compte.');
  chrome.runtime.sendMessage({ type: 'SAVE_SESSION', email }, (res) => {
    if (!res || !res.ok) return flashStatus((res && res.error) || 'Sauvegarde impossible.', 3000);
    flashStatus(
      res.loggedIn
        ? `Session sauvegardée (${res.count} cookies) pour ${email}.`
        : `⚠️ ${res.count} cookies sauvegardés, mais aucun cookie de connexion : tu n'es pas connecté sur ce compte.`,
      4000
    );
    refreshSessionInfo(email);
  });
});

$('deleteEmail').addEventListener('click', async () => {
  const toRemove = emailSelectEl.value;
  if (!toRemove) return flashStatus('Sélectionne un compte à supprimer.');
  const { myEmail, accounts, proxyLines, passwordLines } = await loadAll();
  const idx = accounts.findIndex((a) => a.email === toRemove);
  if (idx === -1) return;
  accounts.splice(idx, 1);
  // Le proxy et le mot de passe de la même ligne partent avec le compte pour
  // garder l'alignement.
  if (idx < proxyLines.length) proxyLines.splice(idx, 1);
  if (idx < passwordLines.length) passwordLines.splice(idx, 1);
  const newActive = myEmail === toRemove ? (accounts[0] ? accounts[0].email : '') : myEmail;
  emailEl.value = newActive;
  await store.set({ accounts, proxyLines, passwordLines, myEmail: newActive });
  render({ myEmail: newActive, accounts, proxyLines, passwordLines });
  flashStatus('Compte supprimé.', 1500);
});

emailFileEl.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const text = String(reader.result || '');
    const matches = text.match(/[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/g);
    if (!matches) return flashStatus('Aucun email trouvé dans le fichier.');
    const found = Array.from(new Set(matches.map((m) => m.trim())));

    const { myEmail, accounts, proxyLines, passwordLines } = await loadAll();
    let added = 0;
    found.forEach((email) => {
      if (!accounts.some((a) => a.email === email)) {
        accounts.push({ email });
        added++;
      }
    });
    const activeEmail = myEmail || found[0];
    emailEl.value = activeEmail;
    await store.set({ accounts, myEmail: activeEmail });
    render({ myEmail: activeEmail, accounts, proxyLines, passwordLines });
    flashStatus(`${found.length} email(s) trouvé(s), ${added} ajouté(s).`, 2500);
  };
  reader.onerror = () => flashStatus('Impossible de lire le fichier.');
  reader.readAsText(file);
});

// --- Proxies ------------------------------------------------------------
function parseProxyText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

async function saveProxyLines(lines, label) {
  if (lines.length === 0) return flashStatus('Aucun proxy trouvé.');
  const { myEmail, accounts, passwordLines } = await loadAll();
  await store.set({ proxyLines: lines });
  render({ myEmail, accounts, proxyLines: lines, passwordLines });

  const extra = lines.length - accounts.length;
  flashStatus(
    `${label} : ${Math.min(lines.length, accounts.length)} proxy(s) associé(s) ligne par ligne.` +
      (extra > 0 ? ` ${extra} en réserve pour les prochains emails.` : ''),
    3500
  );
}

// --- Mots de passe (comptes perso / famille) -----------------------------
// Même principe que les proxies : liste stockée séparément des comptes,
// associée ligne à ligne. Utilisée par content.js pour se connecter
// directement au lieu d'inscrire un nouveau compte, quand un mot de passe
// est connu pour l'email actif.
function parsePasswordText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ''))
    .map((l) => l.trim());
}

async function savePasswordLines(lines, label) {
  const { myEmail, accounts, proxyLines } = await loadAll();
  await store.set({ passwordLines: lines });
  render({ myEmail, accounts, proxyLines, passwordLines: lines });

  const set = lines.filter(Boolean).length;
  flashStatus(`${label} : ${set} mot(s) de passe associé(s) ligne par ligne.`, 3000);
}

proxyFileEl.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => saveProxyLines(parseProxyText(reader.result), 'Import');
  reader.onerror = () => flashStatus('Impossible de lire le fichier.');
  reader.readAsText(file);
});

$('saveProxies').addEventListener('click', () => {
  saveProxyLines(parseProxyText(proxyTextEl.value), 'Liste enregistrée');
});

$('clearProxies').addEventListener('click', async () => {
  const { myEmail, accounts, passwordLines } = await loadAll();
  await store.set({ proxyLines: [] });
  render({ myEmail, accounts, proxyLines: [], passwordLines });
  flashStatus('Liste de proxies vidée.', 1500);
});

passwordFileEl.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => savePasswordLines(parsePasswordText(reader.result), 'Import');
  reader.onerror = () => flashStatus('Impossible de lire le fichier.');
  reader.readAsText(file);
});

$('savePasswords').addEventListener('click', () => {
  savePasswordLines(parsePasswordText(passwordTextEl.value), 'Liste enregistrée');
});

$('clearPasswords').addEventListener('click', async () => {
  const { myEmail, accounts, proxyLines } = await loadAll();
  await store.set({ passwordLines: [] });
  render({ myEmail, accounts, proxyLines, passwordLines: [] });
  flashStatus('Liste de mots de passe vidée.', 1500);
});

$('applyProxy').addEventListener('click', async () => {
  const { myEmail, accounts, proxyLines } = await loadAll();
  const proxy = proxyFor(accounts, proxyLines, myEmail);
  if (!proxy) return flashStatus('Aucun proxy associé à ce compte.');
  chrome.runtime.sendMessage({ type: 'APPLY_PROXY', proxy }, (res) => {
    flashStatus(res && res.ok ? `Proxy actif : ${proxy}` : 'Erreur en appliquant le proxy.', 2500);
  });
});

$('clearProxy').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_PROXY' }, () =>
    flashStatus('Proxy désactivé, connexion directe.', 1500)
  );
});

autoProxyEl.addEventListener('change', () => {
  store.set({ autoApplyProxy: autoProxyEl.checked });
});

// --- Webhook ------------------------------------------------------------
$('testWebhook').addEventListener('click', async () => {
  const webhookUrl = webhookEl.value.trim();
  if (!webhookUrl) return flashStatus('Renseigne d’abord l’URL du webhook.');
  await store.set({ webhookUrl, logoUrl: logoEl.value.trim() || DEFAULT_LOGO });
  const { myEmail } = await loadAll();
  chrome.runtime.sendMessage(
    {
      type: 'NOTIFY_DISCORD',
      payload: {
        status: 'info',
        title: '🔔 Test du webhook',
        step: 'Test manuel',
        email: myEmail || '—',
        item: 'Message de test',
        description: 'Si tu vois ce message, le webhook Discord est correctement configuré.',
      },
    },
    (res) => flashStatus(res && res.ok ? 'Webhook OK ✅' : 'Échec du webhook (mis en file d’attente).', 3000)
  );
});

$('flushWebhook').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FLUSH_DISCORD' }, () =>
    flashStatus('File d’attente Discord renvoyée.', 2000)
  );
});

// --- Divers -------------------------------------------------------------
// Nombre de liens du tirage, affiché en direct sur le bouton — dérivé de
// RAFFLE_LINKS (background.js), jamais recopié en dur ici.
function refreshRaffleButtonLabel() {
  chrome.runtime.sendMessage({ type: 'GET_RAFFLE_LINKS' }, (res) => {
    const count = (res && res.links && res.links.length) || 0;
    $('openLinks').textContent = count ? `Ouvrir les ${count} liens du tirage` : 'Ouvrir les liens du tirage';
  });
}

$('openLinks').addEventListener('click', async () => {
  const { myEmail } = await loadAll();
  chrome.runtime.sendMessage({ type: 'OPEN_RAFFLE_LINKS', email: myEmail }, () =>
    flashStatus('Ouverture des liens du tirage...')
  );
});

$('resetTracking').addEventListener('click', async () => {
  const { myEmail } = await loadAll();
  const data = await store.get(['doneByEmail', 'raffleOpenedByEmail']);
  const doneByEmail = data.doneByEmail || {};
  const raffleOpenedByEmail = data.raffleOpenedByEmail || {};
  delete doneByEmail[myEmail];
  delete raffleOpenedByEmail[myEmail];
  await store.set({ doneByEmail, raffleOpenedByEmail });
  flashStatus(`Suivi réinitialisé pour ${myEmail || 'ce compte'}.`, 2000);
});

// --- Campagne multi-comptes ----------------------------------------------
const campaignStatusEl = $('campaignStatus');

function describeCampaign(c) {
  if (!c) return 'Aucune campagne en cours.';
  const total = c.accounts.length;

  if (!c.running) {
    if (c.phase === 'done') return `Campagne terminée : ${total}/${total} comptes traités.`;
    if (c.phase === 'stopped') return `Campagne arrêtée : ${c.index}/${total} comptes traités.`;
    return `Campagne interrompue : ${c.index}/${total} comptes traités.`;
  }

  const acc = c.accounts[c.index];
  const label = c.phase === 'logout' ? 'déconnexion en cours...' : 'inscription / participations en cours...';
  return `Compte ${c.index + 1}/${total} — ${acc ? acc.email : '?'} — ${label}`;
}

function refreshCampaignStatus() {
  chrome.runtime.sendMessage({ type: 'GET_CAMPAIGN' }, (res) => {
    campaignStatusEl.textContent = describeCampaign(res && res.campaign);
  });
}

refreshCampaignStatus();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.campaign) refreshCampaignStatus();
});

$('startCampaign').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START_CAMPAIGN' }, (res) => {
    if (res && res.ok) flashStatus(`Campagne lancée pour ${res.count} compte(s).`, 2500);
    else flashStatus((res && res.error) || 'Erreur au lancement de la campagne.', 3000);
    refreshCampaignStatus();
  });
});

$('stopCampaign').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_CAMPAIGN' }, () => {
    flashStatus('Campagne arrêtée.', 1500);
    refreshCampaignStatus();
  });
});
