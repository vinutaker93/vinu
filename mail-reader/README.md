# Lecteur unifié de boîtes Gmail (IMAP)

Consulte **toutes tes boîtes Gmail au même endroit**, en lecture seule, via
l'accès officiel de Google (IMAP). Pas de connexion automatique dans Chrome,
pas de mail de récupération à retaper, pas de proxy : rien à contourner,
donc rien qui se fait bloquer.

## Configuration (une seule fois par compte)

1. **Activer la validation en deux étapes** sur le compte :
   https://myaccount.google.com/security
2. **Créer un mot de passe d'application** :
   https://myaccount.google.com/apppasswords
   (un mot de passe dédié, révocable à tout moment, qui remplace ton mot de
   passe normal pour IMAP — tu n'exposes jamais ton vrai mot de passe).
3. Copier le modèle et le remplir :
   ```bash
   cp accounts.example.json accounts.json
   ```
   Puis éditer `accounts.json` avec tes e-mails et mots de passe d'application.
   Ce fichier est ignoré par git (`.gitignore`) — **ne le commit jamais**.

## Utilisation

```bash
python read_mail.py                 # 20 derniers messages de chaque boîte
python read_mail.py --unread        # uniquement les non-lus
python read_mail.py --limit 50      # plus de messages par boîte
python read_mail.py --since 7       # messages des 7 derniers jours
python read_mail.py --mailbox "[Gmail]/Spam"
```

Le script se connecte à chaque compte, récupère les messages **sans les
marquer comme lus**, puis affiche tout dans une seule liste triée par date
(`*` = non lu).

Aucune dépendance à installer : uniquement la bibliothèque standard de Python 3.

## Alternative sans code

Pour simplement *consulter* tes boîtes, un client mail fait très bien le
travail : ajoute chaque compte dans **Thunderbird** (ou Apple Mail, Outlook)
en IMAP avec le mot de passe d'application → tu obtiens une **boîte de
réception unifiée**. C'est l'option la plus robuste et sans maintenance.

## Envoyer / gérer (au-delà de la lecture)

Si un jour tu veux aussi envoyer, trier ou automatiser, la voie officielle
est la **Gmail API + OAuth 2.0** (ou SMTP avec le même mot de passe
d'application). Dis-le et on l'ajoute.
