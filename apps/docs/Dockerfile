FROM --platform=linux/amd64 node:18-alpine as build
ARG env_name
ARG env

RUN apk add --no-cache \
    make \
    g++ \
    python3 \
    py3-pip \
    openssh-client \
    git \
    gcc \
    shared-mime-info \
    bash
RUN pip3 install --no-cache-dir awscli

WORKDIR /opt/1mg/web
COPY apps/docs/package.json apps/docs/package-lock.json ./apps/docs/
COPY apps/docs/server/package.json ./apps/docs/server/
COPY apps/docs/login-page/package.json ./apps/docs/login-page/
RUN npm --prefix apps/docs ci

COPY apps/docs ./apps/docs
WORKDIR /opt/1mg/web/apps/docs

ARG SERVICE_NAME
RUN npm -v

RUN npm run build
