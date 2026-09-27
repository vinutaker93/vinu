import { chromium } from 'playwright';
import { loadState, proxyForAccount } from '../config.js';
import { proxyLineToPlaywrightConfig } from '../proxy.js';
import { installPokeliteHelpers } from '../automation/detect.js';
import { contextOptionsForEmail, loadSessionMeta } from '../automation/session.js';

const RESULTS_URL = 'https://www.pokelite.fr/mon-compte/mes-tirages/';

// Restaure la session + le proxy d'un compte et ouvre une fenêtre visible sur
// « Mes tirages » pour vérification manuelle — équivalent du bouton
// 🔓 « Rouvrir ce compte » de l'extension Chrome.
export async function reopenCommand(email) {
  if (!email) {
    console.error('Usage : pokelite reopen <email>');
    process.exitCode = 1;
    return;
  }

  const meta = await loadSessionMeta(email);
  if (!meta) {
    console.error(`Aucune session sauvegardée pour ${email}.`);
    process.exitCode = 1;
    return;
  }
  if (!meta.loggedIn) {
    console.warn(`⚠️ La session sauvegardée pour ${email} ne semble pas connectée.`);
  }
  if (meta.expiresAt && meta.expiresAt < Date.now()) {
    console.warn(`⚠️ Session probablement expirée (depuis le ${new Date(meta.expiresAt).toLocaleString('fr-FR')}).`);
  } else if (meta.expiresAt) {
    console.log(`Session valide jusqu’au ${new Date(meta.expiresAt).toLocaleString('fr-FR')}.`);
  }

  const state = await loadState();
  const proxyLine = proxyForAccount(state, email);
  const proxy = proxyLineToPlaywrightConfig(proxyLine);
  const contextOptions = contextOptionsForEmail(email, proxy);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(installPokeliteHelpers);
  const page = await context.newPage();
  await page.goto(RESULTS_URL, { waitUntil: 'domcontentloaded' });

  console.log('Fenêtre ouverte sur « Mes tirages ». Ferme-la quand tu as terminé.');
  await new Promise((resolve) => browser.on('disconnected', resolve));
}
