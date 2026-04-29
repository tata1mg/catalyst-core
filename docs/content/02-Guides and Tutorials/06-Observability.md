---
title: OpenTelemetry Integration
slug: opentelemetry-integration
id: opentelemetry-integration
---

# OpenTelemetry Integration

Catalyst applications can be instrumented with OpenTelemetry from the server startup path. The right place to initialize telemetry is `preServerInit()` in `server/index.js`, because it runs before the Express server begins handling traffic.

---

## Installation

Install the required OpenTelemetry packages for automatic instrumentation:

```bash
npm install @opentelemetry/auto-instrumentations-node @opentelemetry/sdk-node
```

## Quick Setup

Import the OpenTelemetry SDK from catalyst-core:

```javascript
import Otel from "catalyst-core/otel";
```

Initialize OpenTelemetry in your `preServerInit()` function in `server/index.js`:

```javascript
const preServerInit = () => {
    Otel.init();
};
```

This gives you a minimal integration with automatic instrumentation and default export settings.

## Why `preServerInit()` Matters

`preServerInit()` runs before the server starts accepting requests. That makes it the correct place for:

- telemetry bootstrap
- logger setup
- shared service initialization
- startup-only configuration

Initializing telemetry later in the request lifecycle risks missing early startup spans and server-level failures.

## Configuration

You can customize the OpenTelemetry setup by passing a configuration object to `Otel.init()`:

```javascript
const preServerInit = () => {
    Otel.init({
        serviceName: "my-service",
        serviceVersion: "1.0.0",
        environment: "production",
        traceUrl: "http://localhost:4318/v1/traces",
        metricUrl: "http://localhost:4318/v1/metrics",
        traceHeaders: {
            "Authorization": "Bearer your-token"
        },
        metricHeaders: {
            "Authorization": "Bearer your-token"
        },
        exportIntervalMillis: 5000,
        exportTimeoutMillis: 30000
    });
};
```

### Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `serviceName` | string | Name of your service | `"catalyst-app"` |
| `serviceVersion` | string | Version of your service | `"1.0.0"` |
| `environment` | string | Environment (dev, staging, prod) | `"development"` |
| `traceUrl` | string | OTLP trace export endpoint | `"http://localhost:4318/v1/traces"` |
| `metricUrl` | string | OTLP metric export endpoint | `"http://localhost:4318/v1/metrics"` |
| `traceHeaders` | object | Headers for trace export | `{}` |
| `metricHeaders` | object | Headers for metric export | `{}` |
| `exportIntervalMillis` | number | Metric export interval in ms | `10000` |
| `exportTimeoutMillis` | number | Export timeout in ms | `10000` |

## Production Guidance

- Set a stable `serviceName`, `serviceVersion`, and `environment`.
- Point `traceUrl` and `metricUrl` at a real OTLP collector or managed endpoint.
- Use export headers only for credentials or tenant routing, not as a substitute for proper endpoint configuration.
- Keep startup instrumentation in the server layer rather than scattering it across app modules.

## Manual Setup

For more control over the OpenTelemetry configuration, you can set it up manually using the Node SDK:

```javascript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';

const preServerInit = () => {
    const sdk = new NodeSDK({
        resource: new Resource({
            [ATTR_SERVICE_NAME]: 'catalyst-app',
        }),
        spanProcessor: new SimpleSpanProcessor(new OTLPTraceExporter()),
    });
    
    sdk.start();
};
```

## Local Verification

You need an OpenTelemetry collector with a compatible backend to test OpenTelemetry traces locally.

### Setting Up a Local OpenTelemetry Collector

The OpenTelemetry Collector acts as a middleman between your application and observability backends. It receives, processes, and exports telemetry data. Here are several options for local testing:

#### Option 1: Docker Compose with Jaeger and Prometheus

Create a `docker-compose.yml` file for a complete observability stack:

```yaml
version: '3.8'
services:
  # Jaeger
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "14268:14268"
    environment:
      - COLLECTOR_OTLP_ENABLED=true

  # OpenTelemetry Collector
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317"   # OTLP gRPC receiver
      - "4318:4318"   # OTLP HTTP receiver
    depends_on:
      - jaeger

    # Prometheus
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yaml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
```

Create an `otel-collector-config.yaml` file:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:

exporters:
  jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true
  prometheus:
    endpoint: "0.0.0.0:8889"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

Create a `prometheus.yaml` file

```yaml
scrape_configs:
  - job_name: 'otel-collector'
    static_configs:
      - targets: ['otel-collector:8889']
    scrape_interval: 10s
    metrics_path: /metrics
```

Start the stack: `docker-compose up -d`

Access Jaeger UI at: http://localhost:16686
Access Prometheus UI at: http://localhost:9090

You can also set up a custom Grafana instance linking to Prometheus for advanced dashboards and alerting
For more details see: [Grafana](https://grafana.com/docs/grafana/latest/getting-started/get-started-grafana-prometheus/#configure-prometheus-for-grafana)

#### Option 2: Console Exporter

For quick debugging without external dependencies, use the console exporter:

```javascript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const preServerInit = () => {
    const sdk = new NodeSDK({
        resource: new Resource({
            [ATTR_SERVICE_NAME]: 'catalyst-app-debug',
        }),
        traceExporter: new ConsoleSpanExporter(),
    });
    
    sdk.start();
};
```

## Compatible Backends

Popular observability backends that work with OpenTelemetry:

- **Jaeger**: Open-source distributed tracing platform
- **Zipkin**: Distributed tracing system
- **Grafana Cloud**: Managed observability platform
- **New Relic**: Full-stack observability
- **Datadog**: Cloud monitoring platform
- **Honeycomb**: Observability for complex systems
- **Lightstep**: Distributed tracing and performance monitoring

## Verifying Your Setup

1. Start your observability backend
2. Run your Catalyst application with OpenTelemetry enabled
3. Make some requests to your application
4. Check your backend's UI for traces and metrics

For Jaeger, visit http://localhost:16686 and select your service from the dropdown to view traces.
