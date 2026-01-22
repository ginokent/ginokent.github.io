---
title: "curl で gRPC の疎通確認"
description: "curl で gRPC の疎通確認をしたい人向けのメモ書き。"
publishedAt: 2024-12-19T09:00:00+09:00
updatedAt: 2026-01-12T09:00:00+09:00
tags: ["cURL", "gRPC", "bash"]
---

## 実行コマンド

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

空のメッセージを `/grpc.health.v1.Health/Check` 宛に送ってあげれば良い。

## 実行例

- リクエスト: `00 00 00 00 00`
  - 最初の 1 バイト `00` は圧縮フラグ（0 = 非圧縮）
  - 次の 4 バイト `00 00 00 00` はメッセージ長（0バイト）

```bash
$ printf '\x00\x00\x00\x00\x00' | curl -v -s --http2 -H "Content-Type: application/grpc" -H "TE: trailers" --data-binary @- --output - "${GRPC_ENDPOINT:?}/grpc.health.v1.Health/Check" | hexdump -C 
... 略 ...
00000000  00 00 00 00 02 08 01                              |.......|
00000007
```

- レスポンス `00 00 00 00 02 08 01`
  - 最初の5バイト `00 00 00 00 02`
    - 最初の 1 バイト `00` は圧縮フラグ（0 = 非圧縮）
    - 次の 4 バイト `00 00 00 02` はメッセージ長（2バイト）
  - 残りの2バイト `08 01`
    - これは Protocol Buffers でエンコードされたメッセージ
    - `08` は [`HealthCheckResponse`](https://github.com/grpc/grpc/blob/4a72b8844de3515f8a58058714de54d1c22a0f16/src/proto/grpc/health/v1/health.proto#L39) の field number `1` のメッセージであることを示している
      - `(field_number << 3) | wire_type` == `(status << 3) | VARINT` == `(1 << 3) | 0` == `08`
      - ref: [Message Structure | Encoding | Protocol Buffers Documentation](https://protobuf.dev/programming-guides/encoding/#structure)
    - `01` は [`ServingStatus`](https://github.com/grpc/grpc/blob/4a72b8844de3515f8a58058714de54d1c22a0f16/src/proto/grpc/health/v1/health.proto#L35) が `SERVING` であることを示している
