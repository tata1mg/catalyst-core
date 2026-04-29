---
title: Why Catalyst
slug: why-catalyst
id: why-catalyst
---

# Why Catalyst

Catalyst is a React framework for teams that need a server-rendered web app and native mobile delivery from the same product codebase. It keeps SSR, routing, and data loading at the center of the architecture while allowing native capabilities when the product needs them.

## Why Teams Pick Catalyst

- One product codebase across web and mobile
- SSR-first architecture for faster first paint and better SEO
- Native bridge APIs for camera, files, storage, haptics, notifications, and device features
- Production-oriented defaults for caching, code splitting, and deployment

## Architectural Model

Catalyst combines four layers:

1. A React web app that renders through SSR.
2. A Node server that handles HTML rendering and request orchestration.
3. A route-aware data layer built around `serverFetcher`, `clientFetcher`, and `RouterDataProvider`.
4. A native shell for Android and iOS that exposes mobile capabilities through `WebBridge`.

This structure lets teams preserve a web-first development model while shipping native applications from the same application code.

## What Catalyst Is Good At

- SEO-sensitive web experiences that still need app-store distribution
- products that share business logic across web and mobile
- teams that want React and SSR to stay central instead of maintaining a separate mobile stack
- products that need native features without moving the core UI to React Native

## Operational Advantages

- SSR and hydration give a predictable first-render model
- client-side transitions reuse the same route and data conventions
- native configuration stays in `WEBVIEW_CONFIG` instead of being spread across separate app stacks
- build paths exist for web, Android, and iOS without changing the application architecture

## What You Build with Catalyst

- SEO-heavy consumer web apps
- Mobile companion apps with shared business logic
- Internal products where one team ships all platforms
- Apps that need both SSR and native device features

## Catalyst vs Typical Choices

- Compared to web-only frameworks: Catalyst adds native app capability.
- Compared to native-only stacks: Catalyst keeps SSR web as a first-class citizen.
- Compared to generic cross-platform tools: Catalyst keeps React + SSR architecture central.

## Next Step

For setup, installation, and first app flow, use the getting-started path:

- [Getting Started](/content/Introduction/getting-started)
- [Universal App](/content/Introduction/universal-app)
