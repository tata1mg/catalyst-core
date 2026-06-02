ARG BUILDPLATFORM=linux/amd64
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
ARG env_name
ARG env

RUN npm install -g npm@latest

RUN apk add --no-cache \
    make \
    g++ \
    git \
    gcc \
    shared-mime-info \
    bash

WORKDIR /opt/1mg/web

COPY docs/package.json docs/package-lock.json ./docs/
COPY docs/server/package.json ./docs/server/
RUN npm --prefix docs ci

COPY docs ./docs

WORKDIR /opt/1mg/web/docs

ARG SERVICE_NAME
RUN npm -v

RUN npm run build
