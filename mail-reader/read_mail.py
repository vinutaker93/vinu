#!/usr/bin/env python3
"""Lecteur unifie de plusieurs boites Gmail via IMAP.

Se connecte a chacune de tes boites Gmail avec un « mot de passe
d'application » (App Password) et affiche les messages recents de toutes
les boites dans une seule liste triee par date.

Pourquoi IMAP et pas une connexion automatique dans Chrome :
  IMAP est l'acces prevu par Google pour lire ton propre courrier. Il ne
  declenche pas le flux de connexion interactive (mot de passe, mail de
  recuperation, blocages), donc il n'y a rien a contourner et aucun proxy
  n'est necessaire.

Prerequis pour CHAQUE compte (une seule fois) :
  1. Activer la validation en deux etapes :
       https://myaccount.google.com/security
  2. Creer un mot de passe d'application :
       https://myaccount.google.com/apppasswords
  3. Reporter e-mail + mot de passe d'application dans accounts.json
     (voir accounts.example.json pour le format). Ne commit jamais ce
     fichier : il est ignore par .gitignore.

Usage :
  python read_mail.py                     # 20 derniers messages par boite
  python read_mail.py --unread            # uniquement les non-lus
  python read_mail.py --limit 50          # nombre de messages par boite
  python read_mail.py --since 7           # messages des 7 derniers jours
  python read_mail.py --mailbox "[Gmail]/Spam"
  python read_mail.py --config chemin/accounts.json

Uniquement la bibliotheque standard Python (rien a installer).
"""

from __future__ import annotations

import argparse
import email
import imaplib
import json
import sys
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from pathlib import Path

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993


def load_accounts(config_path: Path) -> list[dict]:
    """Charge la liste des comptes depuis un fichier JSON."""
    if not config_path.exists():
        sys.exit(
            f"Fichier de configuration introuvable : {config_path}\n"
            f"Copie accounts.example.json vers {config_path.name} et remplis-le."
        )
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.exit(f"JSON invalide dans {config_path} : {exc}")

    if not isinstance(data, list) or not data:
        sys.exit("La configuration doit etre une liste non vide de comptes.")

    for i, acc in enumerate(data, 1):
        if not isinstance(acc, dict) or "email" not in acc or "app_password" not in acc:
            sys.exit(f"Compte #{i} invalide : il faut au moins 'email' et 'app_password'.")
    return data


def decode_mime(value: str | None) -> str:
    """Decode un en-tete MIME (Subject, From...) en texte lisible."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def parse_date(raw: str | None) -> datetime:
    """Parse une date d'en-tete en datetime timezone-aware (UTC si absent)."""
    if not raw:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def build_search_criteria(args: argparse.Namespace) -> str:
    """Construit le critere de recherche IMAP a partir des options CLI."""
    parts: list[str] = []
    if args.unread:
        parts.append("UNSEEN")
    if args.since:
        since_date = (datetime.now(timezone.utc) - timedelta(days=args.since)).strftime("%d-%b-%Y")
        parts.append(f'SINCE {since_date}')
    return " ".join(parts) if parts else "ALL"


def fetch_account(account: dict, args: argparse.Namespace) -> list[dict]:
    """Recupere les messages d'un compte. Ne marque rien comme lu (PEEK)."""
    label = account.get("label") or account["email"]
    messages: list[dict] = []

    try:
        conn = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    except OSError as exc:
        print(f"  [{label}] connexion impossible : {exc}", file=sys.stderr)
        return messages

    try:
        try:
            conn.login(account["email"], account["app_password"])
        except imaplib.IMAP4.error as exc:
            print(
                f"  [{label}] echec d'authentification : {exc}\n"
                f"           -> verifie que la validation en deux etapes est active\n"
                f"              et que tu utilises un MOT DE PASSE D'APPLICATION.",
                file=sys.stderr,
            )
            return messages

        status, _ = conn.select(f'"{args.mailbox}"', readonly=True)
        if status != "OK":
            print(f"  [{label}] dossier introuvable : {args.mailbox}", file=sys.stderr)
            return messages

        criteria = build_search_criteria(args)
        status, data = conn.search(None, criteria)
        if status != "OK" or not data or not data[0]:
            return messages

        ids = data[0].split()
        ids = ids[-args.limit:]  # les plus recents

        for msg_id in reversed(ids):
            status, msg_data = conn.fetch(
                msg_id,
                "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])",
            )
            if status != "OK" or not msg_data:
                continue

            raw_header = b""
            flags_blob = b""
            for part in msg_data:
                if isinstance(part, tuple):
                    flags_blob += part[0] or b""
                    raw_header += part[1] or b""
                elif isinstance(part, (bytes, bytearray)):
                    flags_blob += part

            header = email.message_from_bytes(raw_header)
            seen = b"\\Seen" in flags_blob
            messages.append(
                {
                    "account": label,
                    "from": decode_mime(header.get("From")),
                    "subject": decode_mime(header.get("Subject")) or "(sans objet)",
                    "date": parse_date(header.get("Date")),
                    "seen": seen,
                }
            )
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    return messages


def print_messages(messages: list[dict]) -> None:
    if not messages:
        print("Aucun message a afficher.")
        return

    messages.sort(key=lambda m: m["date"], reverse=True)
    for m in messages:
        flag = " " if m["seen"] else "*"  # * = non lu
        date_str = m["date"].astimezone().strftime("%Y-%m-%d %H:%M")
        sender = m["from"][:32].ljust(32)
        acct = m["account"][:14].ljust(14)
        print(f"{flag} {date_str}  {acct}  {sender}  {m['subject']}")

    unread = sum(1 for m in messages if not m["seen"])
    print(f"\n{len(messages)} message(s), dont {unread} non lu(s). (* = non lu)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Lecteur unifie de plusieurs boites Gmail via IMAP.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    default_config = Path(__file__).resolve().parent / "accounts.json"
    parser.add_argument("--config", type=Path, default=default_config,
                        help="Chemin du fichier JSON des comptes (defaut : accounts.json).")
    parser.add_argument("--limit", type=int, default=20,
                        help="Nombre max de messages par boite (defaut : 20).")
    parser.add_argument("--unread", action="store_true",
                        help="N'afficher que les messages non lus.")
    parser.add_argument("--since", type=int, default=0,
                        help="N'afficher que les messages des N derniers jours.")
    parser.add_argument("--mailbox", default="INBOX",
                        help='Dossier a lire (defaut : INBOX). Ex : "[Gmail]/Spam".')
    args = parser.parse_args()

    accounts = load_accounts(args.config)
    all_messages: list[dict] = []
    for account in accounts:
        label = account.get("label") or account["email"]
        print(f"Lecture de {label} ...", file=sys.stderr)
        all_messages.extend(fetch_account(account, args))

    print()
    print_messages(all_messages)


if __name__ == "__main__":
    main()
