# Gmail Autofill — à la demande

Petite extension Chrome qui remplit **e-mail + mot de passe d'un seul compte
que tu choisis** sur la page de connexion Gmail. Elle se comporte comme
l'autofill d'un gestionnaire de mots de passe.

## Ce qu'elle fait / ne fait pas

- ✅ Tu ouvres la page de connexion, tu cliques sur **Remplir** pour un compte,
  elle saisit l'e-mail, passe à l'étape suivante, saisit le mot de passe.
- ✅ **Un compte à la fois**, déclenché par toi.
- ❌ **Pas d'enchaînement automatique** de toute la liste.
- ❌ **Pas de proxy** et aucune tentative de masquer l'origine des connexions.
- ❌ **Ne remplit pas le mail de récupération.** Il est affiché (avec un bouton
  « Copier recup ») pour que tu le **tapes toi-même** quand Google le demande.

À noter : sans proxy, enchaîner beaucoup de connexions depuis le même
navigateur/IP peut déclencher les vérifications de sécurité de Google (dont
justement la demande de mail de récupération). C'est le fonctionnement normal
de la protection de Google, pas un défaut de l'extension.

## Installation

1. `chrome://extensions` → activer le **mode développeur**.
2. **Charger l'extension non empaquetée** → sélectionner ce dossier
   (`gmail-autofill/`).

## Utilisation

1. Ouvrir le popup de l'extension.
2. Coller ta liste, **une ligne par compte**, au format :
   ```
   email;motdepasse;mailderecuperation
   ```
   (le mail de récupération est optionnel ; séparateur `;`, `,` ou tabulation).
   Puis **Enregistrer la liste**.
3. Ouvrir `https://accounts.google.com/` (ou l'extension le fait au premier
   clic sur Remplir).
4. Cliquer **Remplir** en face du compte voulu.
5. Quand Google demande le mail de récupération, le **taper à la main**
   (bouton « Copier recup » pour le coller si besoin).

## Sécurité

Les identifiants sont stockés **en clair** dans le stockage local de Chrome, sur
ta machine. C'est pratique mais peu sûr : ne l'utilise que sur un poste que tu
contrôles, et pour **tes propres comptes**.
