---
title: "備忘録 GnuPG 秘密鍵の移行"
description: "PC を新しくした際に GnuPG 秘密鍵を移行したので備忘録。"
publishedAt: 2026-01-14T09:00:00+09:00
updatedAt: 2026-01-14T09:00:00+09:00
tags: ["備忘録", "GnuPG"]
---

## 動機

PC を新しくした際に GnuPG 秘密鍵を移行したので備忘録。

## エクスポート

```bash
# エクスポートする対象の秘密鍵を確認
gpg --with-keygrip --list-secret-keys --keyid-format long

# 秘密鍵をエクスポート
gpg --armor --export-secret-keys --output "${SECRET_KEY_ID}.secret.gpg" "${SECRET_KEY_ID}"

# エクスポートする対象の公開鍵を確認
gpg --with-keygrip --list-keys --keyid-format long

# 公開鍵をエクスポート
gpg --armor --export --output "${KEY_ID}.gpg" "${KEY_ID}"
```

## インポート

```bash
# 秘密鍵をインポート
gpg --import "${SECRET_KEY_ID}.secret.gpg"

# インポートした秘密鍵を信頼する
gpg --edit-key "${SECRET_KEY_ID}"

# 信頼する
# gpg> trust

# 信頼するレベルを選択
# 5 (最も信頼する)

# 保存して終了
# gpg> save

# インポートできたことを確認
gpg --with-keygrip --list-secret-keys --keyid-format long
```

## そもそも新規作成する場合

```bash
# 新規作成
gpg --expert --full-generate-key
```

## `gpg: decryption failed: No such file or directory` が出た場合

以下を忘れている。

```bash
export GPG_TTY=$(tty)
```


## 参考

- [aws-vault using pass doesn't find gpg key · Issue #686 · 99designs/aws-vault](https://github.com/99designs/aws-vault/issues/686#issuecomment-721927306)
