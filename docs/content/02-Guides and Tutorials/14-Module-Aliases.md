---
title: Module Aliases
slug: module-aliases
id: module-aliases
---
# Module Aliases

Catalyst supports module aliases to create shorter, more descriptive import paths. These come pre-configured when setting up a new project.

## Default Aliases

| Alias | Path |
|-------|------|
| `@pages` | `src/js/pages` |
| `@components` | `src/js/components` |
| `@containers` | `src/js/containers` |
| `@reducers` | `src/js/reducers` |
| `@actions` | `src/js/actions` |
| `@static` | `src/static` |
| `@api` | `src/js/api.js` |
| `@Fallback` | `src/js/Fallback` |

## Usage

Instead of relative paths:

```javascript
// Without aliases
import Header from "../../../components/Header/Header";
import homeReducer from "../../../reducers/homeReducer";
import styles from "../../../static/css/base/layout.css";
```

Use aliases:

```javascript
// With aliases
import Header from "@components/Header/Header";
import homeReducer from "@reducers/homeReducer";
import styles from "@static/css/base/layout.css";
```

## Benefits

- **Cleaner imports** - no more `../../../` chains
- **Easier refactoring** - move files without updating import paths
- **Consistent codebase** - same import style everywhere
