---
title: "Rakuten Mobile 5G 回線で net::ERR_CONNECTION_RESET が頻発する問題と解決策"
description: "Rakuten Mobile 5G 回線で net::ERR_CONNECTION_RESET が頻発する問題と解決策について書き残す。"
publishedAt: 2026-01-11
updatedAt: 2026-01-12
tags: ["Rakuten Mobile", "net::ERR_CONNECTION_RESET", "BIG-IP", "WireGuard"]
---

将来の自分への備忘録、及び同じ症状に苦しむ方向けに公開。

## 結論

- Rakuten Mobile 5G 回線を使用していると、ブラウジング中に `net::ERR_CONNECTION_RESET` が頻発することがある
- 原因は Rakuten Mobile のネットワーク内にある中間装置 (BIG-IP と思われる) が TCP 接続に RST を注入しているためだと考えられる
- VPN (WireGuard など) を使用することで回避できる

## 症状

- スピードテストは正常 (高速)
- Web ページの読み込みが遅い、または失敗する
- Chrome 開発者ツールで `net::ERR_CONNECTION_RESET` が頻発
- 特定のサイトではなくランダムに発生
- MTU を調整しても完全には解決しない

## 推定原因

tcpdump で RST パケットをキャプチャすると、以下のようなパケットが観測される:

```
$ tcpdump -i eth0 -n 'tcp[tcpflags] & (tcp-rst) != 0' -v
...
172.217.213.100.443 > 192.168.x.x.58932: Flags [R.], ... length 46 [RST+ BIG-IP: [0x2664c65:2574] No fl]
142.250.199.46.443 > 192.168.x.x.58661: Flags [R.], ... length 46 [RST+ BIG-IP: [0x2664c65:2574] No fl]
```

通常の TCP RST は length 0 だが、このパケットは length 46 で `BIG-IP: ...` という文字列を含んでいる。

Google の複数の IP アドレスから同一のシグネチャを持つ RST が来ていることから、Google ではなく経路上の中間装置が RST を注入していると考えられる。

```
[PC] → [ルーター] → [Rakuten 5G] → [CGNAT/DPI (BIG-IP?)] → [Internet] → [Google]
                                          ↑
                                  ここで RST が注入されていると推測
                                  (送信元 IP を Google に偽装)
```

## 解決策

VPN (WireGuard) を使用することにした。中間装置は TCP ヘッダを解析できなくなるため、 RST を注入できなくなる。

```
[PC] → [ルーター] → [Rakuten 5G] → [中間装置] → [Internet] → [VPN Server]
                                        ↑
                                UDP でカプセル化されているため
                                TCP セッションが見えない
```

---

## 調査の詳細

以下、原因特定に至るまでの調査過程を記録しておく。

### MTU 問題の疑い (初期仮説)

最初は MTU 問題を疑った。Path MTU Discovery テストを実施:

```bash
# MTU 1500 でテスト → 失敗
$ ping -D -s 1472 google.com -c 5
556 bytes from xxx.xxx.xxx.xxx: frag needed and DF set (MTU 1440)

# MTU 1400 でテスト → 失敗
$ ping -D -s 1372 google.com -c 5
36 bytes from xxx.xxx.xxx.xxx: frag needed and DF set (MTU 1380)

# MTU 1300 でテスト → 成功
$ ping -D -s 1272 google.com -c 5
5 packets transmitted, 5 packets received, 0.0% packet loss
```

経路上の実効 Path MTU は 1380 だった。

クライアント側の MTU を調整:

```bash
# Linux
sudo ip link set eth0 mtu 1340

# macOS
sudo ifconfig en0 mtu 1340

# Windows (管理者権限の PowerShell)
netsh interface ipv4 set subinterface "イーサネット" mtu=1340 store=persistent
```

ブラウジングは改善したが、`ERR_CONNECTION_RESET` は継続した。

### ルーターで MSS Clamping を設定

ルーター側で TCP MSS Clamping を設定:

```bash
iptables -t mangle -I FORWARD 1 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1340
```

tcpdump で確認すると MSS は正しく適用されていた:

```bash
$ tcpdump -i <wan_interface> -n 'tcp[tcpflags] & (tcp-syn) != 0' -v
192.168.x.x.12345 > 160.251.209.90.25252: ... options [mss 1340, ...]
```

しかし、`ERR_CONNECTION_RESET` は継続。この時点で MTU/MSS 問題ではないことがわかった。

### RST パケットの調査

RST パケットをキャプチャ:

```bash
tcpdump -i <wan_interface> -n 'tcp[tcpflags] & (tcp-rst) != 0' -v
```

結果は前述の通り、BIG-IP のシグネチャを含む RST が観測された。

## 診断に使用したコマンド

```bash
# MTU テスト (DF フラグ付き ping)
ping -D -s 1472 google.com -c 5

# TCP SYN パケットの MSS 確認
tcpdump -i <interface> -n 'tcp[tcpflags] & (tcp-syn) != 0' -v

# TCP RST パケットのキャプチャ
tcpdump -i <interface> -n 'tcp[tcpflags] & (tcp-rst) != 0' -v

# MSS Clamping の設定 (Linux ルーター)
iptables -t mangle -I FORWARD 1 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1340
```

## その他メモ

- 常識的な使い方をしている方だと思うが、こんな頻繁に RST が出るのは正しい挙動？
- パケットの "No fl" == "No flow found" の断片？
- キャリアグレード NAT のセッション管理コケてるとか？
