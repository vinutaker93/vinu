#!/usr/bin/env bash
set -euo pipefail

echo "== Pokelite Helper CLI — installation (Mac) =="

REQUIRED_MAJOR=18

node_major_version() {
  "$1" -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

# Priorise les chemins Homebrew dans le PATH pour CE script : sur certains
# Mac, conda/Anaconda active un Node ancien (ex. 12.x) via son env "base" et
# le fait passer avant celui d'Homebrew — `command -v node` trouve alors le
# mauvais Node même une fois Homebrew installé. On corrige ça localement,
# sans toucher à la config shell de l'utilisateur.
for BREW_BIN in /opt/homebrew/bin /usr/local/bin; do
  if [ -d "$BREW_BIN" ]; then
    export PATH="$BREW_BIN:$PATH"
  fi
done

CURRENT_NODE="$(command -v node || true)"
CURRENT_MAJOR=0
if [ -n "$CURRENT_NODE" ]; then
  CURRENT_MAJOR="$(node_major_version "$CURRENT_NODE")"
fi

if [ "$CURRENT_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
  if [ -n "$CURRENT_NODE" ]; then
    echo "Node trouvé ($CURRENT_NODE, v$CURRENT_MAJOR) est trop ancien pour Playwright (≥ $REQUIRED_MAJOR requis)."
    echo "C'est fréquent avec un Node fourni par conda/Anaconda (base), qui passe avant celui d'Homebrew dans le PATH."
  fi

  if command -v brew >/dev/null 2>&1; then
    echo "Installation de Node via Homebrew..."
    brew install node
    CURRENT_NODE="$(command -v node)"
    CURRENT_MAJOR="$(node_major_version "$CURRENT_NODE")"
  else
    echo
    echo "Homebrew n'est pas installé (et n'est pas obligatoire) : installe Node.js"
    echo "directement depuis https://nodejs.org/en/download (installeur .pkg pour macOS,"
    echo "choisis Intel ou Apple Silicon selon ta puce), puis relance ce script."
    echo "Ferme et rouvre le Terminal après l'installation pour que 'node' soit à jour."
    exit 1
  fi
fi

if [ "$CURRENT_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
  echo "Node reste trop ancien (v$CURRENT_MAJOR)."
  echo "Si tu utilises conda/Anaconda : lance 'conda deactivate' puis relance ce script."
  exit 1
fi

echo "Node utilisé : $CURRENT_NODE ($("$CURRENT_NODE" --version))"

cd "$(dirname "$0")"

echo "Installation des dépendances (npm install)..."
npm install

echo "Installation de Chromium pour Playwright..."
npx playwright install chromium

echo "Lien de la commande 'pokelite' (npm link)..."
npm link

echo
echo "Installation terminée. Essaie : pokelite --help"
echo "(Si 'pokelite' est introuvable dans un nouveau terminal, relance ce script depuis ce même terminal.)"
