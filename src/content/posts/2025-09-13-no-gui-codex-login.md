---
title: "GUI を持たないリモート環境で Codex CLI にログイン"
description: "GUI を持たないリモート環境で Codex CLI にログインする方法をメモ書き。"
publishedAt: 2025-09-13
updatedAt: 2026-01-12
tags: ["Codex"]
---

Codex CLI の認証にあたって、

```console
$ codex login
```

を実行した際 OAuth 2.0 のリダイレクト URI は以下のような形式になる

```txt
http://localhost:1455/auth/callback
  ?code=********nareyfq6HasaFKLa8s9v8q59eAsdPhf9-4haA9.ghq9-4haGiaaAags758uydafsiojkAODOs2579IOUho
  &scope=openid+profile+email+offline_access
  &state=********vMtCtfk87o5LoIRUgcVR54XFvaA4Gbpgc4x
```

しかし、リモート環境で `codex login` を実行しローカルのブラウザで認証を行った場合、 `localhost:1455` を LISTEN しているのはローカルではなくリモート環境なので、当然リダイレクトは失敗し認可コードを受け取れない。

そんな時は、リモートサーバー上で別ターミナルを立ち上げてそこから curl でリダイレクト相当のリクエストを送ってやれば良い。

```console
$ curl -iL "http://localhost:1455/auth/callback?code=********nareyfq6HasaFKLa8s9v8q59eAsdPhf9-4haA9.ghq9-4haGiaaAags758uydafsiojkAODOs2579IOUho&scope=openid+profile+email+offline_access&state=********vMtCtfk87o5LoIRUgcVR54XFvaA4Gbpgc4x"
```
