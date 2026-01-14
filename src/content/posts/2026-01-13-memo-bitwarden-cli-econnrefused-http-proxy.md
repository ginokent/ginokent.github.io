---
title: "備忘録 Bitwarden CLI で ECONNREFUSED エラーが出たら http_proxy と https_proxy に不正な値が入っていないか確認"
description: "備忘録 Bitwarden CLI で ECONNREFUSED エラーが出たら http_proxy と https_proxy に不正な値が入っていないか確認"
publishedAt: 2026-01-13
updatedAt: 2026-01-14
tags: ["備忘録", "Bitwarden CLI"]
---

## 結論

突然 Bitwarden CLI で、何をしても ECONNREFUSED エラーが出るようになった。  
結論、別件で有効にしていたプロキシ用の環境変数 http_proxy, https_proxy に刺さったままになっており、にも関わらず SOCKS5 用の ssh 接続が切れていた。  
ただそれだけだったがしばらくハマったので書き残しておく。  

## 出たエラー

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
