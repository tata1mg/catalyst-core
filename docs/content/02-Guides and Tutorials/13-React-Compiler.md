---
title: Legacy React Compiler Configuration (0.2.x)
slug: react-compiler
id: react-compiler
---

# Legacy React Compiler Configuration (Catalyst 0.2.x)

:::warning Version scope
This page documents the webpack integration available in Catalyst `0.2.x`. Catalyst `0.3.x` does
not expose the legacy `reactCompiler` option through its Vite plugin hook. Do not copy this
configuration into `buildConfig.js`.
:::

React Compiler is a build-time optimization feature that can be enabled through `webpackConfig.js`. Treat it as an explicit build choice and validate it against your application rather than enabling it blindly.

## Enable The Compiler

Set `reactCompiler` to `true` for the default compiler integration:

```javascript
module.exports = {
  reactCompiler: true,
};
```

You can also pass a configuration object:

```javascript
module.exports = {
  reactCompiler: {
    target: "18",
  }
};
```

## Limit The Scope

Use the `sources` option if you want to enable the compiler only for a subset of files:

```javascript
module.exports = {
  reactCompiler: {
    sources: (filename) => {
      return filename.indexOf("src/path/to/dir") !== -1;
    },
  },
};
```

## When To Use It

React Compiler is most useful when:

- the team wants build-time React optimizations
- the codebase is ready for compiler constraints
- you can test the affected routes and components thoroughly

## Recommended Adoption Path

- enable it on a small surface area first
- verify rendering behavior and performance before widening coverage
- keep the configuration in `webpackConfig.js` so the build choice stays visible

## Reference

For React Compiler concepts and constraints, see the official React documentation:
[React Compiler](https://react.dev/learn/react-compiler)
