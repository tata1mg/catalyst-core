---
title: Folder Structure
slug: folder-structure
id: folder-structure
---

# Folder Structure

This page provides an overview of the project structure of a Catalyst app.

---

## Top-Level Folders

| Folder | Purpose |
|--------|---------|
| `config` | Configuration keys (environment variables for server and client) |
| `src` | Application source code |
| `client` | Client app entry point |
| `server` | Server code (middlewares, controllers, APIs) |
| `public` | Static assets served as-is (favicons, manifests, `offline.html`) |
| `build` | Bundled output (generated after build) |

---

## Configuration Files

| File | Purpose |
|------|---------|
| `config/config.json` | Environment variables for server and client |
| `src/js/routes/index.js` | Route definitions |
| `src/js/store/index.js` | Redux store configuration (optional) |
| `client/index.js` | Client app entry point |
| `server/document.js` | HTML document template |
| `server/index.js` | Server lifecycle hooks |
| `server/server.js` | Express middlewares |

---

## Static Assets

| Directory | Purpose |
|-----------|---------|
| `src/static/css` | Global stylesheets |
| `src/static/fonts` | Font files |
| `public/` | Static files served at root path |
