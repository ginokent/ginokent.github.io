---
title: "Logging into Codex CLI on a Remote Environment Without GUI"
description: "A memo on how to log into Codex CLI on a remote environment without GUI."
publishedAt: 2025-09-13
updatedAt: 2026-01-12
tags: ["Codex"]
---

When authenticating with Codex CLI by running:

```console
$ codex login
```

The OAuth 2.0 redirect URI will be in the following format:

```txt
http://localhost:1455/auth/callback
  ?code=********nareyfq6HasaFKLa8s9v8q59eAsdPhf9-4haA9.ghq9-4haGiaaAags758uydafsiojkAODOs2579IOUho
  &scope=openid+profile+email+offline_access
  &state=********vMtCtfk87o5LoIRUgcVR54XFvaA4Gbpgc4x
```

However, when you run `codex login` on a remote environment and authenticate through your local browser, `localhost:1455` is being listened to on the remote environment, not your local machine. Naturally, the redirect fails and you cannot receive the authorization code.

In such cases, you can open another terminal on the remote server and send a request equivalent to the redirect using curl.

```console
$ curl -iL "http://localhost:1455/auth/callback?code=********nareyfq6HasaFKLa8s9v8q59eAsdPhf9-4haA9.ghq9-4haGiaaAags758uydafsiojkAODOs2579IOUho&scope=openid+profile+email+offline_access&state=********vMtCtfk87o5LoIRUgcVR54XFvaA4Gbpgc4x"
```
