---
title: "Memo: QUIC Summary"
description: "I keep forgetting what I've learned about QUIC and end up researching the same things repeatedly, so this is a summary for my own reference."
publishedAt: 2026-01-13
updatedAt: 2026-01-14
tags: ["QUIC", "Memo"]
---

## Motivation

I keep researching QUIC only to have the information evaporate from my memory, wasting computing resources by looking up the same things over and over. So I'm writing this summary for my own reference.

## Summary of What I Roughly Remember

- What is QUIC?
  - A transport protocol standardized in RFC 9000 (May 2021)
  - Originally developed by Google and standardized by IETF
  - A transport protocol over UDP
    - TCP is implemented in the kernel, requiring OS updates which slows down development iteration
    - User-space implementation over UDP enables rapid improvements
  - Avoids Head of Line blocking issues that HTTP/2 couldn't solve
  - 0-RTT handshake
    - Can send data from the first packet when connecting to a previously visited server
    - Where TCP + TLS required 1-RTT to 2-RTT, connections can now be established with 0-RTT
  - Connection migration
    - Connections can be maintained even when IP address changes (e.g., WiFi → mobile network)
    - Connections are identified by Connection ID, allowing continuation even when IP/port changes
  - Encryption by default
    - TLS 1.3 is built in, and all communications are encrypted
    - Unlike TCP, plaintext communication is not possible
- What is HTTP/3?
  - The next generation version of HTTP that runs over QUIC (RFC 9114)
  - HTTP/1.1 → over TCP
  - HTTP/2 → over TCP (with multiplexing, but HoL blocking at TCP level)
  - HTTP/3 → over QUIC (UDP) (with multiplexing, HoL blocking avoided)
  - Inherits HTTP/2 features (header compression, server push, etc.) while enjoying the benefits of QUIC

## Summary of Things That Quickly Become Unclear

- What is QUIC Datagram?
  - A QUIC extension defined in RFC 9221
  - Enables unreliable data transfer like UDP, without using QUIC stream's reliability guarantees (retransmission, ordering)
  - Suitable for use cases where low latency is critical (real-time games, live streaming, VoIP, etc.)
  - Allows sending and receiving at the datagram level while enjoying QUIC's connection establishment and encryption benefits
- What is WebTransport?
  - A web-oriented transport layer API based on HTTP/3 (QUIC)
  - Positioned as a successor to WebSocket, enabling lower latency and more flexible bidirectional communication
  - Can multiplex multiple streams between server and client
  - Provides the following two APIs:
  - What is WebTransport Datagram API?
    - An unreliable data transfer API using QUIC Datagram
    - Works like UDP
    - No ordering guarantee, no retransmission
    - For use cases that can tolerate packet loss but require low latency (game position data, video frames, etc.)
  - What is WebTransport Stream API?
    - A reliable data transfer API using QUIC Stream
    - Works like TCP
    - With ordering guarantee and retransmission
    - Multiple independent streams can be opened simultaneously, so if one stream is blocked, it doesn't affect others (HoL blocking avoided)

## References

- [How to use WebTransport  |  Capabilities  |  Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/webtransport?hl=en)
