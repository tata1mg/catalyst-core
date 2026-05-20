---
title: React Compiler
slug: react-compiler
id: react-compiler
---

# React Compiler

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
