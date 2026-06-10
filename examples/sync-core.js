#!/usr/bin/env node

/**
 * Sync local catalyst-core build into the calling example app's node_modules.
 *
 * Run from inside any example folder:
 *   npm run sync-core
 *
 * What it does:
 *   1. Clears packages/catalyst-core/dist  (stale build artifacts)
 *   2. Clears node_modules/catalyst-core   (stale installed copy)
 *   3. Builds catalyst-core fresh
 *   4. Copies the full package into node_modules/catalyst-core
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// cwd is the example app folder (npm run sets cwd to package root)
const EXAMPLE_DIR = process.cwd();
const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGE_DIR = path.join(REPO_ROOT, 'packages', 'catalyst-core');
const DIST_DIR = path.join(PACKAGE_DIR, 'dist');
const TARGET_DIR = path.join(EXAMPLE_DIR, 'node_modules', 'catalyst-core');

const log = (msg) => console.log(`\n\x1b[36m▶ ${msg}\x1b[0m`);
const ok  = (msg) => console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
const err = (msg) => console.error(`\x1b[31m✖ ${msg}\x1b[0m`);

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    execSync(`rm -rf "${dir}"`); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  } catch {
    // macOS rm -rf can fail on dirs with symlinks/extended attrs; fall back to find -delete
    execSync(`find "${dir}" -depth -delete`); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const d = path.join(dest, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

// 1. Clear dist
log('Clearing packages/catalyst-core/dist...');
rimraf(DIST_DIR);
ok('dist cleared');

// 2. Clear node_modules/catalyst-core in this example
log('Clearing node_modules/catalyst-core...');
rimraf(TARGET_DIR);
ok('node_modules/catalyst-core cleared');

// 3. Build fresh
log('Building catalyst-core...');
try {
  execSync('npm run prepare', { cwd: PACKAGE_DIR, stdio: 'inherit' });
  ok('Build complete');
} catch (e) {
  err('Build failed — aborting');
  process.exit(1);
}

// 4. Copy full package into node_modules/catalyst-core
//    Includes: dist + package.json + all root files — skips src / node_modules / .git
log('Copying into node_modules/catalyst-core...');
fs.mkdirSync(TARGET_DIR, { recursive: true });

const SKIP = new Set(['node_modules', 'src', 'dist', '.git']);
for (const entry of fs.readdirSync(PACKAGE_DIR, { withFileTypes: true })) {
  if (SKIP.has(entry.name)) continue;
  const s = path.join(PACKAGE_DIR, entry.name);
  const d = path.join(TARGET_DIR, entry.name);
  entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
}
copyDir(DIST_DIR, path.join(TARGET_DIR, 'dist'));

ok(`Synced → ${path.relative(REPO_ROOT, TARGET_DIR)}`);
console.log('\n\x1b[32mReady! Run: npm start\x1b[0m\n');
