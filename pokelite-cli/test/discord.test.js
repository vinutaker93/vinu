import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyDiscord, flushDiscordQueue } from '../src/discord.js';

// Ces tests couvrent uniquement les chemins qui ne déclenchent aucun appel
// réseau (webhook absent) — pas de dépendance à Discord pour `npm test`.

test('notifyDiscord: sans webhook configuré', async () => {
  const res = await notifyDiscord({ webhookUrl: '', logoUrl: '' }, { status: 'info', email: 'a@x.com' });
  assert.equal(res.ok, false);
  assert.match(res.error, /webhook/i);
});

test('flushDiscordQueue: sans webhook configuré', async () => {
  const res = await flushDiscordQueue('');
  assert.equal(res.ok, false);
});
