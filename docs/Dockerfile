ARG BUILDPLATFORM=linux/amd64
# Pinned to the patch release, not the floating 22-alpine tag: the October 2026
# Node.js security release (22.23.4) fixed four High CVEs (TLS hostname checks,
# dns.resolve, Brotli decoder), and a cached 22-alpine layer silently kept
# serving 22.22.x. Bump this on every Node security release.
FROM --platform=$BUILDPLATFORM node:22.23.4-alpine AS build

# node:22.23.4-alpine is on alpine 3.24, which already carries the patched
# libcrypto3/libssl3 (3.5.8-r0). This upgrade is here so a cached base layer
# cannot pin us to the vulnerable 3.5.7-r0 — build with --pull as well. zlib
# is upgraded for the same reason (a Medium fixed in the current alpine repo).
RUN apk upgrade --no-cache libcrypto3 libssl3 zlib

RUN apk add --no-cache \
    make \
    g++ \
    git \
    gcc \
    shared-mime-info \
    bash

# The npm CLI vendors its own dependency tree, so scanners attribute that
# tree's CVEs to this image even though none of it appears in
# package-lock.json and none of it is reachable from `npm run serve`.
# node:22-alpine ships npm 10.x; 12.x carries patched tar, pacote, sigstore,
# picomatch, postcss-selector-parser and brace-expansion.
RUN npm install -g npm@12.0.2

# npm 12.0.2 still lags its own dependencies on several advisories, and because
# these are bundleDependencies -- shipped as files inside the npm tarball, with
# no "resolved" URL -- package.json overrides cannot reach them. Replacing the
# directories outright is the only lever left while npm stays in the image.
# Re-check these pins whenever the npm version above moves, and whenever the
# image scan (CI "Scan the docs image" step / Devtron gating) reports a node-pkg
# CVE that is not in docs/package-lock.json. Still unfixable upstream:
# http-cache-semantics 4.2.0 (no patched release; not gated).
RUN npm install -g --prefix /tmp/npmpatch \
        tar@7.5.22 \
        undici@6.29.1 \
        ip-address@10.7.4 \
        brace-expansion@5.0.12 \
        postcss-selector-parser@7.1.6 && \
    for pkg in tar undici ip-address brace-expansion postcss-selector-parser; do \
        rm -rf "/usr/local/lib/node_modules/npm/node_modules/$pkg" && \
        cp -R "/tmp/npmpatch/lib/node_modules/$pkg" \
              "/usr/local/lib/node_modules/npm/node_modules/$pkg"; \
    done && \
    rm -rf /tmp/npmpatch && \
    npm --version

WORKDIR /opt/1mg/web

ARG APP_UID=1001
ARG APP_GID=1001
ARG APP_USER=app-user
ARG APP_GROUP=app-group
RUN addgroup -g ${APP_GID} ${APP_GROUP} && \
    adduser -D -u ${APP_UID} -G ${APP_GROUP} ${APP_USER}

COPY docs/package.json docs/package-lock.json ./docs/
RUN npm --prefix docs ci

COPY docs ./docs
COPY packages/catalyst-core/changelog.md ./packages/catalyst-core/changelog.md

WORKDIR /opt/1mg/web/docs

# config.json is gitignored but baked in at build time: Devtron's pre-build
# script generates it from Vault into docs/config/ before docker build. Fall
# back to the committed template only when it's absent (local builds) — the
# template binds the server to localhost, which is unreachable behind the
# k8s ingress.
RUN [ -f config/config.json ] || cp config/config_template.json config/config.json

# Compiles content/ into routes, then builds the client and SSR bundles.
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3005

RUN chown -R ${APP_USER}:${APP_GROUP} /opt/1mg/web
USER ${APP_USER}:${APP_GROUP}

# Catalyst's own server — it serves the SSR routes plus sitemap.xml,
# robots.txt and the static assets. The Docusaurus build this replaced
# needed a separate Express app in front of it.
CMD ["npm", "run", "serve"]
