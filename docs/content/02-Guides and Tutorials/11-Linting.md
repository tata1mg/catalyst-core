---
title: Linting
slug: linting
id: linting
---

# Linting

Projects created with `create-catalyst-app@0.0.1-beta.4` or later include ESLint configuration. For older projects, follow the manual setup below.

---

## Manual Setup

### 1. Install Dependencies

```bash
npm install eslint eslint-plugin-react eslint-plugin-react-hooks --save-dev
```

### 2. Create Configuration

```json title=".eslintrc"
{
  "env": {
    "browser": true,
    "es6": true,
    "node": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:react/recommended"
  ],
  "parserOptions": {
    "sourceType": "module",
    "ecmaVersion": "latest"
  },
  "plugins": [
    "react",
    "react-hooks"
  ],
  "rules": {
    "react-hooks/exhaustive-deps": "error"
  },
  "settings": {
    "react": {
      "version": "detect"
    }
  }
}
```

### 3. Add Ignore File

```text title=".eslintignore"
build/
node_modules/
```

### 4. Add Script

```json title="package.json"
{
  "scripts": {
    "lint": "eslint ."
  }
}
```

---

## Usage

```bash
# Check for issues
npm run lint

# Fix auto-fixable issues
npm run lint -- --fix
```
