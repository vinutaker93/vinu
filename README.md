# Pokelite Helper (extension Chrome)

Automatisation du tirage 30ᵉ anniversaire Pokémon sur pokelite.fr :
inscription, prénom/nom, ouverture des 7 liens, cochage de la case,
clic sur « Je participe » et rapport Discord.

## Installation

1. `chrome://extensions` → activer le **mode développeur**
2. **Charger l'extension non empaquetée** → sélectionner ce dossier

## Utilisation

1. Ouvrir le popup, importer le `.txt` des emails (un par ligne).
2. Importer (ou coller) la liste de proxies puis **Enregistrer la liste**.
   La ligne 1 va au compte 1, la ligne 2 au compte 2, etc.
   **La liste est conservée définitivement** : changer de compte ne l'efface plus.
3. Renseigner l'URL du webhook Discord et cliquer **Tester le webhook**.
4. Choisir le compte actif dans la liste (le proxy correspondant est appliqué
   automatiquement si la case « Activer automatiquement le proxy » est cochée).
5. Aller sur `https://www.pokelite.fr/mon-compte/` : l'extension remplit
   l'email, puis le prénom/nom, puis **ouvre toute seule les 7 liens** du tirage.
6. Sur chaque page produit, la case est cochée et « Je participe » cliqué
   automatiquement ; un rapport Discord est envoyé pour chacune.
7. Pour traiter **tous les comptes automatiquement** à la suite, clique
   **▶️ Lancer pour tous les comptes** dans le popup (voir ci-dessous).

## Automatisation multi-comptes (v2.1)

Le bouton **▶️ Lancer pour tous les comptes** traite la liste entière, sans
intervention :

1. Applique le proxy du 1ᵉʳ compte, ouvre `/mon-compte/`, s'inscrit avec le
   1ᵉʳ email, renseigne prénom/nom, ouvre les 7 liens et participe à chacun.
2. Une fois les 7 confirmées : se **déconnecte** du site (clic sur le vrai
   lien « Déconnexion »), ferme les 7 onglets, puis **change de proxy** pour
   celui du 2ᵉ compte et s'inscrit avec le 2ᵉ email.
