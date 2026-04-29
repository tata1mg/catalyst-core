---
title: Webpack Customization
slug: webpack-customization
id: webpack-customization
---

# Webpack Customization

Catalyst allows targeted webpack customization through `webpackConfig.js`. This file is for project-specific build needs, not for rebuilding the framework’s defaults from scratch.

## `splitChunksConfig`

Use `splitChunksConfig` to tune how client bundles are split:

```javascript
module.exports = {
  splitChunksConfig: {
    chunks: "all",
    minSize: 20000,
    minChunks: 1,
  },
};
```

Use this when you need to adjust bundle size, chunk reuse, or vendor splitting behavior for a specific application profile.

## `transpileModules`

Some packages ship as ESM-only modules and need transpilation before they work correctly in a Catalyst project. Use `transpileModules` for those packages:

```javascript
module.exports = {
  transpileModules: [
    "esm-only-package",
    /@scope\/another-esm-package/,
  ],
};
```

This is especially useful for third-party packages that otherwise fail during build or SSR because they are not compatible with the default CommonJS-oriented pipeline.

## Recommended Workflow

- keep `webpackConfig.js` focused on project-specific changes
- add one customization at a time and rebuild after each change
- prefer framework defaults unless you have a concrete build or bundle problem to solve
- document why a customization exists if it is likely to surprise the next maintainer

## Typical Use Cases

- tuning chunk splitting for large applications
- transpiling ESM-only dependencies
- isolating a build fix for one problematic package

## Related Docs

- [React Compiler](/content/Guides%20and%20Tutorials/react-compiler)
- [CLI Reference](/content/cli-reference)
