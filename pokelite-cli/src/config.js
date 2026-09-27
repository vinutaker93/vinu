import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Équivalent de chrome.storage.local : tout vit dans ~/.pokelite-helper/
// (surchargeable via POKELITE_HOME, utilisé par les tests).
export const CONFIG_DIR = process.env.POKELITE_HOME || path.join(os.homedir(), '.pokelite-helper');
export const STATE_PATH = path.join(CONFIG_DIR, 'state.json');
export const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
export const DISCORD_QUEUE_PATH = path.join(CONFIG_DIR, 'discord-queue.json');

const DEFAULT_STATE = {
  accounts: [], // [{ email }]
  proxyLines: [], // proxyLines[i] est associé à accounts[i] (ligne à ligne)
  webhookUrl: '',
  logoUrl: '',
  accountsState: {}, // email -> { registered, profileFilled, profileName, done, sessionSavedAt, sessionExpiresAt }
};

export async function ensureDirs() {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(SESSIONS_DIR, { recursive: true });
}

export async function loadState() {
  await ensureDirs();
  if (!existsSync(STATE_PATH)) return structuredClone(DEFAULT_STATE);
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch (err) {
    throw new Error(`Impossible de lire ${STATE_PATH} : ${err.message}`);
  }
}

export async function saveState(state) {
  await ensureDirs();
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function getAccountState(state, email) {
  return (
    state.accountsState[email] || {
      registered: false,
      profileFilled: false,
      profileName: null,
      done: {}, // url -> { at, state: 'success'|'submitted' }
      sessionSavedAt: null,
      sessionExpiresAt: null,
    }
  );
}

export function setAccountState(state, email, patch) {
  const current = getAccountState(state, email);
  state.accountsState[email] = { ...current, ...patch };
  return state.accountsState[email];
}

// Ligne de proxy associée au compte, par index (même règle que le popup de
// l'extension : proxyLines[i] ↔ accounts[i]).
export function proxyForAccount(state, email) {
  const i = state.accounts.findIndex((a) => a.email === email);
  if (i === -1) return '';
  return state.proxyLines[i] || '';
}

// Nom de fichier sûr pour la session d'un compte.
export function sessionPathForEmail(email) {
  const safe = String(email).replace(/[^a-z0-9@._-]/gi, '_');
  return path.join(SESSIONS_DIR, `${safe}.json`);
}
