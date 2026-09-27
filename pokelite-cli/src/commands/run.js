import { runCampaign } from '../campaign.js';
import { loadState } from '../config.js';
import { flushDiscordQueue } from '../discord.js';

export async function runCommand(args) {
  const concurrency = Number(args.concurrency) > 0 ? Number(args.concurrency) : 3;
  const headless = !args.headed;

  // Rejoue d'abord les messages Discord d'un run précédent qui auraient échoué.
  const state = await loadState();
  if (state.webhookUrl) {
    const flushed = await flushDiscordQueue(state.webhookUrl);
    if (flushed.ok && flushed.flushed > 0) {
      console.log(`${flushed.flushed} message(s) Discord en attente renvoyé(s).`);
    }
  }

  await runCampaign({ concurrency, headless });
}
