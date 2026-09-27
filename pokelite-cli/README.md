# Pokelite Helper CLI

Outil en ligne de commande pour Mac qui automatise l'inscription et la
participation au tirage 30ᵉ anniversaire sur pokelite.fr, avec un **proxy
dédié par compte, en parallèle** — remplace l'extension Chrome précédente.

## Pourquoi un CLI plutôt qu'une extension Chrome ?

Chrome n'a qu'**un seul proxy actif pour tout le navigateur**. Impossible d'y
faire tourner deux comptes en même temps, chacun sous sa propre IP — deux
onglets ouverts en parallèle partagent forcément la même adresse.

Ce CLI utilise [Playwright](https://playwright.dev) : chaque compte tourne
dans son propre navigateur (`BrowserContext`) avec **son propre proxy**,
totalement isolé des autres. Plusieurs comptes peuvent donc être traités
**en même temps**, chacun sous sa vraie IP dédiée — et comme chaque contexte
a son propre jeu de cookies dès le départ, il n'y a même plus besoin de
« déconnexion » entre deux comptes.

## Installation (Mac)

```bash
cd pokelite-cli
./install.sh
```

Le script installe Node.js si besoin (via Homebrew), les dépendances npm,
télécharge Chromium pour Playwright, et crée la commande `pokelite` (via
`npm link`).

Installation manuelle équivalente :

```bash
npm install
npx playwright install chromium
npm link
```

## Utilisation

```bash
# 1. Importer les comptes (un email par ligne)
pokelite accounts import comptes.txt

# 2. Importer les proxies (la ligne n va au compte n)
pokelite proxies import proxies.txt

# 3. Configurer le webhook Discord (TIGRE AIO)
pokelite config webhook https://discord.com/api/webhooks/...
pokelite test-webhook

# 4. Lancer la campagne : inscription, prénom/nom, puis les 2 pages du
#    tirage pour chaque compte, jusqu'à 3 comptes en parallèle par défaut
pokelite run
pokelite run --concurrency 5      # plus de comptes en parallèle
pokelite run --headed             # fenêtres visibles au lieu de headless

# 5. Suivre l'avancement
pokelite status

# 6. Revenir sur un compte plus tard (session sauvegardée) pour vérifier
#    les résultats dans « Mes tirages », sans mot de passe
pokelite reopen alice@example.com
```

### Formats de fichiers

- `comptes.txt` : un email par ligne (n'importe quel texte autour est ignoré,
  les emails sont extraits par motif).
- `proxies.txt` : un proxy par ligne, formats acceptés :
  - `host:port`
  - `host:port:user:pass`
  - `user:pass@host:port`
  - avec préfixe de schéma optionnel : `http://`, `https://`, `socks4://`,
    `socks5://`

La **ligne 1** de `proxies.txt` est associée au **1ᵉʳ** compte importé, la
ligne 2 au 2ᵉ, etc. Réimporter la liste des proxies ne touche jamais à la
liste des comptes (et inversement).

### Liens du tirage

Les 2 liens actuels sont définis dans `src/raffleLinks.js` — c'est la seule
source de vérité : tout le reste (comptage `n/2`, textes, avancement,
webhook) en dérive automatiquement. Changer la liste de liens ne demande
qu'une seule modification dans ce fichier.

### Où sont stockées les données ?

Tout vit dans `~/.pokelite-helper/` :
- `state.json` — comptes, proxies, avancement par compte, config Discord.
- `sessions/<email>.json` — session (cookies) Playwright de chaque compte,
  réutilisable par `pokelite reopen`.
- `discord-queue.json` — messages Discord qui ont échoué, rejoués
  automatiquement au prochain `pokelite run` (ou via `pokelite flush-webhook`).

Surchargeable via la variable d'environnement `POKELITE_HOME` (utile pour
plusieurs configurations séparées, ou pour les tests).

## Webhook Discord

Contrairement à l'extension Chrome (qui masquait le site, le produit et le
proxy pour un usage partagé), ce CLI est un outil **personnel** : le webhook
affiche tout en clair — site, nom du produit, **lien cliquable** vers la
page, **image du produit** en vignette, étape en cours (inscription envoyée,
profil enregistré, case cochée, participation confirmée, compte terminé...).
Seuls les identifiants du proxy restent masqués (`host:port` visible, jamais
le user:pass).

## Commandes

| Commande | Effet |
|---|---|
| `pokelite accounts import <fichier>` | Importe des emails |
| `pokelite proxies import <fichier>` | Importe des proxies (ligne à ligne) |
| `pokelite config webhook <url>` | Configure le webhook Discord |
| `pokelite config logo <url>` | Configure le logo affiché dans Discord |
| `pokelite test-webhook` | Envoie un message de test |
| `pokelite flush-webhook` | Renvoie les messages Discord en attente |
| `pokelite run [--concurrency N] [--headed]` | Lance la campagne |
| `pokelite reopen <email>` | Restaure la session d'un compte, ouvre « Mes tirages » |
| `pokelite status` | Tableau d'avancement de tous les comptes |
| `pokelite reset-tracking [email]` | Réinitialise le suivi (un compte, ou tous) |

## Limites connues

- **Mot de passe** : comme avant, WooCommerce génère le mot de passe et
  l'envoie par email — le CLI ne le connaît jamais. Un compte déjà inscrit
  reste accessible via sa session sauvegardée (`pokelite reopen`) tant
  qu'elle n'a pas expiré (cookies WordPress : ~48 h). Passé ce délai, il faut
  la boîte mail du compte pour redéfinir un mot de passe (aucune
  automatisation de cette étape n'est fournie).
- **Détection de page** : les heuristiques de détection de la case à cocher
  et du bouton « Je participe » (`src/automation/detect.js`) sont un port de
  l'extension Chrome ; si le thème du site change structurellement, il peut
  falloir ajuster les sélecteurs.

## Développement

```bash
npm test              # tests unitaires (proxy, config, discord) — pas de navigateur requis
node --check src/**/*.js bin/pokelite.js   # vérification syntaxique
```
