import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { sessionPathForEmail } from '../config.js';

// Sauvegarde la session (cookies + storage) du contexte dans un fichier dédié
// au compte. Remplace le bricolage manuel de chrome.cookies de l'extension
// par le mécanisme natif de Playwright — Playwright écrit directement le
// fichier quand on lui passe `path`.
export async function saveSession(context, email) {
  const filePath = sessionPathForEmail(email);
  const state = await context.storageState({ path: filePath });
  return summarizeState(state);
}

// Options à passer à browser.newContext() pour reprendre une session
// sauvegardée (si elle existe) — sinon un contexte neuf.
export function contextOptionsForEmail(email, proxy) {
  const options = {};
  if (proxy) options.proxy = proxy;
  const filePath = sessionPathForEmail(email);
  if (existsSync(filePath)) options.storageState = filePath;
  return options;
}

export async function loadSessionMeta(email) {
  const filePath = sessionPathForEmail(email);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, 'utf8');
    return summarizeState(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

function summarizeState(state) {
  const cookies = (state && state.cookies) || [];
  const loggedIn = cookies.some((c) => c.name.indexOf('wordpress_logged_in_') === 0);
  const expiries = cookies.filter((c) => typeof c.expires === 'number' && c.expires > 0).map((c) => c.expires);
  const expiresAt = expiries.length ? Math.max(...expiries) * 1000 : null;
  return { cookieCount: cookies.length, loggedIn, expiresAt };
}
