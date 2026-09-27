import { chromium } from 'playwright';
import { RAFFLE_LINKS } from './raffleLinks.js';
import { randomFrenchName } from './names.js';
import { notifyDiscord } from './discord.js';
import { loadState, saveState, getAccountState, setAccountState, proxyForAccount } from './config.js';
import { proxyLineToPlaywrightConfig } from './proxy.js';
import { installPokeliteHelpers } from './automation/detect.js';
import { contextOptionsForEmail, saveSession } from './automation/session.js';
import * as account from './automation/account.js';

// Traite un compte de bout en bout dans son propre BrowserContext isolé —
// c'est ce qui permet à chaque compte d'avoir SON proxy, en parallèle avec
// les autres, sans jamais se marcher dessus (contrairement à l'extension
// Chrome, limitée à un seul proxy pour tout le navigateur). Comme chaque
// contexte est isolé, il n'y a même plus besoin de "déconnexion" entre
// comptes : chacun a son propre jeu de cookies dès le départ.
async function processOneAccount(browser, state, email) {
  const proxyLine = proxyForAccount(state, email);
  const proxy = proxyLineToPlaywrightConfig(proxyLine);
  const contextOptions = contextOptionsForEmail(email, proxy);

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(installPokeliteHelpers);
  const page = await context.newPage();

  try {
    await account.gotoAccountPage(page);
    let loggedIn = await account.isLoggedIn(page);

    if (!loggedIn) {
      const reg = await account.registerAccount(page, email);
      if (!reg.ok || !reg.submitBtnFound) {
        await notifyDiscord(state, {
          status: 'error',
          email,
          title: '❌ Formulaire d’inscription introuvable',
          step: 'Inscription',
          proxyLine,
        });
        return { email, ok: false, reason: 'no-register-form' };
      }

      await notifyDiscord(state, {
        status: 'info',
        email,
        title: '📝 Inscription envoyée',
        step: 'Inscription',
        proxyLine,
      });

      await account.gotoAccountPage(page);
      loggedIn = await account.isLoggedIn(page);
      if (!loggedIn) {
        await notifyDiscord(state, {
          status: 'error',
          email,
          title: '❌ Inscription non confirmée',
          step: 'Inscription',
          detail: 'Le compte ne semble pas connecté après l’envoi du formulaire.',
          proxyLine,
        });
        return { email, ok: false, reason: 'register-not-confirmed' };
      }
    }

    // Profil (prénom / nom)
    const accState = getAccountState(state, email);
    let name = accState.profileName;
    if (!accState.profileFilled) {
      if (!name) name = randomFrenchName();
      await account.gotoEditAccountPage(page);
      const profileResult = await account.fillProfile(page, name.firstName, name.lastName);
      const filled = !!(profileResult.ok && profileResult.currentFirst && profileResult.currentLast);
      setAccountState(state, email, { profileName: name, profileFilled: filled });
      await saveState(state);

      await notifyDiscord(state, {
        status: filled ? 'success' : 'warning',
        email,
        title: filled ? '👤 Profil enregistré' : '⚠️ Profil non confirmé',
        step: 'Prénom / nom',
        profileName: `${name.firstName} ${name.lastName}`,
        proxyLine,
      });
    }

    // Participations aux liens du tirage
    for (const url of RAFFLE_LINKS) {
      const fresh = getAccountState(state, email);
      if (fresh.done[url]) continue;

      const result = await account.participateOnUrl(page, url);
      const status = result.confirmed ? 'success' : result.clicked ? 'warning' : 'error';
      const doneState = { ...fresh.done, [url]: { at: Date.now(), state: status } };
      setAccountState(state, email, { done: doneState });
      await saveState(state);

      const progress = `${Object.keys(doneState).length}/${RAFFLE_LINKS.length} tirages`;
      await notifyDiscord(state, {
        status,
        email,
        title: result.confirmed
          ? '🎉 Participation confirmée'
          : result.clicked
          ? '📨 Participation envoyée (non confirmée)'
          : '❌ Case ou bouton introuvables',
        step: 'Participation',
        item: result.item,
        image: result.image,
        url,
        proxyLine,
        progress,
      });
    }

    await saveSession(context, email);
    const finalState = getAccountState(state, email);
    const doneCount = Object.keys(finalState.done).length;

    await notifyDiscord(state, {
      status: doneCount >= RAFFLE_LINKS.length ? 'success' : 'warning',
      email,
      title: doneCount >= RAFFLE_LINKS.length ? '✅ Compte terminé' : '⚠️ Compte incomplet',
      step: 'Fin de traitement',
      progress: `${doneCount}/${RAFFLE_LINKS.length} tirages`,
      proxyLine,
    });

    return { email, ok: true, doneCount };
  } finally {
    await context.close();
  }
}

export async function runCampaign({ concurrency = 3, headless = true } = {}) {
  const state = await loadState();
  if (state.accounts.length === 0) {
    console.log('Aucun compte enregistré. Utilise `pokelite accounts import <fichier>` d’abord.');
    return;
  }

  const pending = state.accounts
    .map((a) => a.email)
    .filter((email) => Object.keys(getAccountState(state, email).done).length < RAFFLE_LINKS.length);

  if (pending.length === 0) {
    console.log('Tous les comptes ont déjà terminé leurs participations. Voir `pokelite status`.');
    return;
  }

  console.log(`${pending.length} compte(s) à traiter, concurrence=${concurrency}.`);

  const browser = await chromium.launch({ headless });
  let cursor = 0;
  const results = [];

  async function worker() {
    while (cursor < pending.length) {
      const email = pending[cursor++];
      console.log(`[${email}] démarrage...`);
      try {
        const r = await processOneAccount(browser, state, email);
        results.push(r);
        console.log(`[${email}] ${r.ok ? 'terminé' : 'échec : ' + r.reason}`);
      } catch (err) {
        console.error(`[${email}] erreur inattendue : ${err.message}`);
        results.push({ email, ok: false, reason: err.message });
        try {
          await notifyDiscord(state, {
            status: 'error',
            email,
            title: '❌ Erreur inattendue',
            step: 'Traitement du compte',
            detail: err.message,
          });
        } catch (_) {}
      }
      await saveState(state);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  await browser.close();
  await saveState(state);

  const ok = results.filter((r) => r.ok).length;
  console.log(`Terminé : ${ok}/${results.length} compte(s) traité(s) avec succès.`);
}
