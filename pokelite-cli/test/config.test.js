import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// POKELITE_HOME doit être positionné AVANT d'importer config.js (les
// constantes de chemin sont calculées à l'import).
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pokelite-test-'));
process.env.POKELITE_HOME = tmpDir;

const { loadState, saveState, getAccountState, setAccountState, proxyForAccount } = await import('../src/config.js');

test('loadState: état par défaut si aucun fichier', async () => {
  const state = await loadState();
  assert.deepEqual(state.accounts, []);
  assert.deepEqual(state.proxyLines, []);
});

test('saveState puis loadState: round-trip', async () => {
  const state = await loadState();
  state.accounts.push({ email: 'a@x.com' }, { email: 'b@x.com' });
  state.proxyLines.push('1.2.3.4:8080', '5.6.7.8:9090');
  await saveState(state);

  const reloaded = await loadState();
  assert.equal(reloaded.accounts.length, 2);
  assert.equal(reloaded.proxyLines[1], '5.6.7.8:9090');
});

test('proxyForAccount: association par index', async () => {
  const state = await loadState();
  assert.equal(proxyForAccount(state, 'a@x.com'), '1.2.3.4:8080');
  assert.equal(proxyForAccount(state, 'b@x.com'), '5.6.7.8:9090');
  assert.equal(proxyForAccount(state, 'inconnu@x.com'), '');
});

test('getAccountState / setAccountState', async () => {
  const state = await loadState();
  const before = getAccountState(state, 'a@x.com');
  assert.equal(before.profileFilled, false);
  assert.deepEqual(before.done, {});

  setAccountState(state, 'a@x.com', { profileFilled: true, done: { 'http://x': { at: 1, state: 'success' } } });
  const after = getAccountState(state, 'a@x.com');
  assert.equal(after.profileFilled, true);
  assert.equal(Object.keys(after.done).length, 1);
});

test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
