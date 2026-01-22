---
title: "Testing gRPC Connectivity with curl"
description: "A quick note for those who want to test gRPC connectivity using curl."
publishedAt: 2024-12-19T09:00:00+09:00
updatedAt: 2026-01-12T09:00:00+09:00
tags: ["cURL", "gRPC", "bash"]
---

## Command

```sh
printf '\x00\x00\x00\x00\x00' |
  curl \
    -v -s --http2 \
    --data-binary @- \
    --output - \
    -H "Content-Type: application/grpc" \
    -H "TE: trailers" \
    "${GRPC_ENDPOINT:?}/grpc.health.v1.Health/Check" |
  hexdump -C 
```

Simply send an empty message to `/grpc.health.v1.Health/Check`.

## Example

- Request: `00 00 00 00 00`
  - The first byte `00` is the compression flag (0 = uncompressed)
  - The next 4 bytes `00 00 00 00` represent the message length (0 bytes)

```bash
$ printf '\x00\x00\x00\x00\x00' | curl -v -s --http2 -H "Content-Type: application/grpc" -H "TE: trailers" --data-binary @- --output - "${GRPC_ENDPOINT:?}/grpc.health.v1.Health/Check" | hexdump -C 
... omitted ...
00000000  00 00 00 00 02 08 01                              |.......|
00000007
```

- Response `00 00 00 00 02 08 01`
  - The first 5 bytes `00 00 00 00 02`
    - The first byte `00` is the compression flag (0 = uncompressed)
    - The next 4 bytes `00 00 00 02` represent the message length (2 bytes)
  - The remaining 2 bytes `08 01`
    - This is a Protocol Buffers encoded message
    - `08` indicates this is field number `1` of [`HealthCheckResponse`](https://github.com/grpc/grpc/blob/4a72b8844de3515f8a58058714de54d1c22a0f16/src/proto/grpc/health/v1/health.proto#L39)
      - `(field_number << 3) | wire_type` == `(status << 3) | VARINT` == `(1 << 3) | 0` == `08`
      - ref: [Message Structure | Encoding | Protocol Buffers Documentation](https://protobuf.dev/programming-guides/encoding/#structure)
    - `01` indicates that [`ServingStatus`](https://github.com/grpc/grpc/blob/4a72b8844de3515f8a58058714de54d1c22a0f16/src/proto/grpc/health/v1/health.proto#L35) is `SERVING`
