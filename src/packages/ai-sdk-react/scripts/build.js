#!/usr/bin/env node

/**
 * Build script for @catalyst/ai-sdk-react
 * Generates both CommonJS (.js) and ESM (.mjs) formats with source maps
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Prefer the monorepo/root Babel if available
const ROOT_BABEL_CLI = path.join(ROOT, '..', '..', 'node_modules', '@babel', 'cli', 'bin', 'babel.js');
const BABEL_CMD = fs.existsSync(ROOT_BABEL_CLI) ? `node "${ROOT_BABEL_CLI}"` : 'babel';

console.log('🚀 Building @catalyst/ai-sdk-react...\n');

// Clean dist folder
console.log('🧹 Cleaning dist folder...');
if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
}
console.log('✅ Cleaned\n');

// Build CommonJS (for Node.js require())
console.log('📦 Building CommonJS format...');
execSync(
    `${BABEL_CMD} src --out-dir ./dist --out-file-extension .js --source-maps`,
    {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, BABEL_MODULE_FORMAT: 'cjs' }
    }
);
console.log('✅ CommonJS built\n');

// Build ESM (for import statements)
console.log('📦 Building ESM format...');
execSync(
    `${BABEL_CMD} src --out-dir ./dist --out-file-extension .mjs --source-maps`,
    {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, BABEL_MODULE_FORMAT: 'esm' }
    }
);
console.log('✅ ESM built\n');

console.log('✨ Build completed successfully!\n');
console.log('📁 Output:');
console.log('  - dist/*.js (CommonJS)');
console.log('  - dist/*.mjs (ES Modules)');
console.log('  - dist/*.map (Source maps)\n');