#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { accountsImportCommand } from '../src/commands/accountsImport.js';
import { proxiesImportCommand } from '../src/commands/proxiesImport.js';
import { configWebhookCommand, configLogoCommand, testWebhookCommand, flushWebhookCommand } from '../src/commands/config.js';
import { runCommand } from '../src/commands/run.js';
import { reopenCommand } from '../src/commands/reopen.js';
import { statusCommand } from '../src/commands/status.js';
import { resetTrackingCommand } from '../src/commands/resetTracking.js';

const HELP = `Pokelite Helper CLI

Usage :
  pokelite accounts import <fichier.txt>   Importe des emails (un par ligne)
  pokelite proxies import <fichier.txt>    Importe des proxies (associés ligne à ligne aux comptes)
  pokelite config webhook <url>            Enregistre l'URL du webhook Discord
  pokelite config logo <url>               Enregistre l'URL du logo TIGRE AIO
  pokelite test-webhook                    Envoie un message Discord de test
  pokelite flush-webhook                   Renvoie les messages Discord en attente
  pokelite run [--concurrency N] [--headed]
                                            Traite tous les comptes en attente
                                            (N navigateurs en parallèle, défaut 3)
  pokelite reopen <email>                  Restaure la session d'un compte et ouvre
                                            « Mes tirages » dans une fenêtre visible
  pokelite status                          Tableau d'avancement de tous les comptes
  pokelite reset-tracking [email]          Réinitialise le suivi (d'un compte, ou tous)

Les fichiers, sessions et l'avancement sont stockés dans ~/.pokelite-helper/.
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }

  if (command === 'accounts' && rest[0] === 'import') {
    return accountsImportCommand(rest[1]);
  }

  if (command === 'proxies' && rest[0] === 'import') {
    return proxiesImportCommand(rest[1]);
  }

  if (command === 'config' && rest[0] === 'webhook') {
    return configWebhookCommand(rest[1]);
  }

  if (command === 'config' && rest[0] === 'logo') {
    return configLogoCommand(rest[1]);
  }

  if (command === 'test-webhook') {
    return testWebhookCommand();
  }

  if (command === 'flush-webhook') {
    return flushWebhookCommand();
  }

  if (command === 'run') {
    const { values } = parseArgs({
      args: rest,
      options: {
        concurrency: { type: 'string' },
        headed: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    });
    return runCommand(values);
  }

  if (command === 'reopen') {
    return reopenCommand(rest[0]);
  }

  if (command === 'status') {
    return statusCommand();
  }

  if (command === 'reset-tracking') {
    return resetTrackingCommand(rest[0]);
  }

  console.error(`Commande inconnue : ${command}\n`);
  console.log(HELP);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Erreur :', err.message);
  process.exitCode = 1;
});
