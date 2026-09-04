# Shopify Restock Watcher

Extension Chrome (Manifest V3) qui surveille **une variante précise** d'un
produit Shopify, l'ajoute au panier dès qu'elle repasse en stock, puis ouvre la
page de paiement.

**Le paiement reste manuel.** L'extension ne lit, ne remplit et ne stocke aucune
donnée bancaire : elle s'arrête à l'ouverture du checkout. Pour remplir ta carte
en un clic, utilise l'autofill natif de Chrome
(*Paramètres → Saisie automatique → Moyens de paiement*), qui garde tes données
dans le navigateur.

## Installation

1. `chrome://extensions` → activer le **mode développeur**
2. **Charger l'extension non empaquetée** → sélectionner le dossier
   `shopify-restock-watcher/`

## Utilisation

1. Ouvrir le popup et coller l'URL de la page produit
   (`https://boutique.com/products/le-produit`).
2. **Charger le produit** — Chrome demande alors l'autorisation pour ce
   domaine uniquement, puis la liste des variantes (taille, couleur…) s'affiche
   avec leur état de stock.
3. Choisir la variante à surveiller et l'intervalle de vérification
   (5 s par défaut, minimum 2 s).
4. **Démarrer la surveillance.** Le journal en bas du popup indique chaque
   vérification.
5. Dès que la variante est disponible : ajout au panier, ouverture de
   `/checkout` dans l'onglet, notification Chrome. La surveillance s'arrête
   d'elle-même — il ne reste qu'à payer.

## Rapports Discord — VINULOG

Dans le popup, dépliez **Rapports Discord — VINULOG** :

1. Coller l'URL du webhook (`https://discord.com/api/webhooks/…`).
2. Cocher **Activer les rapports**.
3. **Enregistrer et tester** — Chrome demande l'autorisation pour `discord.com`,
   puis un message de test part immédiatement.
4. **Appliquer le lynx en avatar du webhook** (optionnel) — renomme le webhook
   en `VINULOG` et lui pose le lynx en photo de profil, via
   `PATCH /webhooks/{id}/{token}`. Le token contenu dans l'URL suffit, aucun bot
   n'est nécessaire. C'est une modification permanente du webhook côté Discord,
   d'où le bouton distinct. Discord limite fortement ces modifications : sur un
   429, le délai réel d'attente est affiché.

Chaque rapport est un embed signé VINULOG, illustré par la caricature de lynx
(`assets/vinulog-lynx.png`), avec :

| Champ | Contenu |
| --- | --- |
| Site | Domaine de la boutique |
| Article | Produit — variante surveillée |
| Action | Surveillance démarrée / Produit disponible / Ajouté au panier / Ajout refusé / Surveillance arrêtée |
| Date | JJ/MM/AAAA |
| Heure | HH:MM:SS |
| Lien | URL de la page produit |
| Paiement | URL du checkout (sur l'ajout au panier) |
| Détail | Raison d'un refus, le cas échéant |

Envoi maîtrisé : les vérifications « toujours en rupture » ne produisent aucun
message, une disponibilité n'est signalée qu'une fois par session, et un même
motif de refus n'est pas répété. En cas d'erreur réseau, de 429 ou de 5xx,
l'envoi est réessayé (3 tentatives, `retry_after` respecté) ; un webhook
supprimé ou invalide (401/403/404) n'est pas réessayé et l'erreur apparaît dans
le journal du popup.

L'image de l'embed est jointe en multipart et référencée via `attachment://` :
aucun hébergement externe à maintenir. L'avatar, lui, est une propriété du
webhook et non du message : il ne peut pas être joint en multipart et part en
data URI lors de l'étape 4. Pour changer le dessin, éditer puis relancer
`python3 tools/make-lynx.py` (aucune dépendance).

## Fonctionnement

- **Détection du stock** : appel de l'API publique de la boutique
  `/products/<handle>.js`, qui renvoie le champ `available` de chaque variante.
  Pas de rechargement de page, pas de scraping du DOM (qui casse à chaque
  changement de thème).
- **Ajout au panier** : `POST /cart/add.js` avec l'`id` de la variante.
- **Contexte d'exécution** : les deux requêtes sont injectées dans l'onglet de
  la boutique via `chrome.scripting`, jamais émises depuis le service worker.
  Une requête partie du worker serait cross-site et n'emporterait pas les
  cookies `SameSite` de Shopify : le panier serait créé dans une session
  anonyme, invisible depuis ton onglet.
- **Cadence** : `chrome.alarms` ne descend pas sous la minute. Chaque réveil
  enchaîne donc une rafale de vérifications espacées de l'intervalle choisi
  pendant ~55 s, ce qui maintient aussi le service worker en vie (le délai
  d'inactivité de 30 s est repoussé à chaque appel d'API).

## Permissions

| Permission | Raison |
| --- | --- |
| `storage` | Mémoriser produit, variante, intervalle et journal |
| `alarms` | Réveiller le service worker chaque minute |
| `notifications` | Prévenir quand l'article est au panier |
| `tabs` | Retrouver / ouvrir l'onglet boutique et l'amener au checkout |
| `scripting` | Exécuter les deux requêtes dans le contexte du site |
| hôtes | **Aucun accès accordé d'avance** : `optional_host_permissions` demande la boutique au chargement du produit, et `discord.com` à l'enregistrement du webhook |

## Limites connues

- Un onglet sur la boutique doit rester ouvert (l'extension en rouvre un en
  arrière-plan s'il est fermé).
- Chrome peut tuer le service worker sous pression mémoire : la surveillance
  reprend au réveil suivant de l'alarme, avec au pire une minute de trou.
- Une boutique derrière une file d'attente, un mot de passe, ou un thème
  headless qui n'expose pas `/products/<handle>.js` n'est pas supportée.
- L'ajout au panier ne réserve rien : sur une remise en stock très disputée,
  l'article peut repartir avant la fin du paiement.

## Usage raisonnable

Un intervalle très court n'améliore pas beaucoup tes chances et peut te faire
limiter (429) ou bloquer par la boutique. 5 s est un compromis correct. Reste
dans les conditions d'utilisation du site que tu surveilles.
