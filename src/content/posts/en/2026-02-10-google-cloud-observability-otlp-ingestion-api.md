---
title: "Summary of Google Cloud Observability's OpenTelemetry (OTLP) Native Ingestion API"
description: "An overview of the Telemetry (OTLP) API provided by Google Cloud Observability, covering the differences from the conventional approach, configuration methods, and sample code."
publishedAt: "2026-02-10T09:00:00+09:00"
updatedAt: "2026-02-10T09:00:00+09:00"
tags: ["GCP", "OpenTelemetry", "OTLP", "Observability", "Cloud Trace", "Cloud Monitoring"]
---

## Introduction

Google Cloud Observability has introduced the Telemetry (OTLP) API (`telemetry.googleapis.com`), which natively supports telemetry data ingestion via the OpenTelemetry Protocol (OTLP).

- [OpenTelemetry now in Google Cloud Observability (Google Cloud Blog)](https://cloud.google.com/blog/products/management-tools/opentelemetry-now-in-google-cloud-observability)

Previously, sending traces and metrics to Google Cloud required integrating vendor-specific exporters (`googlecloudexporter` or `googlemanagedprometheus`) into the OpenTelemetry Collector. With the new Telemetry API, you can now send data to Google Cloud using only the standard OTLP exporter.

This article summarizes the differences from the conventional approach, configuration methods, and sample code from a user's perspective.

## Comparison with the Conventional Approach

### Before: Vendor-Specific Exporters Required

```
App → OTel SDK → OTel Collector → googlecloudexporter      → Cloud Trace API
                                 → googlemanagedprometheus  → Cloud Monitoring API
```

- Vendor-specific exporters such as `googlecloudexporter` and `googlemanagedprometheus` were required
- Conversion from OTLP format to Google Cloud's proprietary format caused data loss and constraints
- The `googlemanagedprometheus` exporter performed implicit conversions, such as replacing periods and slashes in metric names with underscores

### After: Direct Submission with the Standard OTLP Exporter

```
App → OTel SDK → telemetry.googleapis.com (OTLP native)
```

Or

```
App → OTel SDK → OTel Collector (standard otlp/otlphttp exporter) → telemetry.googleapis.com
```

- Only the standard `otlp` / `otlphttp` exporters are needed
- Data can be sent directly from the SDK without going through a Collector
- Eliminates vendor-specific dependencies, making migration to multi-cloud or OSS backends easier

### Significant Improvements to Storage Limits

Google Cloud didn't just add protocol support — it rebuilt the internal storage around the OpenTelemetry data model. As a result, the limits have been significantly relaxed compared to the conventional Cloud Trace API.

| Item | Cloud Trace API (Conventional) | Telemetry API (OTLP) |
|------|------------------------|----------------------|
| Attribute key size | 128 bytes | 512 bytes |
| Attribute value size | 256 bytes | 64 KiB |
| Span name | 128 bytes | 1,024 bytes |
| Attributes per span | 32 | 1,024 |
| Events per span | 128 | 256 |
| Links per span | - | 128 |
| Span ingestion per day | Up to 5 billion | Unlimited |

Personally, I'm glad the attribute count was expanded from 32 to 1,024.

## Supported Signals

| Signal | Status | Notes |
|---------|-----------|------|
| Traces | GA | Recommended ingestion method |
| Metrics | Preview | Announced February 2026. Requires Collector v0.140.0 or later |
| Logs | In progress | Supported via Google-Built OTel Collector |

## Endpoints

### Global Endpoints

| Protocol | Endpoint |
|-----------|--------------|
| gRPC | `telemetry.googleapis.com:443` |
| HTTP (Traces) | `https://telemetry.googleapis.com/v1/traces` |
| HTTP (Metrics) | `https://telemetry.googleapis.com/v1/metrics` |

### Regional Endpoints

Regional endpoints are available for data residency requirements.

```
https://telemetry.{REGION}.rep.googleapis.com/v1/{signal}
```

Example: `https://telemetry.us-central1.rep.googleapis.com/v1/traces`

## Authentication

### Required IAM Roles

| Signal | Role |
|---------|-------|
| Traces | `roles/telemetry.tracesWriter` |
| Metrics | `roles/monitoring.metricWriter` |
| Logs | `roles/logging.logWriter` |

### Authentication Methods

When sending directly from the SDK, use Application Default Credentials (ADC) as usual. When going through a Collector, the `googleclientauth` Extension automatically reads ADC.

When sending directly from the SDK, the gRPC exporter is recommended due to its dynamic token refresh support.

## Setup

### 1. Enable the API

```bash
gcloud services enable telemetry.googleapis.com --project=${YOUR_PROJECT_ID}
```

Starting March 4, 2026, `telemetry.googleapis.com` will be automatically activated for projects that already have Cloud Logging / Cloud Trace / Cloud Monitoring APIs enabled.

### 2. Configure IAM

```bash
# Example: Grant trace write permission to a service account
gcloud projects add-iam-policy-binding ${YOUR_PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/telemetry.tracesWriter"

# If also sending metrics
gcloud projects add-iam-policy-binding ${YOUR_PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/monitoring.metricWriter"
```

## Sample: OpenTelemetry Collector Configuration

- Key points
  - The `googleclientauth` Extension automatically reads ADC and adds authentication headers
  - The `gcp.project_id` resource attribute is required (used by the Telemetry API to determine the destination project)
  - OTLP ingestion for metrics requires Collector v0.140.0 or later

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
  # gcp.project_id resource attribute is required
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
  # Send via gRPC
  otlp/gcp:
    auth:
      authenticator: googleclientauth
    endpoint: telemetry.googleapis.com:443
  # Use this for HTTP
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

## Sample: Direct Submission from Go SDK

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
	// Get credentials from ADC
	creds, err := oauth.NewApplicationDefault(ctx,
		"https://www.googleapis.com/auth/trace.append",
		"https://www.googleapis.com/auth/cloud-platform",
	)
	if err != nil {
		return nil, err
	}

	// GCP resource detection + setting gcp.project_id
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

	// OTLP gRPC exporter configuration
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

	// Application logic goes here
	span.SetAttributes(attribute.String("greeting", "こんにちは"))
}
```

## Sample: Configuration with Environment Variables Only (Language-Agnostic)

Languages that support OpenTelemetry SDK autoconfigure can be configured using environment variables alone.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://telemetry.googleapis.com
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_RESOURCE_ATTRIBUTES="gcp.project_id=your-gcp-project-id,service.name=my-service"
```

