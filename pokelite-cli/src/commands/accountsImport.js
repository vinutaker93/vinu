import { readFile } from 'node:fs/promises';
import { loadState, saveState } from '../config.js';

const EMAIL_RE = /[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/g;

export async function accountsImportCommand(filePath) {
  if (!filePath) {
    console.error('Usage : pokelite accounts import <fichier.txt>');
    process.exitCode = 1;
    return;
  }

  const text = await readFile(filePath, 'utf8');
  const found = Array.from(new Set((text.match(EMAIL_RE) || []).map((m) => m.trim())));
  if (found.length === 0) {
    console.log('Aucun email trouvé dans le fichier.');
    return;
  }

  const state = await loadState();
  let added = 0;
  for (const email of found) {
    if (!state.accounts.some((a) => a.email === email)) {
      state.accounts.push({ email });
      added++;
    }
  }
  await saveState(state);
  console.log(`${found.length} email(s) trouvé(s), ${added} ajouté(s). Total : ${state.accounts.length} compte(s).`);
}
