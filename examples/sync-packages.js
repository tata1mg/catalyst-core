#!/usr/bin/env node

/**
 * Sync local @catalyst/* AI packages into this example app's node_modules.
 *
 * Run from inside any example folder:
 *   node ../sync-packages.js --packages cloud-ai
 *   node ../sync-packages.js --packages all
 *
 * What it does:
 *   1. Clears node_modules/@catalyst/<name>  (stale copy)
 *   2. Copies packages/catalyst-<name>/      into node_modules/@catalyst/<name>/
 *      Skips: node_modules, .git
 *
 * No build step — these packages ship src directly (no dist).
 * Mirrors the copy-into-node_modules pattern of sync-core.js.
 */

const path = require('path');
const fs = require('fs');

const EXAMPLE_DIR = process.cwd();
const REPO_ROOT = path.resolve(__dirname, '..');

const log = (msg) => console.log(`\n\x1b[36m▶ ${msg}\x1b[0m`);
const ok  = (msg) => console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
const err = (msg) => { console.error(`\x1b[31m✖ ${msg}\x1b[0m`); process.exit(1); };

// Map of short name → packages/ directory name
// All AI hooks (useCloudAI, useWebAI, useNativeAI) now live in cloud-ai
const PACKAGE_MAP = {
  'cloud-ai': 'catalyst-cloud-ai',
};

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const d = path.join(dest, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function syncPackage(shortName) {
  const dirName = PACKAGE_MAP[shortName];
  if (!dirName) err(`Unknown package "${shortName}". Valid: ${Object.keys(PACKAGE_MAP).join(', ')}`);

  const srcDir    = path.join(REPO_ROOT, 'packages', dirName);
  const targetDir = path.join(EXAMPLE_DIR, 'node_modules', '@catalyst', shortName);

  if (!fs.existsSync(srcDir)) err(`Source not found: ${srcDir}`);

  log(`Syncing @catalyst/${shortName}...`);

  rimraf(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const SKIP = new Set(['node_modules', '.git']);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const s = path.join(srcDir, entry.name);
    const d = path.join(targetDir, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }

  ok(`@catalyst/${shortName} → ${path.relative(REPO_ROOT, targetDir)}`);

  // For cloud-ai, remind dev to wire up the android module (useNativeAI) in settings.gradle.kts
  if (shortName === 'cloud-ai') {
    const androidDir = path.join(targetDir, 'android');
    if (fs.existsSync(androidDir)) {
      console.log(`\x1b[36m  ℹ  Android module at: ${path.relative(REPO_ROOT, androidDir)}\x1b[0m`);
      console.log(`\x1b[33m  ⚠  Add to settings.gradle.kts:\x1b[0m`);
      console.log(`       include(":catalyst-cloud-ai")`);
      console.log(`       project(":catalyst-cloud-ai").projectDir = File("node_modules/@catalyst/cloud-ai/android")`);
    }
  }
}

// Parse --packages flag
const pkgIdx = process.argv.indexOf('--packages');
if (pkgIdx === -1 || !process.argv[pkgIdx + 1]) {
  err('Usage: node sync-packages.js --packages cloud-ai|all');
}

const pkgArg = process.argv[pkgIdx + 1];
const targets = pkgArg === 'all'
  ? Object.keys(PACKAGE_MAP)
  : pkgArg.split(',').map(s => s.trim()).filter(Boolean);

for (const name of targets) syncPackage(name);

console.log('\n\x1b[32mDone! Run: npm start\x1b[0m\n');