3. Répète pour chaque compte de la liste, dans l'ordre, jusqu'au dernier.
4. Un message Discord marque le début, chaque changement de compte et la fin
   de la campagne. Le popup affiche l'avancement en direct (`Compte 3/12 —
   email — inscription / participations en cours...`).

**⚠️ Limite importante** : l'extension n'a jamais accès au mot de passe du
compte (WooCommerce le génère et l'envoie par email). Elle peut donc
**créer** un compte et rester connectée dessus le temps de participer, mais
elle ne peut pas se reconnecter plus tard à un compte déjà inscrit lors d'une
campagne précédente. **Utilise toujours des emails neufs, jamais encore
inscrits sur le site**, pour que l'automatisation fonctionne de bout en bout.

**Sécurité anti-blocage** : si un compte reste bloqué plus de 8 minutes (case
introuvable, page cassée, déconnexion qui échoue...), la campagne l'ignore
automatiquement et passe au suivant plutôt que de rester figée — un message
Discord "⏱ Compte bloqué" le signale. Le bouton **⏹ Arrêter** stoppe la
campagne à tout moment (le compte en cours va jusqu'au bout de sa page
actuelle, rien n'est coupé en plein clic).

## Ce qui a changé (v3.0) — sessions restaurables sans mot de passe

### Le problème
WooCommerce génère le mot de passe d'un nouveau compte et l'**envoie par
email** : l'extension ne le connaît jamais. Tant qu'on cliquait sur
« Se déconnecter » entre deux comptes, la session était **détruite côté
serveur** (WordPress purge le jeton dans `user_meta`) — sans accès à la boîte
mail, le compte devenait donc définitivement inaccessible.

### La solution : bascule par cookies
La campagne ne clique plus jamais sur « Se déconnecter ». À la place, quand un
compte est terminé, le background :
1. **sauvegarde les cookies** du site sous l'email du compte
   (`sessionsByEmail` dans `chrome.storage.local`) ;
2. **efface les cookies** du navigateur — session vierge pour l'inscription
   suivante, mais le jeton reste **valide côté serveur** ;
3. passe au compte suivant (email + proxy) et recharge la page.

Deux boutons dans le popup, sur le compte sélectionné :
- **🔓 Rouvrir ce compte** — vide les cookies courants, réinjecte ceux du
  compte, réapplique son proxy et ouvre `/mon-compte/mes-tirages/`. Tu es
  reconnecté **sans aucun mot de passe**.
- **💾 Sauver la session** — sauvegarde manuellement la session actuellement
  ouverte dans le navigateur (utile pour préserver un compte avant de faire
  autre chose).

Le popup affiche l'état de la session du compte sélectionné :
`✅ valide encore ~46 h`, `⚠️ expirée`, ou `aucune sauvegarde`.

### Limite à connaître
Les cookies d'authentification WordPress **expirent** — environ **48 h** par
défaut (jusqu'à 14 jours avec « se souvenir de moi », ce qui n'est pas le cas
sur une inscription). Passé ce délai, la session restaurée sera déconnectée et,
sans accès à la boîte mail du compte, il n'y a plus aucun moyen d'y revenir.
**La fenêtre pour vérifier les tirages est donc d'environ deux jours après le
passage de la campagne sur un compte.**

### Simplification au passage
La phase « déconnexion » de l'automate disparaît complètement : plus de clic à
simuler, plus d'attente d'une confirmation du content script, plus de watchdog
dédié. La bascule entre comptes est désormais une opération background
déterministe (quelques centaines de ms), ce qui supprime au passage le bug de
campagne bloquée sur le lien « Se déconnecter ».

## Ce qui a changé (v2.2)

### Correctif : la campagne restait bloquée sans se déconnecter
- Le lien « Se déconnecter » est parfois géré par le thème comme un **onglet**
  (JS qui intercepte le clic, navigation en SPA sans rechargement réel) plutôt
  que comme un lien classique. Dans ce cas, `logoutLink.click()` ne provoquait
  **aucun rechargement de page** : le content script ne se relançait jamais et
  ne pouvait donc jamais confirmer la déconnexion au background — la campagne
  restait figée indéfiniment sur le compte en cours.
- Correction : la déconnexion se fait maintenant par **navigation directe**
  (`location.href = lien`) plutôt que par un clic simulé, ce qui force un vrai
  changement de page quel que soit le gestionnaire JS posé sur le lien.
- Le filet de sécurité (watchdog) pour la phase de déconnexion est passé de
  **8 minutes à 90 secondes** — une déconnexion doit être quasi instantanée,
  inutile d'attendre aussi longtemps qu'une inscription avant de forcer le
  passage au compte suivant.

## Ce qui a changé (v2.0)

### Détection de la case et du bouton
- Recherche dans tout le document **et dans les shadow roots / iframes**.
- Attente active (jusqu'à ~15 s) + `MutationObserver` : les pages qui insèrent
  la case après le chargement sont désormais gérées.
- Les cases **masquées** (opacity 0, `clip`, case stylée par un `<label>`) sont
  cochées via une cascade de stratégies : clic input → clic `label[for]` →
  clic label parent → clic du span/checkmark → événements souris → forçage de
  `checked` + `input`/`change`. L'état réel est **vérifié** après chaque essai.
- Cases « maison » (`role="checkbox"`, `.custom-checkbox`…) supportées.
- Bouton « Je participe » : libellés élargis (participer, valider ma
  participation, je tente ma chance…), priorité aux éléments visibles, repli sur
  le bouton du formulaire WooCommerce.
- Après le clic, la confirmation est cherchée sur la page → le statut envoyé à
  Discord distingue *confirmé* / *envoyé sans confirmation* / *échec*.

### Proxies persistants
- La liste est stockée dans `proxyLines` **séparément des comptes** : le
  changement de compte n'y touche plus (c'était la cause de l'effacement).
- Association par index : ligne *n* ↔ compte *n*, y compris après ajout
  d'emails ; les lignes en surplus restent en réserve.
- Application automatique du proxy du compte sélectionné (option cochable).
- Le proxy actif est **ré-appliqué au réveil du service worker** (MV3 tue le
  worker régulièrement, le proxy « sautait »).
- Formats : `host:port`, `host:port:user:pass`, `user:pass@host:port`, avec
  préfixe de schéma optionnel (`http://`, `socks5://`…).

