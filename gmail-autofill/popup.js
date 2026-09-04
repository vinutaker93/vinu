// popup.js — Gmail Autofill (a la demande)
//
// Gere la liste de comptes (stockee localement) et declenche le remplissage
// d'UN compte choisi. Aucune boucle, aucun enchainement automatique.

const importArea = document.getElementById("importArea");
const importBtn = document.getElementById("importBtn");
const clearBtn = document.getElementById("clearBtn");
const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");

const SIGNIN_URL = "https://accounts.google.com/signin/v2/identifier";

function status(msg) {
  statusEl.textContent = msg || "";
}

// Une ligne = un compte. Champs separes par ; , ou tabulation.
// Ordre attendu : email ; motdepasse ; mailderecuperation (le 3e est optionnel).
function parseList(text) {
  const accounts = [];
  text.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t) return;
    let parts = t.split(/[;,\t]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      parts = t.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    }
    if (parts.length < 2) return;
    const [email, password, recovery] = parts;
    accounts.push({ email, password, recovery: recovery || "" });
  });
  return accounts;
}

async function loadAccounts() {
  const data = await chrome.storage.local.get("accounts");
  return Array.isArray(data.accounts) ? data.accounts : [];
}

async function saveAccounts(accounts) {
  await chrome.storage.local.set({ accounts });
}

function render(accounts) {
  listEl.innerHTML = "";
  if (!accounts.length) {
    listEl.innerHTML =
      '<p style="font-size:11px;color:#5f6368;padding:8px 0;">Aucun compte enregistre.</p>';
    return;
  }
  accounts.forEach((acc) => {
    const row = document.createElement("div");
    row.className = "acct";

    const info = document.createElement("div");
    info.className = "email";
    info.textContent = acc.email;
    if (acc.recovery) {
      const rec = document.createElement("div");
      rec.className = "rec";
      rec.textContent = "recup : " + acc.recovery;
      info.appendChild(rec);
    }
    row.appendChild(info);

    if (acc.recovery) {
      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copier recup";
      copyBtn.title = "Copier le mail de recuperation (a coller a la main)";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(acc.recovery);
          status("Mail de recuperation copie.");
        } catch (e) {
          status("Copie impossible.");
        }
      });
      row.appendChild(copyBtn);
    }

    const fillBtn = document.createElement("button");
    fillBtn.className = "primary";
    fillBtn.textContent = "Remplir";
    fillBtn.addEventListener("click", () => fill(acc));
    row.appendChild(fillBtn);

    listEl.appendChild(row);
  });
}

async function fill(acc) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pending = {
    email: acc.email,
    password: acc.password,
    step: "email",
    ts: Date.now(),
  };

  const onSignin = tab && /^https:\/\/accounts\.google\.com\//.test(tab.url || "");

  if (onSignin) {
    await chrome.storage.local.set({ pendingFill: pending });
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "fill" });
    } catch (e) {
      // le content script se declenchera de lui-meme au chargement
    }
    status("Remplissage de " + acc.email + " ...");
    window.close();
  } else {
    // Ouvre la page de connexion ; le content script lira l'etat au chargement.
    await chrome.storage.local.set({ pendingFill: pending });
    await chrome.tabs.create({ url: SIGNIN_URL });
    status("Page de connexion ouverte, remplissage de " + acc.email + " ...");
    window.close();
  }
}

importBtn.addEventListener("click", async () => {
  const accounts = parseList(importArea.value);
  if (!accounts.length) {
    status("Aucune ligne valide (attendu : email;motdepasse;mailrecup).");
    return;
  }
  await saveAccounts(accounts);
  render(accounts);
  importArea.value = "";
  status(accounts.length + " compte(s) enregistre(s).");
});

clearBtn.addEventListener("click", async () => {
  await saveAccounts([]);
  render([]);
  status("Liste videe.");
});

(async () => {
  render(await loadAccounts());
})();
