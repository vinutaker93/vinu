#!/usr/bin/env bash
set -euo pipefail

echo "== Pokelite Helper CLI — installation (Mac) =="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js introuvable."
  if command -v brew >/dev/null 2>&1; then
    echo "Installation via Homebrew..."
    brew install node
  else
    echo "Installe Homebrew (https://brew.sh) puis relance ce script, ou installe Node.js manuellement (https://nodejs.org)."
    exit 1
  fi
fi

echo "Node : $(node --version)"

cd "$(dirname "$0")"

echo "Installation des dépendances (npm install)..."
npm install

echo "Installation de Chromium pour Playwright..."
npx playwright install chromium

echo "Lien de la commande 'pokelite' (npm link)..."
npm link

echo
echo "Installation terminée. Essaie : pokelite --help"
