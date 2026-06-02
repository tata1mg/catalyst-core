FROM --platform=linux/amd64 node:22-alpine as build
ARG env_name
ARG env

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
COPY docs/login-page/package.json ./docs/login-page/
RUN npm --prefix docs ci

COPY docs ./docs

WORKDIR /opt/1mg/web/docs

ARG SERVICE_NAME
RUN npm -v

RUN npm run build
