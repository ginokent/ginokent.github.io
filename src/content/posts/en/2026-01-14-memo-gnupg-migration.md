---
title: "Memo: GnuPG Secret Key Migration"
description: "A memo on migrating GnuPG secret keys when setting up a new PC."
publishedAt: 2026-01-14T09:00:00+09:00
updatedAt: 2026-01-14T09:00:00+09:00
tags: ["Memo", "GnuPG"]
---

## Motivation

I migrated my GnuPG secret keys when setting up a new PC, so here's a memo for future reference.

## Export

```bash
# Check the secret key to export
gpg --with-keygrip --list-secret-keys --keyid-format long

# Export the secret key
gpg --armor --export-secret-keys --output "${SECRET_KEY_ID}.secret.gpg" "${SECRET_KEY_ID}"

# Check the public key to export
gpg --with-keygrip --list-keys --keyid-format long

# Export the public key
gpg --armor --export --output "${KEY_ID}.gpg" "${KEY_ID}"
```

## Import

```bash
# Import the secret key
gpg --import "${SECRET_KEY_ID}.secret.gpg"

# Trust the imported secret key
gpg --edit-key "${SECRET_KEY_ID}"

# Trust
# gpg> trust

# Select trust level
# 5 (ultimate trust)

# Save and exit
# gpg> save

# Verify the import was successful
gpg --with-keygrip --list-secret-keys --keyid-format long
```

## Creating a New Key from Scratch

```bash
# Create a new key
gpg --expert --full-generate-key
```

## If You Get `gpg: decryption failed: No such file or directory`

You forgot to set the following:

```bash
export GPG_TTY=$(tty)
```

## References

- [aws-vault using pass doesn't find gpg key · Issue #686 · 99designs/aws-vault](https://github.com/99designs/aws-vault/issues/686#issuecomment-721927306)
