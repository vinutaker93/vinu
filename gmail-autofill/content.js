// content.js — Gmail Autofill (a la demande)
//
// Remplit UNIQUEMENT le compte choisi par l'utilisateur, un compte a la fois.
// - N'enchaine jamais les comptes : apres le mot de passe, l'etat est efface
//   et le script n'agit plus tant que l'utilisateur ne choisit pas un autre
//   compte depuis le popup.
// - Ne touche JAMAIS la page de mail de recuperation : l'etape e-mail ne
//   cible que le champ identifiant de connexion (#identifierId), et une fois
//   le mot de passe soumis il n'y a plus d'etat en attente.
// - Aucun proxy, aucune tentative de masquer l'origine des connexions.

const PENDING_KEY = "pendingFill";
const MAX_AGE_MS = 2 * 60 * 1000; // ignore un etat en attente trop ancien

function isVisible(el) {
  return !!(el && el.offsetParent !== null && !el.disabled);
}

function nativeSetValue(el, value) {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function waitFor(selector, timeoutMs) {
  return new Promise((resolve) => {
    const now = document.querySelector(selector);
    if (now && isVisible(now)) return resolve(now);
    const start = Date.now();
    const timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        clearInterval(timer);
        resolve(el);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 200);
  });
}

function clickNext(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const btn = container.querySelector("button") || container;
  btn.click();
}

async function getPending() {
  const data = await chrome.storage.local.get(PENDING_KEY);
  const p = data[PENDING_KEY];
  if (!p) return null;
  if (Date.now() - (p.ts || 0) > MAX_AGE_MS) {
    await chrome.storage.local.remove(PENDING_KEY);
    return null;
  }
  return p;
}

let running = false;

async function processPending() {
  if (running) return;
  running = true;
  try {
    let pending = await getPending();
    if (!pending) return;

    // --- Etape e-mail : uniquement le champ identifiant de connexion. ---
    if (pending.step === "email") {
      const emailEl = await waitFor("#identifierId", 8000);
      if (!emailEl) return; // pas sur la page identifiant
      nativeSetValue(emailEl, pending.email);
      clickNext("#identifierNext");
      pending = { ...pending, step: "password", ts: Date.now() };
      await chrome.storage.local.set({ [PENDING_KEY]: pending });
      // La suite se joue soit dans ce meme run (SPA), soit apres rechargement
      // (le script relance processPending au chargement, etape "password").
    }

    // --- Etape mot de passe. ---
    if (pending.step === "password") {
      const passEl =
        (await waitFor('input[type="password"][name="Passwd"]', 8000)) ||
        (await waitFor('input[type="password"]', 2000));
      if (passEl) {
        nativeSetValue(passEl, pending.password);
        clickNext("#passwordNext");
      }
      // Termine. On efface l'etat : le script n'agira plus (ni sur le mail
      // de recuperation, ni sur un autre compte) sans une nouvelle action
      // explicite dans le popup.
      await chrome.storage.local.remove(PENDING_KEY);
    }
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.action === "fill") processPending();
});

// Reprise apres une transition de page (identifiant -> mot de passe).
processPending();
