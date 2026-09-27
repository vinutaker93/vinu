import { readFile } from 'node:fs/promises';
import { loadState, saveState } from '../config.js';

export async function proxiesImportCommand(filePath) {
  if (!filePath) {
    console.error('Usage : pokelite proxies import <fichier.txt>');
    process.exitCode = 1;
    return;
  }

  const text = await readFile(filePath, 'utf8');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (lines.length === 0) {
    console.log('Aucun proxy trouvé dans le fichier.');
    return;
  }

  const state = await loadState();
  if (state.accounts.length === 0) {
    console.log('Importe d’abord tes comptes (`pokelite accounts import`) avant les proxies.');
    return;
  }

  state.proxyLines = lines;
  await saveState(state);

  const assigned = Math.min(lines.length, state.accounts.length);
  const extra = lines.length - assigned;
  console.log(
    `${assigned} proxy(s) associé(s) ligne par ligne (ligne 1 → compte 1, etc.).` +
      (extra > 0 ? ` ${extra} en réserve pour de futurs comptes.` : '')
  );
}
