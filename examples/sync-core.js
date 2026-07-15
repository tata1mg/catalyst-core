#!/usr/bin/env node

/**
 * Sync local catalyst-core build into the calling example app's node_modules.
 *
 * Run from inside any example folder:
 *   npm run sync-core
 *
 * What it does:
 *   1. Clears packages/catalyst-core/dist  (stale build artifacts)
 *   2. Builds catalyst-core fresh
 *   3. Installs a packed local package with its dependency graph
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// cwd is the example app folder (npm run sets cwd to package root)
const EXAMPLE_DIR = process.cwd();
const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGE_DIR = path.join(REPO_ROOT, 'packages', 'catalyst-core');
const DIST_DIR = path.join(PACKAGE_DIR, 'dist');

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

// 1. Clear dist
log('Clearing packages/catalyst-core/dist...');
rimraf(DIST_DIR);
ok('dist cleared');

// 2. Build fresh
log('Building catalyst-core...');
try {
  execSync('npm run prepare', { cwd: PACKAGE_DIR, stdio: 'inherit' });
  ok('Build complete');
} catch (e) {
  err('Build failed — aborting');
  process.exit(1);
}

// 3. Install the local package without changing the example manifest or lockfile.
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalyst-core-sync-'));
try {
  log('Installing local catalyst-core package...');
  const tarballName = execSync(`npm pack --pack-destination "${packDir}" --ignore-scripts --silent`, {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
  }).trim().split('\n').pop();
  const tarballPath = path.join(packDir, tarballName);
  execSync(`npm install --no-save --package-lock=false "${tarballPath}"`, {
    cwd: EXAMPLE_DIR,
    stdio: 'inherit',
  });
  ok('Local package installed');
} finally {
  fs.rmSync(packDir, { recursive: true, force: true });
}
console.log('\n\x1b[32mReady! Run: npm start\x1b[0m\n');
