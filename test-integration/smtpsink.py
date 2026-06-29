#!/usr/bin/env python3
"""Collecteur SMTP de test : écrit chaque mail reçu dans un fichier.

Usage :
    pip install aiosmtpd
    python3 smtpsink.py            # écoute 127.0.0.1:1025, journalise /tmp/smtp_caught.txt

Pointez ensuite tparameters.mail_smtp='127.0.0.1', mail_port=1025,
mail_smtp_class='IsSMTP()' (I majuscule) sur l'instance de test.
"""
import os
import time
from aiosmtpd.controller import Controller

OUT = os.environ.get("SMTP_FILE", "/tmp/smtp_caught.txt")
HOST = os.environ.get("SMTP_HOST", "127.0.0.1")
PORT = int(os.environ.get("SMTP_PORT", "1025"))


class Handler:
    async def handle_DATA(self, server, session, envelope):
        with open(OUT, "a", encoding="utf-8") as f:
            f.write("=== MAIL ===\n")
            f.write("FROM: %s\n" % envelope.mail_from)
            f.write("RCPT: %s\n" % ", ".join(envelope.rcpt_tos))
            f.write(envelope.content.decode("utf-8", "replace")[:2000])
            f.write("\n")
        return "250 Message accepted"


if __name__ == "__main__":
    Controller(Handler(), hostname=HOST, port=PORT).start()
    print(f"SMTP sink sur {HOST}:{PORT} -> {OUT}")
    while True:
        time.sleep(1)
