# BUNDLE-001

**Category:** BUNDLE

## Message

Build failed: an import names something its module does not export

## Details

Usually happens with a Vite-based (Rollup) dependency whose published build no longer exports that name, for example after a version change or rename.

## Suggested action

Check the module's exports and update the import name, or install a dependency version that exports it.
