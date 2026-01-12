---
title: "Frequent net::ERR_CONNECTION_RESET Issues on Rakuten Mobile 5G and How to Fix Them"
description: "Documenting the frequent net::ERR_CONNECTION_RESET issues on Rakuten Mobile 5G and how to resolve them."
publishedAt: 2026-01-11
updatedAt: 2026-01-12
tags: ["Rakuten Mobile", "net::ERR_CONNECTION_RESET", "BIG-IP", "WireGuard"]
---

Publishing this as a memo for my future self and for others experiencing the same issue.

## Conclusion

- When using Rakuten Mobile 5G, you may frequently encounter `net::ERR_CONNECTION_RESET` while browsing
- The cause appears to be a middlebox (likely BIG-IP) within Rakuten Mobile's network injecting RST packets into TCP connections
- This can be avoided by using a VPN (such as WireGuard)

## Symptoms

- Speed tests are normal (fast)
- Web pages load slowly or fail to load
- `net::ERR_CONNECTION_RESET` appears frequently in Chrome DevTools
- Occurs randomly, not on specific sites
- Adjusting MTU does not completely resolve the issue

## Suspected Cause

When capturing RST packets with tcpdump, the following packets are observed:

```
$ tcpdump -i eth0 -n 'tcp[tcpflags] & (tcp-rst) != 0' -v
...
172.217.213.100.443 > 192.168.x.x.58932: Flags [R.], ... length 46 [RST+ BIG-IP: [0x2664c65:2574] No fl]
142.250.199.46.443 > 192.168.x.x.58661: Flags [R.], ... length 46 [RST+ BIG-IP: [0x2664c65:2574] No fl]
```

Normal TCP RST packets have length 0, but these packets have length 46 and contain the string `BIG-IP: ...`.

Since RST packets with the same signature are coming from multiple Google IP addresses, it's believed that a middlebox along the route is injecting RST packets rather than Google itself.

```
[PC] → [Router] → [Rakuten 5G] → [CGNAT/DPI (BIG-IP?)] → [Internet] → [Google]
                                          ↑
                                  RST packets suspected to be
                                  injected here (spoofing source IP as Google)
```

## Solution

I decided to use a VPN (WireGuard). Since the middlebox can no longer parse TCP headers, it cannot inject RST packets.

```
[PC] → [Router] → [Rakuten 5G] → [Middlebox] → [Internet] → [VPN Server]
                                        ↑
                                Encapsulated in UDP, so
                                TCP sessions are not visible
```

---

## Investigation Details

Below is a record of the investigation process that led to identifying the cause.

### Suspecting MTU Issues (Initial Hypothesis)

Initially, I suspected MTU issues. I conducted a Path MTU Discovery test:

```bash
# Test with MTU 1500 → Failed
$ ping -D -s 1472 google.com -c 5
556 bytes from xxx.xxx.xxx.xxx: frag needed and DF set (MTU 1440)

# Test with MTU 1400 → Failed
$ ping -D -s 1372 google.com -c 5
36 bytes from xxx.xxx.xxx.xxx: frag needed and DF set (MTU 1380)

# Test with MTU 1300 → Succeeded
$ ping -D -s 1272 google.com -c 5
5 packets transmitted, 5 packets received, 0.0% packet loss
```

The effective Path MTU along the route was 1380.

Adjusting the client-side MTU:

```bash
# Linux
sudo ip link set eth0 mtu 1340

# macOS
sudo ifconfig en0 mtu 1340

# Windows (PowerShell with admin privileges)
netsh interface ipv4 set subinterface "Ethernet" mtu=1340 store=persistent
```

Browsing improved, but `ERR_CONNECTION_RESET` continued.

### Configuring MSS Clamping on the Router

I configured TCP MSS Clamping on the router:

```bash
iptables -t mangle -I FORWARD 1 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1340
```

Verifying with tcpdump showed the MSS was correctly applied:

```bash
$ tcpdump -i <wan_interface> -n 'tcp[tcpflags] & (tcp-syn) != 0' -v
192.168.x.x.12345 > 160.251.209.90.25252: ... options [mss 1340, ...]
```

However, `ERR_CONNECTION_RESET` continued. At this point, it became clear this was not an MTU/MSS issue.

### Investigating RST Packets

Capturing RST packets:

```bash
tcpdump -i <wan_interface> -n 'tcp[tcpflags] & (tcp-rst) != 0' -v
```

As mentioned earlier, RST packets containing the BIG-IP signature were observed.

## Commands Used for Diagnosis

```bash
# MTU test (ping with DF flag)
ping -D -s 1472 google.com -c 5

# Check MSS in TCP SYN packets
tcpdump -i <interface> -n 'tcp[tcpflags] & (tcp-syn) != 0' -v

# Capture TCP RST packets
tcpdump -i <interface> -n 'tcp[tcpflags] & (tcp-rst) != 0' -v

# Configure MSS Clamping (Linux router)
iptables -t mangle -I FORWARD 1 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1340
```

## Additional Notes

- I believe I'm using the service in a typical manner, but is it normal to see RST packets this frequently?
- Could "No fl" in the packet be a fragment of "No flow found"?
- Could this be a session management failure in the carrier-grade NAT?
