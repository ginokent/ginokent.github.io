---
title: "Memo: If You Get ECONNREFUSED Error with Bitwarden CLI, Check for Invalid Values in http_proxy and https_proxy"
description: "Memo: If You Get ECONNREFUSED Error with Bitwarden CLI, Check for Invalid Values in http_proxy and https_proxy"
publishedAt: 2026-01-13
updatedAt: 2026-01-14
tags: ["Bitwarden CLI", "Memo"]
---

## Conclusion

Suddenly, I started getting ECONNREFUSED errors no matter what I did with Bitwarden CLI.  
The conclusion was that the proxy environment variables http_proxy and https_proxy, which I had enabled for a different purpose, were still set, but the SSH connection for SOCKS5 had been disconnected.  
It was just that simple, but I was stuck on it for a while, so I'm documenting it here.  

## The Error

```console
$ bw
Unable to fetch ServerConfig from https://api.bitwarden.com FetchError: request to https://api.bitwarden.com/config failed, reason:
    at ClientRequest.<anonymous> (/opt/homebrew/Cellar/bitwarden-cli/2025.12.0/libexec/lib/node_modules/@bitwarden/cli/node_modules/node-fetch/lib/index.js:1505:11)
    at ClientRequest.emit (node:events:508:28)
    at emitErrorEvent (node:_http_client:108:11)
    at _destroy (node:_http_client:962:9)
    at onSocketNT (node:_http_client:982:5)
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
  type: 'system',
  errno: 'ECONNREFUSED',
  code: 'ECONNREFUSED'
}
...
```
