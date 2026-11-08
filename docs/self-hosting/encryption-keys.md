---
title: "Encryption keys"
description: "What the dopgate master key protects, where it lives, and how to keep it safe."
---

# Encryption keys

The first start writes `master.key`: 32 random bytes, readable only by its owner. dopgate uses it with XChaCha20-Poly1305 to encrypt the values in the database that would be dangerous in a leaked copy:

- the private halves of the JWT signing keys
- single sign-on client secrets
- secret settings, such as the SMTP password
- backups

Passwords are not encrypted with it. They are hashed with Argon2id and cannot be decrypted by anyone.

## Checking the key

At first start dopgate encrypts a known value with the key and stores it. Every later start decrypts that value, and refuses to start with a different key. A key and a database that do not belong together fail loudly instead of quietly producing garbage.

## Keeping it safe

- Back the key up once, somewhere separate from database backups.
- Move it out of the data directory if you like, and point `[master_key] path` or `DOPGATE_MASTER_KEY_PATH` at it.
- Losing it means losing the signing keys, provider secrets, and SMTP password. Users and their passwords survive; you would rotate the signing key and re-enter the secrets.
