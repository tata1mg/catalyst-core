ARG BUILDPLATFORM=linux/amd64
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

RUN apk add --no-cache \
    make \
    g++ \
    git \
    gcc \
    shared-mime-info \
    bash

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

WORKDIR /opt/1mg/web/docs

# config.json is gitignored (it holds per-environment hostnames), so the image
# starts from the committed template. Overwrite or mount it at deploy time —
# leaving the template in place makes SSR emit localhost asset URLs.
RUN cp config/config_template.json config/config.json

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
