# Catalyst Core Publishing Workflow Guide

This guide explains how to use the GitHub Actions workflow to publish both `catalyst-core` and `catalyst-core-internal` packages.

## 🚀 How to Use

### 1. Trigger the Workflow

1. Go to your GitHub repository
2. Click on **Actions** tab
3. Select **Publish Package** workflow
4. Click **Run workflow**

### 2. Configure Publishing Options

You'll see the following options:

#### **Branch** (Required)
- Specify which branch to publish from (e.g., `main`, `develop`, `feature/xyz`)
- Default: `main`
- The workflow will checkout this branch before building

#### **Package Type** (Required)
- **`main`**: Publishes as `catalyst-core` (public package)
- **`internal`**: Publishes as `catalyst-core-internal` (internal package)

#### **Version Type** (Required)  
- **`beta`**: For beta releases (e.g., `0.0.1-beta.66`)
- **`canary`**: For canary releases (e.g., `0.0.3-canary.20`)

#### **Custom Version** (Optional)
- Leave empty for auto-increment
- Or specify custom version like: `0.0.4-beta.1`
- Format: `x.y.z-beta.n` or `x.y.z-canary.n`

#### **Dry Run** (Optional)
- **`false`**: Actually publish the package
- **`true`**: Preview what would happen (no changes made)

## 📊 Current Versions Display

The workflow automatically shows current versions before execution:

```
📦 CURRENT PACKAGE VERSIONS ON NPM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔷 catalyst-core (main package):
   📍 Latest Beta:   0.0.1-beta.14
   📍 Latest Canary: 0.0.3-canary.6

🔶 catalyst-core-internal:
   📍 Latest Beta:   0.0.1-beta.65
   📍 Latest Canary: 0.0.3-canary.19

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ Selected Configuration:
   🌿 Branch: main
   📦 Package Type: internal
   📊 Version Type: beta
   🤖 Auto-increment: Enabled
   🧪 Dry Run: false
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 🔄 What the Workflow Does

### For Internal Package (`catalyst-core-internal`)
1. **Checks out branch**: Switches to specified branch (e.g., `develop`, `feature/xyz`)
2. **Updates package.json**: Changes name to `catalyst-core-internal`
3. **Route Changes**: Replaces ALL occurrences of `catalyst-core` with `catalyst-core-internal` in:
   - Source files (`.js`, `.jsx`, `.ts`, `.tsx`)
   - Import statements
   - Require statements  
   - Template files
   - JSON configuration files
4. **Builds**: Runs `npm run prepare`
5. **Publishes**: Publishes to npm as `catalyst-core-internal`
6. **Tags**: Creates git tag like `catalyst-core-internal-0.0.1-beta.66` with branch info
7. **Restores**: Reverts ALL changes back to original state

### For Main Package (`catalyst-core`)
1. **Checks out branch**: Switches to specified branch (e.g., `main`, `release/v1.0`)
2. **Updates package.json**: Ensures name is `catalyst-core`
3. **Route Changes**: Replaces ALL occurrences of `catalyst-core-internal` with `catalyst-core`
4. **Builds**: Runs `npm run prepare`
5. **Publishes**: Publishes to npm as `catalyst-core`
6. **Tags**: Creates git tag like `catalyst-core-0.0.3-canary.7` with branch info
7. **Restores**: Reverts ALL changes back to original state

## ✨ Key Features

- **🌿 Branch Selection**: Publish from any branch (main, develop, feature branches, etc.)
- **🔍 Version Validation**: Checks if version already exists on npm
- **💾 Automatic Backup**: Creates backups before making changes
- **🔄 Complete Restoration**: Repository is restored to original state after publishing
- **🏷️ Enhanced Git Tagging**: Creates tags with branch and commit information
- **🧪 Dry Run Mode**: Preview changes without publishing
- **📊 Progress Tracking**: Clear status updates throughout the process

## 🔒 Security & NPM Token

The workflow requires an `NPM_TOKEN` secret to be configured in your repository:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Add a new secret named `NPM_TOKEN`
3. Use your npm authentication token with publish permissions

## 📝 Example Usage Scenarios

### Scenario 1: Auto-increment Internal Beta from Develop
- Branch: `develop`
- Package Type: `internal`
- Version Type: `beta`
- Custom Version: *(leave empty)*
- Dry Run: `false`

**Result**: Publishes `catalyst-core-internal@0.0.1-beta.66` from develop branch

### Scenario 2: Custom Main Canary Version from Main
- Branch: `main`
- Package Type: `main`
- Version Type: `canary`
- Custom Version: `0.0.4-canary.0`
- Dry Run: `false`

**Result**: Publishes `catalyst-core@0.0.4-canary.0` from main branch

### Scenario 3: Preview Internal Changes from Feature Branch
- Branch: `feature/new-feature`
- Package Type: `internal`
- Version Type: `beta`
- Custom Version: *(leave empty)*
- Dry Run: `true`

**Result**: Shows what would be published from feature branch without making any changes

### Scenario 4: Release from Specific Branch
- Branch: `release/v1.0`
- Package Type: `main`
- Version Type: `beta`
- Custom Version: `1.0.0-beta.1`
- Dry Run: `false`

**Result**: Publishes `catalyst-core@1.0.0-beta.1` from release branch

## 🚨 Important Notes

- **Branch Flexibility**: Can publish from any branch without affecting the source branch
- **No Code Commits**: The workflow never commits changes to your repository
- **Route Changes**: All `catalyst-core` references are automatically updated for internal builds
- **File Restoration**: All files are restored to original state after publishing
- **Version Validation**: Prevents publishing duplicate versions
- **Enhanced Tagging**: Git tags include branch name, commit hash, and timestamp
- **Complete Automation**: Handles package name, imports, dependencies, and template files

## 🛠️ Troubleshooting

### Common Issues:
1. **Version Already Exists**: Use a different version or check current published versions
2. **NPM Token Invalid**: Update the `NPM_TOKEN` secret in repository settings
3. **Build Failures**: Check if all dependencies are properly installed

### Getting Help:
- Check the workflow logs for detailed error messages
- Ensure your npm token has publish permissions
- Verify the package name doesn't conflict with existing packages
- Ensure the specified branch exists in your repository

## 🌿 Branch Strategy

### Recommended Branch Usage:

- **`main`**: Stable releases for production
- **`develop`**: Development releases for testing
- **`feature/*`**: Feature-specific releases for testing
- **`release/*`**: Release candidate builds
- **`hotfix/*`**: Emergency fixes

### Git Tag Information:

Each published package creates a git tag with detailed information:
```
Tag: catalyst-core-internal-0.0.1-beta.66
Message: Release catalyst-core-internal@0.0.1-beta.66

Branch: develop
Commit: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
Published: 2024-06-19 12:34:56 UTC
```

