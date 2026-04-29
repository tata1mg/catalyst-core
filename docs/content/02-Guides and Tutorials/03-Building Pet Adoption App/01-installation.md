---
title: Installation
slug: installation
id: installation
sidebar_position: 1
---

# Installation

## System Requirements

- Node.js version 20.4.0 or later
- macOS or Linux (Windows users should use WSL)

---

## Create a New Project

```bash
npx create-catalyst-app@latest
```

When prompted:
- Enter `pet-adoption-app` as the application name
- Choose `Redux` for state management

---

## Start Development Server

```bash
cd pet-adoption-app
npm run start
```

Your app is now running at **http://localhost:3005**. You'll see a default "Hello World" page.

---

## Project Structure

After installation, your project looks like this:

```
pet-adoption-app/
├── config/
│   └── config.json       # Environment configuration
├── src/
│   ├── js/
│   │   ├── pages/        # Page components
│   │   ├── components/   # Shared components
│   │   └── routes/       # Route definitions
│   └── static/           # CSS, fonts, images
├── client/
│   └── index.js          # Client entry point
├── server/
│   ├── document.js       # HTML template
│   └── server.js         # Express middlewares
└── package.json
```

Next, we'll create our first page with mock data.
