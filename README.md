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

### Webhook Discord
- Envoi en **embed complet** : compte, site, statut, item, étape, identité
  générée, proxy utilisé, date, heure, avancement (n/7), lien de la page,
  vignette du produit, couleur selon le statut.
- Fiabilité : 3 tentatives immédiates avec backoff, gestion du 429, puis
  **file d'attente persistante** rejouée par alarme — plus aucun message perdu
  si le réseau/proxy tombe ou si le worker est tué.
- Anti-doublon sur 15 s et bouton « Renvoyer la file d'attente ».

### Ouverture automatique des 7 liens
- Déclenchée **sans clic** dès que le compte est créé *et* que le prénom/nom
  sont enregistrés (confirmation WooCommerce attendue).
- Suivi **par email** : chaque nouveau compte rouvre les 7 liens.
- Ouverture séquentielle espacée (350 ms) pour ne pas saturer le proxy.
