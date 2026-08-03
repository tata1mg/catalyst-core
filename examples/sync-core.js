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

const { execSync, execFileSync } = require('child_process');
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
  // Delegates to safe-rimraf.js, which retries on ENOTEMPTY/EBUSY/EPERM — an IDE's
  // file watcher (e.g. auto-importing the Android project under dist/native) can
  // recreate files mid-delete, which plain `rm -rf` and `find -delete` both lose to.
  execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'safe-rimraf.js'), dir], { stdio: 'inherit' });
}

const SYNC_MAX_ATTEMPTS = 5;
const SYNC_BASE_DELAY_MS = 300;

function sleep(ms) {
  const buf = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buf), 0, 0, ms);
}

// npm's own internal directory renames during `npm install` (e.g. staging a package
// into a temp dir before an atomic rename into node_modules) hit the same ENOTEMPTY/
// EBUSY races that safe-rimraf.js works around for plain rm -rf — but npm has no
// built-in retry for it. Retry the whole command a few times with backoff.
function runWithRetry(cmd, options, beforeRetry) {
  for (let attempt = 1; attempt <= SYNC_MAX_ATTEMPTS; attempt++) {
    try {
      // Capture output so a transient error can be detected even though we still
      // want it printed — inherited stdio gives us no way to inspect it after the fact.
      const output = execSync(cmd, { ...options, stdio: 'pipe', encoding: 'utf8' });
      if (options.stdio === 'inherit') process.stdout.write(output);
      return;
    } catch (e) {
      const combined = `${e.stdout || ''}${e.stderr || ''}${e.message || ''}`;
      const transient = /ENOTEMPTY|EBUSY|EPERM/.test(combined);
      if (options.stdio === 'inherit') {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
      }
      if (!transient || attempt === SYNC_MAX_ATTEMPTS) throw e;
      console.log(`\x1b[33m  retrying after transient fs error (attempt ${attempt}/${SYNC_MAX_ATTEMPTS})...\x1b[0m`);
      if (beforeRetry) beforeRetry();
      sleep(SYNC_BASE_DELAY_MS * attempt);
    }
  }
}

// npm stages a package rename as `.<name>-<random>` inside its parent dir before an
// atomic rename into place — including inside nested node_modules (e.g. a dependency's
// own private copy of a transitive dep). If a previous `npm install` was killed/crashed
// mid-install, that staging dir is never cleaned up — and a later install can
// independently pick the exact same random suffix (npm derives it from a small counter,
// not a wide-entropy random source), so the rename target collides with the stale
// leftover and fails with ENOTEMPTY. Recursively sweep these out before installing so
// old runs can't poison new ones.
const STAGING_DIR_RE = /^\..+-[a-zA-Z0-9]{8}$/

// Only descends into node_modules trees (top-level or nested inside a package's own
// node_modules) — never into arbitrary package source directories.
function cleanNpmInstallStaging(nodeModulesDir, depth = 0) {
  if (depth > 6 || !fs.existsSync(nodeModulesDir)) return
  for (const entry of fs.readdirSync(nodeModulesDir)) {
    const entryPath = path.join(nodeModulesDir, entry)
    if (!fs.statSync(entryPath).isDirectory()) continue

    if (STAGING_DIR_RE.test(entry)) {
      fs.rmSync(entryPath, { recursive: true, force: true })
      continue
    }

    // entry is a package (or scope) dir — recurse into its own node_modules, if any
    const nestedNodeModules = path.join(entryPath, 'node_modules')
    if (fs.existsSync(nestedNodeModules)) {
      cleanNpmInstallStaging(nestedNodeModules, depth + 1)
    }
    if (entry.startsWith('@')) {
      cleanNpmInstallStaging(entryPath, depth + 1)
    }
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
  const nodeModulesDir = path.join(EXAMPLE_DIR, 'node_modules');
  cleanNpmInstallStaging(nodeModulesDir);
  runWithRetry(
    `npm install --no-save --package-lock=false "${tarballPath}"`,
    { cwd: EXAMPLE_DIR, stdio: 'inherit' },
    () => cleanNpmInstallStaging(nodeModulesDir)
  );
  ok('Local package installed');
} finally {
  fs.rmSync(packDir, { recursive: true, force: true });
}
console.log('\n\x1b[32mReady! Run: npm start\x1b[0m\n');