### Webhook Discord — TIGRE AIO
- Identité **TIGRE AIO** : nom du bot, avatar, icône d'auteur, vignette et
  icône de footer (URL du logo configurable dans le popup).
- Embed complet : compte, statut, étape, identité générée, date, heure,
  avancement (n/7), couleur selon le statut.
- **Confidentialité** : le champ Site affiche toujours `private`, le produit et
  le proxy affichent `///`, et **aucun lien n'est publié** (ni titre cliquable,
  ni champ « page »). Les textes libres sont nettoyés (URLs et noms du site
  remplacés par `///`).
- Fiabilité : 3 tentatives immédiates avec backoff, gestion du 429, puis
  **file d'attente persistante** rejouée par alarme — plus aucun message perdu
  si le réseau/proxy tombe ou si le worker est tué.
- Anti-doublon sur 15 s et bouton « Renvoyer la file d'attente ».

### Ouverture automatique des 7 liens
- Déclenchée **sans clic** dès que le compte est créé *et* que le prénom/nom
  sont enregistrés (confirmation WooCommerce attendue).
- Suivi **par email** : chaque nouveau compte rouvre les 7 liens.
- Ouverture séquentielle espacée (350 ms) pour ne pas saturer le proxy.

## Ce qui a changé (v2.1)

### Automate multi-comptes (`background.js` : section « Campagne »)
- Petit automate à état stocké dans `chrome.storage.local.campaign` :
  `phase` (`register` = inscription/profil/participations en cours,
  `logout` = transition entre deux comptes), `index` (compte en cours),
  `pendingLogoutEmail`, `tabId`, `raffleTabIds`.
- **Détection de fin de compte** : un `chrome.storage.onChanged` écoute
  `doneByEmail` ; dès que le compte courant atteint 7/7 participations, la
  campagne ferme ses 7 onglets et enchaîne sur la déconnexion.
- **Déconnexion réelle** : `content.js` cherche le vrai lien
  `a[href*="customer-logout"]` (protégé par un nonce WordPress, donc jamais
  deviné) et le clique — pas de navigation directe vers une URL de
  déconnexion.
- **Changement de compte** : le content script confirme la déconnexion par
  un message `CAMPAIGN_STAGE`; le background bascule alors `myEmail` et le
  proxy actif vers le compte suivant *avant* de recharger la page, pour
  garantir qu'inscription et proxy restent alignés (pas de compte inscrit
  avec le mauvais proxy).
- **Inscription auto-cliquée** : le bouton "S'inscrire" est cliqué tout seul
  uniquement quand une campagne est active (le mode manuel garde le clic
  volontaire d'origine).
- **Watchdog** (`chrome.alarms`, 1 min) : si un compte ne progresse plus
  depuis 8 minutes (en inscription/participations ou en déconnexion), il est
  forcé au suivant plutôt que de bloquer toute la file.
- **Robustesse** : réouverture automatique de l'onglet piloté si l'utilisateur
  le ferme par erreur (`chrome.tabs.onRemoved`) ; les onglets des 7 tirages
  ouverts pendant la campagne sont fermés dès le compte terminé.
- Popup : statut d'avancement en direct (`Compte i/total — email — phase`),
  boutons **▶️ Lancer pour tous les comptes** / **⏹ Arrêter**.