## Pricing

The pricing structure is the same whether data is sent via OTLP or the conventional APIs.

| Signal | Price | Free Tier |
|---------|------|--------|
| Traces | $0.20 / 1 million spans | 2.5 million spans / month |
| Metrics (Prometheus format) | $0.06 / 1 million samples | - |
| Logs (standard) | $0.50 / GiB | 50 GiB / month |

## Caveats

- The `gcp.project_id` resource attribute is required
  - Data won't be associated with the correct project without it
- Use gRPC when sending directly from the SDK
  - Many SDKs don't support dynamic token refresh with HTTP exporters
- Metrics are still in preview
  - Support may be limited for production use
- INT64 metrics are converted to DOUBLE
  - Be cautious if precision is important
- Assured Workloads not supported
  - Do not use the Telemetry API if you have data residency or IL4 requirements
- Automatic activation on March 4, 2026
  - `telemetry.googleapis.com` will be automatically activated for projects with Cloud Logging / Trace / Monitoring APIs enabled

## Summary

The introduction of the Telemetry (OTLP) API has significantly simplified sending observability data to Google Cloud.

## References

- [OpenTelemetry now in Google Cloud Observability (Google Cloud Blog)](https://cloud.google.com/blog/products/management-tools/opentelemetry-now-in-google-cloud-observability)
- [OTLP for Google Cloud Monitoring metrics (Google Cloud Blog)](https://cloud.google.com/blog/products/management-tools/otlp-opentelemetry-protocol-for-google-cloud-monitoring-metrics)
- [Telemetry (OTLP) API overview](https://cloud.google.com/stackdriver/docs/reference/telemetry/overview)
- [Migrate from the Trace exporter to the OTLP endpoint](https://cloud.google.com/stackdriver/docs/instrumentation/migrate-to-otlp-endpoints)
- [Cloud Trace pricing](https://cloud.google.com/stackdriver/pricing)
