---
title: "Google Cloud Observability の OpenTelemetry (OTLP) ネイティブ取り込み API まとめ"
description: "Google Cloud Observability が提供する Telemetry (OTLP) API について、従来の方式との違い、設定方法、サンプルコードを交えて解説する。"
publishedAt: "2026-02-10T09:00:00+09:00"
updatedAt: "2026-02-10T09:00:00+09:00"
tags: ["GCP", "OpenTelemetry", "OTLP", "Observability", "Cloud Trace", "Cloud Monitoring"]
---

## はじめに

Google Cloud Observability が Telemetry (OTLP) API (`telemetry.googleapis.com`) を提供し、OpenTelemetry Protocol (OTLP) によるテレメトリデータのネイティブ取り込みに対応したらしい。

- [OpenTelemetry now in Google Cloud Observability (Google Cloud Blog)](https://cloud.google.com/blog/products/management-tools/opentelemetry-now-in-google-cloud-observability)

これまで Google Cloud にトレースやメトリクスを送信するには、OpenTelemetry Collector にベンダー固有のエクスポーター (`googlecloudexporter` や `googlemanagedprometheus`) を組み込む必要があったが、新しい Telemetry API では 標準の OTLP エクスポーターだけ で Google Cloud にデータを送信できるようになった。

この記事では利用者目線で、従来の方式との違い、設定方法、サンプルコードをまとめる。

## 従来の方式との比較

### Before: ベンダー固有エクスポーターが必要

```
アプリ → OTel SDK → OTel Collector → googlecloudexporter      → Cloud Trace API
                                    → googlemanagedprometheus  → Cloud Monitoring API
```

- `googlecloudexporter`, `googlemanagedprometheus` 等のベンダー固有エクスポーターが必要
- OTLP 形式から Google Cloud 独自形式への変換が発生し、データの欠落や制約に悩まされる
- `googlemanagedprometheus` エクスポーターはメトリクス名のピリオドやスラッシュをアンダースコアに変換するなど、暗黙の変換がある

### After: 標準 OTLP エクスポーターで直接送信

```
アプリ → OTel SDK → telemetry.googleapis.com (OTLP ネイティブ)
```

もしくは

```
アプリ → OTel SDK → OTel Collector (標準 otlp/otlphttp exporter) → telemetry.googleapis.com
```

- 標準の `otlp` / `otlphttp` エクスポーターのみで送信可能
- Collector を経由せず SDK から直接送信することもできる
- ベンダー固有の依存が不要になり、マルチクラウドや OSS バックエンドへの移行が容易

### ストレージ制限の大幅改善

Google Cloud は単にプロトコルをサポートしただけでなく、内部ストレージを OpenTelemetry データモデルに再構築 している。その結果、従来の Cloud Trace API と比較して制限が大幅に緩和された。

| 項目 | Cloud Trace API (従来) | Telemetry API (OTLP) |
|------|------------------------|----------------------|
| Attribute キーサイズ | 128 バイト | 512 バイト |
| Attribute 値サイズ | 256 バイト | 64 KiB |
| Span 名 | 128 バイト | 1,024 バイト |
| Span あたりの Attribute 数 | 32 | 1,024 |
| Span あたりの Event 数 | 128 | 256 |
| Span あたりの Link 数 | - | 128 |
| 1 日あたりの Span 取り込み | 最大 50 億 | 無制限 |

個人的には Attribute 数が 32 → 1,024 に拡大されたのが嬉しい。

## 対応シグナル

| シグナル | ステータス | 備考 |
|---------|-----------|------|
| トレース | GA | 推奨される取り込み方式 |
| メトリクス | プレビュー | 2026 年 2 月発表。Collector v0.140.0 以上が必要 |
| ログ | 対応進行中 | Google-Built OTel Collector 経由では対応 |

## エンドポイント

### グローバルエンドポイント

| プロトコル | エンドポイント |
|-----------|--------------|
| gRPC | `telemetry.googleapis.com:443` |
| HTTP (トレース) | `https://telemetry.googleapis.com/v1/traces` |
| HTTP (メトリクス) | `https://telemetry.googleapis.com/v1/metrics` |

### リージョナルエンドポイント

データレジデンシー要件がある場合は、リージョナルエンドポイントを使用できる。

```
https://telemetry.{REGION}.rep.googleapis.com/v1/{signal}
```

例: `https://telemetry.us-central1.rep.googleapis.com/v1/traces`

## 認証

### 必要な IAM ロール

| シグナル | ロール |
|---------|-------|
| トレース | `roles/telemetry.tracesWriter` |
| メトリクス | `roles/monitoring.metricWriter` |
| ログ | `roles/logging.logWriter` |

### 認証方式

SDK から直接送信する場合はいつも通り Application Default Credentials (ADC) を使用する。Collector 経由の場合は `googleclientauth` Extension が ADC を自動的に読み取る。

なお SDK から直接送信する場合、動的トークンリフレッシュの対応状況から gRPC エクスポーターの使用が推奨されている。

## セットアップ

### 1. API の有効化

```bash
gcloud services enable telemetry.googleapis.com --project=${YOUR_PROJECT_ID}
```

2026 年 3 月 4 日以降は Cloud Logging / Cloud Trace / Cloud Monitoring の各 API が有効化されているプロジェクトでは `telemetry.googleapis.com` が自動的にアクティベートされる。

### 2. IAM の設定

```bash
# サービスアカウントにトレース書き込み権限を付与する例
gcloud projects add-iam-policy-binding ${YOUR_PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/telemetry.tracesWriter"

# メトリクスも送信する場合
gcloud projects add-iam-policy-binding ${YOUR_PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/monitoring.metricWriter"
```

## サンプル: OpenTelemetry Collector の設定

- 要点
  - `googleclientauth` Extension が ADC を自動的に読み取り、認証ヘッダーを付与する
  - `gcp.project_id` リソース属性は必須 (Telemetry API がデータの送信先プロジェクトを決定するために使用)
  - メトリクスの OTLP 取り込みには Collector v0.140.0 以上 が必要

```yaml otel-collector-config.yaml
extensions:
  googleclientauth:

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  # gcp.project_id リソース属性は必須
  resource/gcp:
    attributes:
      - key: gcp.project_id
        value: "your-gcp-project-id"
        action: insert
  batch:
    send_batch_max_size: 200
  memory_limiter:
    check_interval: 1s
    limit_mib: 4000
    spike_limit_mib: 800

exporters:
  # gRPC で送信
  otlp/gcp:
    auth:
      authenticator: googleclientauth
    endpoint: telemetry.googleapis.com:443
  # HTTP で送信する場合はこちら
  otlphttp/gcp:
    auth:
      authenticator: googleclientauth
    endpoint: https://telemetry.googleapis.com
    encoding: proto

service:
  extensions: [googleclientauth]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, resource/gcp, batch]
      exporters: [otlp/gcp]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resource/gcp, batch]
      exporters: [otlphttp/gcp]
```

## サンプル: Go SDK から直接送信

```go main.go
package main

import (
	"context"
	"log"
	"time"

	"go.opentelemetry.io/contrib/detectors/gcp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/oauth"
)

func initTracer(ctx context.Context, projectID string) (func(), error) {
	// ADC から認証情報を取得
	creds, err := oauth.NewApplicationDefault(ctx,
		"https://www.googleapis.com/auth/trace.append",
		"https://www.googleapis.com/auth/cloud-platform",
	)
	if err != nil {
		return nil, err
	}

	// GCP リソース検出 + gcp.project_id の設定
	res, err := resource.New(ctx,
		resource.WithDetectors(gcp.NewDetector()),
		resource.WithTelemetrySDK(),
		resource.WithAttributes(
			semconv.ServiceName("my-service"),
			attribute.String("gcp.project_id", projectID),
		),
	)
	if err != nil {
		return nil, err
	}

	// OTLP gRPC エクスポーターの設定
	exporter, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint("telemetry.googleapis.com:443"),
		otlptracegrpc.WithDialOption(grpc.WithPerRPCCredentials(creds)),
	)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := tp.Shutdown(ctx); err != nil {
			log.Printf("failed to shutdown tracer provider: %v", err)
		}
	}, nil
}

func main() {
	ctx := context.Background()
	shutdown, err := initTracer(ctx, "your-gcp-project-id")
	if err != nil {
		log.Fatal(err)
	}
	defer shutdown()

	tracer := otel.Tracer("example")
	ctx, span := tracer.Start(ctx, "hello-world")
	defer span.End()

	// ここにアプリケーションロジック
	span.SetAttributes(attribute.String("greeting", "こんにちは"))
}
```

## サンプル: 環境変数のみで設定 (言語非依存)

OpenTelemetry SDK の自動構成 (autoconfigure) に対応している言語は環境変数だけで設定できる。

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://telemetry.googleapis.com
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_RESOURCE_ATTRIBUTES="gcp.project_id=your-gcp-project-id,service.name=my-service"
```

## 料金

OTLP 経由でも従来の API 経由でも料金体系に差はない。

| シグナル | 料金 | 無料枠 |
|---------|------|--------|
| トレース | $0.20 / 100 万 Span | 250 万 Span / 月 |
| メトリクス (Prometheus 形式) | $0.06 / 100 万サンプル | - |
| ログ (標準) | $0.50 / GiB | 50 GiB / 月 |

## 注意点

- `gcp.project_id` リソース属性は必須
  - 設定しないとデータが正しいプロジェクトに紐づかない
- SDK 直接送信時は gRPC を使う
  - HTTP エクスポーターは動的トークンリフレッシュに対応していない SDK が多い
- メトリクスはまだプレビュー
  - 本番利用する場合はサポートが制限される可能性がある
- INT64 メトリクスは DOUBLE に変換される
  - 精度が必要な場合は注意
- Assured Workloads 非対応
  - データレジデンシーや IL4 要件がある場合は Telemetry API を使用しないこと
- 2026 年 3 月 4 日の自動有効化
  - Cloud Logging / Trace / Monitoring API が有効なプロジェクトでは `telemetry.googleapis.com` が自動的にアクティベートされる。

## まとめ

Telemetry (OTLP) API の登場により、Google Cloud への Observability データ送信が大幅にシンプルになった。

## 参考リンク

- [OpenTelemetry now in Google Cloud Observability (Google Cloud Blog)](https://cloud.google.com/blog/products/management-tools/opentelemetry-now-in-google-cloud-observability)
- [OTLP for Google Cloud Monitoring metrics (Google Cloud Blog)](https://cloud.google.com/blog/products/management-tools/otlp-opentelemetry-protocol-for-google-cloud-monitoring-metrics)
- [Telemetry (OTLP) API overview](https://cloud.google.com/stackdriver/docs/reference/telemetry/overview)
- [Migrate from the Trace exporter to the OTLP endpoint](https://cloud.google.com/stackdriver/docs/instrumentation/migrate-to-otlp-endpoints)
- [Cloud Trace の料金](https://cloud.google.com/stackdriver/pricing)
