---
title: "Memo: Key Establishment and Message Authentication (Diffie-Hellman Key Exchange, Public Key Cryptography, Pre-Shared Keys, Ephemeral Keys, Nonces)"
description: "A personal summary of key establishment and message authentication topics including Diffie-Hellman key exchange, public key cryptography, pre-shared keys, ephemeral keys, and nonces."
publishedAt: 2026-01-14
updatedAt: 2026-01-14
tags: ["memo", "key exchange", "message authentication", "Diffie-Hellman", "public key cryptography", "pre-shared key", "ephemeral key", "nonce"]
---

## Motivation

A personal summary of key establishment and message authentication topics including Diffie-Hellman key exchange, public key cryptography, pre-shared keys, ephemeral keys, and nonces.

---

## Q1. How does Diffie-Hellman key exchange differ from other key exchange methods?

Diffie-Hellman key exchange does not "send" a shared key. Instead, both parties exchange values that can be made public and independently generate the same shared key through mutual agreement. While eavesdroppers can see the public values, security is based on the computational difficulty of deriving the shared key from them. In contrast, Pre-Shared Key (PSK) requires distributing the same secret through a secure separate channel before communication, then using that secret for authentication and key derivation during connection. Key Transport using public key cryptography encrypts a session key with the recipient's public key and sends it; the recipient then decrypts it with their private key to obtain the shared key. Next, we compare the advantages and disadvantages of each method along the same dimensions.

---

## Q2. When comparing pre-shared key, key transport, and Diffie-Hellman key exchange, what are the fundamental differences?

Pre-shared key is computationally lightweight and relatively simple to implement, but key distribution and rotation become operational bottlenecks, and the impact of key compromise tends to be extensive. Key transport eliminates the need to distribute the same secret in advance, but typically requires mechanisms like certificates to guarantee that a public key truly belongs to the intended party. Diffie-Hellman key exchange excels at "agreeing on a shared key," but cannot authenticate the other party by itself, so it needs certificate signatures or pre-shared keys to guarantee that "this public value was produced by the intended party." Furthermore, from a forward secrecy perspective, Diffie-Hellman key exchange using ephemeral keys per connection tends to be advantageous. Next, we organize who uses ephemeral keys.

---

## Q3. Who typically uses ephemeral keys—the server, the client, or both?

Typically, both parties generate ephemeral key pairs and perform Diffie-Hellman key exchange. Using ephemeral keys for key exchange makes past session keys more resistant to long-term key compromise, providing forward secrecy. On the other hand, long-term keys are often used for authentication. For example, a server signs with the long-term private key from its certificate, and the client verifies this to confirm "this is the correct server." In other words, the typical division is "ephemeral for key exchange, long-term keys for authentication." Next, we examine how WireGuard implements this.

---

## Q4. Does WireGuard use Diffie-Hellman key exchange? What is the purpose of the public keys exchanged in advance?

WireGuard uses Elliptic-curve Diffie–Hellman (ECDH) to create a shared secret, from which session keys are derived. The peer public keys exchanged during configuration are the public keys of "long-term (fixed) static key pairs" that serve as the foundation for identifying the other party and mutual authentication. During the handshake, separate ephemeral keys are also generated and mixed in, so session keys can be updated without depending solely on static keys, enabling forward secrecy. Intuitively, "static public keys constrain who you communicate with" while "ephemeral keys create each session's communication keys." Next, we organize forward secrecy when combining pre-shared keys with ephemeral key exchange.

---

## Q5. If you authenticate with a pre-shared key and then create session keys through ephemeral Diffie-Hellman key exchange, is forward secrecy lost?

Typically, it is not lost. Forward secrecy is the property that "even if long-term secrets are leaked later, previously recorded communications remain difficult to decrypt," and ephemeral Diffie-Hellman key exchange is a prime example of achieving this property. If the pre-shared key is used for authentication purposes and the session key depends on an ephemeral shared secret, an attacker who later obtains only the pre-shared key cannot reconstruct past session keys. Conversely, if session keys are derived solely from the pre-shared key, compromise of the pre-shared key directly enables decryption of past communications, breaking forward secrecy. Next, we organize options for strengthening authentication with pre-shared keys.

---

## Q6. For authentication with pre-shared keys, are there methods stronger than HMAC-SHA256?

There are candidates, but HMAC-SHA256 is still considered standard and robust. Most issues stem from short keys, key reuse, insufficient key separation, or lack of replay protection. That said, if you want to increase strength or design margin, candidates include HMAC-SHA512 (or HMAC-SHA384) and SHA-3 family HMACs (such as HMAC-SHA3-256). Depending on the use case, you might also consider KMAC (a message authentication code from the SHA-3 family) or BLAKE2's keyed mode, but you should verify standardization and audit requirements before adoption. In practice, using sufficiently long random keys, separating keys by purpose, and implementing replay protection directly contribute to improved strength. Next, we understand nonces, the core of replay protection, through concrete examples.

---

## Q7. Why does including a nonce strengthen resistance against replay attacks?

A replay attack is when an attacker captures a legitimate request and resends it unchanged to trigger the same effect again. Even with an HMAC attached, if the message is identical, the authentication tag is also identical, so if the receiver cannot determine "whether this is the first time," it will be accepted. A nonce is a single-use value that is included in the message and also in the HMAC calculation. After verifying the signature, the server confirms the nonce has not been used before, then records it as used after processing. If an attacker resends the same request, it is rejected because the nonce is duplicated—this provides replay resistance.

---

## Q8. What types of nonce designs exist, and what should you watch out for?

In the random nonce approach, the client generates a sufficiently large random value each time, and the server maintains a set of used values for a certain period to reject duplicates. In the monotonically increasing counter approach, the client assigns numbers 1, 2, 3..., and the server only accepts numbers greater than the last accepted one. The timestamp approach can narrow the acceptance time window, but cannot completely prevent replays within that window, so if you need strict prevention, combine timestamps with a unique request identifier. In any approach, if the nonce is not included in the signed data, it can be bypassed through tampering, and if the server does not record used nonces, duplicate elimination fails. Finally, nonce scope must be separated by key or client identifier to avoid collisions and false rejections. Next, you can determine "which approach reduces operational incidents" based on your specific use case.
