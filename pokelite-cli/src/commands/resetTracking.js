import { loadState, saveState } from '../config.js';

export async function resetTrackingCommand(email) {
  const state = await loadState();

  if (email) {
    if (!state.accountsState[email]) {
      console.log(`Aucun suivi enregistré pour ${email}.`);
      return;
    }
    delete state.accountsState[email];
    await saveState(state);
    console.log(`Suivi réinitialisé pour ${email}.`);
    return;
  }

  state.accountsState = {};
  await saveState(state);
  console.log('Suivi réinitialisé pour tous les comptes.');
}
