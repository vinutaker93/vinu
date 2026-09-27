import { loadState, saveState } from '../config.js';
import { notifyDiscord, flushDiscordQueue } from '../discord.js';

export async function configWebhookCommand(url) {
  if (!url) {
    console.error('Usage : pokelite config webhook <url>');
    process.exitCode = 1;
    return;
  }
  const state = await loadState();
  state.webhookUrl = url.trim();
  await saveState(state);
  console.log('Webhook enregistré.');
}

export async function configLogoCommand(url) {
  if (!url) {
    console.error('Usage : pokelite config logo <url>');
    process.exitCode = 1;
    return;
  }
  const state = await loadState();
  state.logoUrl = url.trim();
  await saveState(state);
  console.log('Logo enregistré.');
}

export async function testWebhookCommand() {
  const state = await loadState();
  if (!state.webhookUrl) {
    console.error('Aucun webhook configuré. `pokelite config webhook <url>` d’abord.');
    process.exitCode = 1;
    return;
  }
  const res = await notifyDiscord(state, {
    status: 'info',
    title: '🔔 Test du webhook',
    step: 'Test manuel',
    email: '—',
    item: 'Message de test',
    description: 'Si tu vois ce message, le webhook Discord est correctement configuré.',
  });
  console.log(res.ok ? 'Webhook OK ✅' : 'Échec — message mis en file d’attente (relance `pokelite run` pour le renvoyer).');
}

export async function flushWebhookCommand() {
  const state = await loadState();
  const res = await flushDiscordQueue(state.webhookUrl);
  if (!res.ok) {
    console.error(res.error);
    process.exitCode = 1;
    return;
  }
  console.log(`${res.flushed} message(s) renvoyé(s), ${res.remaining} en attente.`);
}
