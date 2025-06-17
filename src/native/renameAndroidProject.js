"use strict";

var _fs = _interopRequireDefault(require("fs"));
var _path = _interopRequireDefault(require("path"));
var _utils = require("./utils.js");

function _interopRequireDefault(e) {
    return e && e.__esModule ? e : { default: e };
}

// Simple progress logging without TerminalProgress dependency
class SimpleProgress {
    constructor(title) {
        this.title = title;
        this.currentStep = null;
        console.log(`\n=== ${title} ===\n`);
    }
    
    start(stepId) {
        this.currentStep = { id: stepId };
        console.log(`⏳ Starting: ${stepId}`);
    }
    
    complete(stepId) {
        console.log(`✅ Completed: ${stepId}`);
        this.currentStep = null;
    }
    
    fail(stepId, message) {
        console.log(`❌ Failed: ${stepId} - ${message}`);
    }
    
    log(message, type = 'info') {
        const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️ ' : type === 'success' ? '✅' : 'ℹ️ ';
        console.log(`  ${prefix} ${message}`);
    }
    
    printTreeContent(title, items) {
        console.log(`\n📋 ${title}:`);
        items.forEach(item => {
            if (typeof item === 'string') {
                console.log(item);
            } else {
                const indent = '  '.repeat(item.indent || 0);
                const prefix = item.prefix || '';
                console.log(`${indent}${prefix}${item.text}`);
            }
        });
        console.log('');
    }
}

const progress = new SimpleProgress("Android AAB Builder");

async function createKeystore(projectPaths, androidConfig) {
    const { newProjectPath } = projectPaths;
    const { keystoreConfig } = androidConfig;
    
    if (!keystoreConfig) {
        progress.log('Keystore configuration not found, skipping keystore creation', 'info');
        return null;
    }
    
    progress.log('Checking keystore configuration...', 'info');
    
    // Validate keystore passwords are not placeholder values
    if (keystoreConfig.storePassword === 'your_store_password' || 
        keystoreConfig.keyPassword === 'your_key_password' ||
        keystoreConfig.storePassword === 'your_password' || 
        keystoreConfig.keyPassword === 'your_password') {
        throw new Error('Please update keystore passwords in config file. Do not use placeholder values like "your_store_password" or "your_key_password".');
    }
    
    // Define keystore path
    const keystorePath = _path.default.join(newProjectPath, 'app', 'keystore.jks');
    
    // Check if keystore already exists
    if (_fs.default.existsSync(keystorePath)) {
        progress.log('Keystore already exists, verifying accessibility...', 'info');
        
        // Test keystore accessibility
        try {
            const testCommand = `keytool -list -keystore "${keystorePath}" -storepass "${keystoreConfig.storePassword}" -alias "${keystoreConfig.keyAlias}"`;
            (0, _utils.runCommand)(testCommand);
            progress.log('Existing keystore verified successfully', 'success');
            return keystorePath;
        } catch (testError) {
            progress.log('Existing keystore verification failed, creating new one...', 'warning');
            // Remove the faulty keystore
            _fs.default.unlinkSync(keystorePath);
        }
    }
    
    progress.log('Creating new keystore...', 'info');
    
    try {
        // Validate required keystore configuration
        const requiredFields = ['keyAlias', 'storePassword', 'keyPassword', 'organizationInfo'];
        for (const field of requiredFields) {
            if (!keystoreConfig[field]) {
                throw new Error(`Missing required keystore config field: ${field}`);
            }
        }
        
        const { organizationInfo } = keystoreConfig;
        const requiredOrgFields = ['companyName', 'city', 'state', 'countryCode'];
        for (const field of requiredOrgFields) {
            if (!organizationInfo[field]) {
                throw new Error(`Missing required organization info field: ${field}`);
            }
        }
        
        // Create keystore directory if it doesn't exist
        const keystoreDir = _path.default.dirname(keystorePath);
        if (!_fs.default.existsSync(keystoreDir)) {
            _fs.default.mkdirSync(keystoreDir, { recursive: true });
        }
        
        // Build the distinguished name (DN) for the certificate
        const dn = [
            `CN=${organizationInfo.companyName}`,
            `OU=${organizationInfo.department || organizationInfo.companyName}`,
            `O=${organizationInfo.organization || organizationInfo.companyName}`,
            `L=${organizationInfo.city}`,
            `ST=${organizationInfo.state}`,
            `C=${organizationInfo.countryCode}`
        ].join(', ');
        
        // For PKCS12 keystores (default), store and key passwords must be the same
        // Use store password for both to avoid PKCS12 compatibility issues
        const effectiveKeyPassword = keystoreConfig.storePassword;
        
        if (keystoreConfig.keyPassword !== keystoreConfig.storePassword) {
            progress.log('Note: Using store password for key password (PKCS12 requirement)', 'info');
        }
        
        // Generate keystore using keytool with PKCS12 format explicitly
        const validityDays = (keystoreConfig.validityYears || 25) * 365;
        const keystoreCommand = [
            'keytool',
            '-genkeypair',
            '-v',
            `-storetype PKCS12`,
            `-keystore "${keystorePath}"`,
            `-alias "${keystoreConfig.keyAlias}"`,
            `-keyalg RSA`,
            `-keysize 2048`,
            `-validity ${validityDays}`,
            `-storepass "${keystoreConfig.storePassword}"`,
            `-keypass "${effectiveKeyPassword}"`,
            `-dname "${dn}"`
        ].join(' ');
        
        progress.log('Executing keytool command...', 'info');
        (0, _utils.runCommand)(keystoreCommand);
        
        // Verify keystore was created
        if (!_fs.default.existsSync(keystorePath)) {
            throw new Error('Keystore file was not created successfully');
        }
        
        // Test the newly created keystore
        try {
            const testCommand = `keytool -list -keystore "${keystorePath}" -storepass "${keystoreConfig.storePassword}" -alias "${keystoreConfig.keyAlias}"`;
            (0, _utils.runCommand)(testCommand);
            progress.log('New keystore verified successfully', 'success');
        } catch (testError) {
            throw new Error(`Created keystore failed verification: ${testError.message}`);
        }
        
        progress.log(`Keystore created successfully at: ${keystorePath}`, 'success');
        progress.log(`Key alias: ${keystoreConfig.keyAlias}`, 'info');
        progress.log(`Validity: ${keystoreConfig.validityYears || 25} years`, 'info');
        progress.log(`Store type: PKCS12`, 'info');
        
        return keystorePath;
        
    } catch (error) {
        throw new Error(`Failed to create keystore: ${error.message}`);
    }
}

async function createSignedAAB(projectPaths, androidConfig, keystorePath) {
    const { newProjectPath } = projectPaths;
    const { keystoreConfig } = androidConfig;
    
    if (!keystoreConfig || !keystorePath) {
        throw new Error('Keystore configuration and keystore path are required for signed AAB creation');
    }
    
    progress.log('Building signed Android App Bundle (AAB)...', 'info');
    
    try {
        // Verify keystore exists
        if (!_fs.default.existsSync(keystorePath)) {
            throw new Error(`Keystore not found at: ${keystorePath}`);
        }
        
        // Get absolute path for the project directory
        const absoluteProjectPath = _path.default.resolve(newProjectPath);
        
        // Change to project directory
        const originalCwd = process.cwd();
        process.chdir(absoluteProjectPath);
        
        progress.log(`Changed to project directory: ${absoluteProjectPath}`, 'info');
        
        // Verify gradlew exists using absolute path
        const gradlewPath = _path.default.join(absoluteProjectPath, 'gradlew');
        progress.log(`Looking for gradlew at: ${gradlewPath}`, 'info');
        
        if (!_fs.default.existsSync(gradlewPath)) {
            // List files in the project directory for debugging
            try {
                const files = _fs.default.readdirSync(absoluteProjectPath);
                progress.log(`Files in project directory: ${files.join(', ')}`, 'info');
                
                // Check if there's a gradlew file with different permissions or name
                const gradlewFiles = files.filter(file => file.toLowerCase().includes('gradle'));
                if (gradlewFiles.length > 0) {
                    progress.log(`Found gradle-related files: ${gradlewFiles.join(', ')}`, 'info');
                }
            } catch (listError) {
                progress.log(`Could not list directory contents: ${listError.message}`, 'warning');
            }
            
            throw new Error(`gradlew not found at: ${gradlewPath}. Ensure this is a valid Android project.`);
        }
        
        // Make gradlew executable
        try {
            (0, _utils.runCommand)(`chmod +x ./gradlew`);
        } catch (chmodError) {
            progress.log(`Warning: Could not make gradlew executable: ${chmodError.message}`, 'warning');
        }
        
        try {
            // Clean previous builds
            progress.log('Cleaning previous builds...', 'info');
            try {
                (0, _utils.runCommand)('./gradlew clean');
                progress.log('Clean completed successfully', 'success');
            } catch (cleanError) {
                progress.log(`Warning: Clean failed: ${cleanError.message}`, 'warning');
                // Continue anyway as this might not be critical
            }
            
            // Build signed AAB with PKCS12-compatible parameters
            progress.log('Building signed AAB...', 'info');
            
            // For PKCS12 keystores, use store password for both store and key
            const effectiveKeyPassword = keystoreConfig.storePassword;
            
            const bundleCommand = [
                './gradlew bundleRelease',
                `-Pandroid.injected.signing.store.file="${keystorePath}"`,
                `-Pandroid.injected.signing.store.password="${keystoreConfig.storePassword}"`,
                `-Pandroid.injected.signing.key.alias="${keystoreConfig.keyAlias}"`,
                `-Pandroid.injected.signing.key.password="${effectiveKeyPassword}"`
            ].join(' ');
            
            progress.log(`Executing: ${bundleCommand}`, 'info');
            (0, _utils.runCommand)(bundleCommand);
            progress.log('Bundle build completed', 'success');
            
            // Find the generated AAB file
            const aabPath = _path.default.join(newProjectPath, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
            
            progress.log(`Looking for AAB file at: ${aabPath}`, 'info');
            
            if (!_fs.default.existsSync(aabPath)) {
                // Try to find AAB files in the build output directory
                const bundleDir = _path.default.join(newProjectPath, 'app', 'build', 'outputs', 'bundle');
                progress.log(`AAB not found at expected location. Checking bundle directory: ${bundleDir}`, 'warning');
                
                if (_fs.default.existsSync(bundleDir)) {
                    try {
                        const findAabCommand = `find "${bundleDir}" -name "*.aab" -type f`;
                        const foundAabs = (0, _utils.runCommand)(findAabCommand);
                        if (foundAabs.trim()) {
                            progress.log(`Found AAB files: ${foundAabs.trim()}`, 'info');
                        } else {
                            progress.log('No AAB files found in bundle directory', 'warning');
                        }
                    } catch (findError) {
                        progress.log(`Error searching for AAB files: ${findError.message}`, 'warning');
                    }
                }
                
                throw new Error('Signed AAB file was not generated successfully');
            }
            
            // Get file size
            const stats = _fs.default.statSync(aabPath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            
            progress.log(`Signed AAB created successfully!`, 'success');
            progress.log(`AAB location: ${aabPath}`, 'info');
            progress.log(`AAB size: ${fileSizeMB} MB`, 'info');
            
            // Optionally copy AAB to a more accessible location
            const outputDir = _path.default.join(newProjectPath, 'release');
            if (!_fs.default.existsSync(outputDir)) {
                _fs.default.mkdirSync(outputDir, { recursive: true });
            }
            
            const outputAabPath = _path.default.join(outputDir, `${androidConfig.newProjectName}-release.aab`);
            _fs.default.copyFileSync(aabPath, outputAabPath);
            
            progress.log(`AAB copied to: ${outputAabPath}`, 'success');
            
            return {
                aabPath,
                outputAabPath,
                fileSize: fileSizeMB
            };
            
        } finally {
            // Restore original working directory
            process.chdir(originalCwd);
        }
        
    } catch (error) {
        throw new Error(`Failed to create signed AAB: ${error.message}`);
    }
}

async function initializeConfig(configPath) {
    if (!configPath) {
        throw new Error('Config path is required');
    }

    if (!_fs.default.existsSync(configPath)) {
        throw new Error(`Config file not found at: ${configPath}`);
    }

    progress.log(`Reading config from: ${configPath}`, 'info');
    
    const configFile = _fs.default.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    
    if (!config.android) {
        throw new Error('Android configuration missing in config file');
    }

    const { android } = config;
    
    // Validate required fields (only newProjectName is truly required)
    if (!android.newProjectName) {
        throw new Error('newProjectName is required in android config');
    }

    progress.log(`Project path: ${android.projectPath}`, 'info');
    progress.log(`Old project name: ${android.oldProjectName}`, 'info');
    progress.log(`New project name: ${android.newProjectName}`, 'info');
    
    if (android.outputPath) {
        progress.log(`Custom output path: ${android.outputPath}`, 'info');
    } else {
        const parentDir = _path.default.dirname(android.projectPath);
        const defaultOutputPath = _path.default.join(parentDir, 'build-output');
        progress.log(`Default output path: ${defaultOutputPath}`, 'info');
    }
    
    if (android.createSignedAAB) {
        progress.log(`Signed AAB creation: Enabled`, 'info');
        
        if (android.keystoreConfig) {
            // Check for placeholder passwords
            if (android.keystoreConfig.storePassword === 'your_store_password' || 
                android.keystoreConfig.keyPassword === 'your_key_password' ||
                android.keystoreConfig.storePassword === 'your_password' || 
                android.keystoreConfig.keyPassword === 'your_password') {
                progress.log(`Warning: Keystore contains placeholder passwords. Please update them.`, 'warning');
            } else {
                progress.log(`Keystore configuration: Valid`, 'success');
            }
        } else {
            progress.log(`Warning: Keystore configuration missing for AAB creation`, 'warning');
        }
    } else {
        progress.log(`Signed AAB creation: Disabled (set createSignedAAB: true to enable)`, 'info');
    }
    
    return { android, config };
}

async function diagnoseAndroidProject(projectPath) {
    progress.log('Diagnosing Android project structure...', 'info');
    
    if (!_fs.default.existsSync(projectPath)) {
        throw new Error(`Project path does not exist: ${projectPath}`);
    }
    
    // Check for common Android project patterns (supporting both .gradle and .gradle.kts)
    const patterns = [
        { 
            files: ['build.gradle', 'build.gradle.kts'], 
            description: 'Root build gradle',
            type: 'either'
        },
        { 
            files: ['settings.gradle', 'settings.gradle.kts'], 
            description: 'Settings gradle',
            type: 'either'
        },
        { 
            files: ['gradlew'], 
            description: 'Gradle wrapper script',
            type: 'single'
        },
        { 
            files: ['gradle.properties'], 
            description: 'Gradle properties',
            type: 'single'
        },
        { 
            files: ['app/build.gradle', 'app/build.gradle.kts'], 
            description: 'App module build gradle',
            type: 'either'
        },
        { 
            files: ['app/src/main/AndroidManifest.xml'], 
            description: 'Android manifest',
            type: 'single'
        },
        { 
            files: ['app/src/main/java'], 
            description: 'Java source directory',
            type: 'single'
        },
        { 
            files: ['app/src/main/res'], 
            description: 'Android resources',
            type: 'single'
        }
    ];
    
    const diagnostics = {
        foundFiles: [],
        missingFiles: [],
        projectType: 'unknown',
        usesKotlinDSL: false
    };
    
    for (const pattern of patterns) {
        let found = false;
        let foundFile = null;
        
        if (pattern.type === 'either') {
            // Check if either variant exists
            for (const file of pattern.files) {
                const fullPath = _path.default.join(projectPath, file);
                if (_fs.default.existsSync(fullPath)) {
                    found = true;
                    foundFile = file;
                    if (file.endsWith('.kts')) {
                        diagnostics.usesKotlinDSL = true;
                    }
                    break;
                }
            }
        } else {
            // Check single file
            const fullPath = _path.default.join(projectPath, pattern.files[0]);
            if (_fs.default.existsSync(fullPath)) {
                found = true;
                foundFile = pattern.files[0];
            }
        }
        
        if (found) {
            diagnostics.foundFiles.push({ ...pattern, foundFile });
            progress.log(`✅ Found: ${pattern.description}${foundFile ? ` (${foundFile})` : ''}`, 'success');
        } else {
            diagnostics.missingFiles.push(pattern);
            progress.log(`❌ Missing: ${pattern.description}`, 'warning');
        }
    }
    
    // Determine project type
    const hasRootBuildFile = diagnostics.foundFiles.some(f => 
        f.files.includes('build.gradle') || f.files.includes('build.gradle.kts')
    );
    const hasAppBuildFile = diagnostics.foundFiles.some(f => 
        f.files.includes('app/build.gradle') || f.files.includes('app/build.gradle.kts')
    );
    const hasGradlew = diagnostics.foundFiles.some(f => f.files.includes('gradlew'));
    
    if (hasRootBuildFile && hasAppBuildFile) {
        diagnostics.projectType = 'standard-android';
    } else if (hasGradlew) {
        diagnostics.projectType = 'gradle-project';
    } else {
        diagnostics.projectType = 'incomplete';
    }
    
    progress.log(`Project type detected: ${diagnostics.projectType}`, 'info');
    if (diagnostics.usesKotlinDSL) {
        progress.log(`Project uses Kotlin DSL (.kts files)`, 'info');
    }
    
    // Try to find build files in unexpected locations
    if (diagnostics.missingFiles.length > 0) {
        progress.log('Searching for missing files in alternate locations...', 'info');
        try {
            const findBuildFiles = `find "${projectPath}" \\( -name "build.gradle" -o -name "build.gradle.kts" -o -name "settings.gradle" -o -name "settings.gradle.kts" -o -name "AndroidManifest.xml" \\) -type f`;
            const foundFiles = (0, _utils.runCommand)(findBuildFiles);
            if (foundFiles.trim()) {
                progress.log('Found build files in unexpected locations:', 'info');
                foundFiles.trim().split('\n').forEach(file => {
                    progress.log(`  ${file}`, 'info');
                });
            }
        } catch (searchError) {
            progress.log('Could not search for alternative file locations', 'warning');
        }
    }
    
    return diagnostics;
}

async function validateProjectStructure(androidConfig) {
    const { projectPath, oldProjectName, newProjectName } = androidConfig;
    
    progress.log('Validating project structure...', 'info');
    
    if (!_fs.default.existsSync(projectPath)) {
        throw new Error(`Project path does not exist: ${projectPath}`);
    }
    
    // Run comprehensive diagnostics
    const diagnostics = await diagnoseAndroidProject(projectPath);
    
    if (diagnostics.projectType === 'incomplete') {
        throw new Error(`Android project appears to be incomplete. Missing critical files: ${diagnostics.missingFiles.map(f => f.description).join(', ')}`);
    }
    
    if (diagnostics.projectType !== 'standard-android') {
        progress.log(`Warning: Project type "${diagnostics.projectType}" may not be fully compatible`, 'warning');
    }
    
    // Check if the old project name exists in the path
    if (!projectPath.includes(oldProjectName)) {
        progress.log(`Warning: Project path doesn't contain old project name "${oldProjectName}"`, 'warning');
    }
    
    // Get the parent directory
    const parentDir = _path.default.dirname(projectPath);
    const currentProjectDir = _path.default.basename(projectPath);
    
    if (currentProjectDir !== oldProjectName) {
        progress.log(`Warning: Current directory name "${currentProjectDir}" differs from old project name "${oldProjectName}"`, 'warning');
    }
    
    // Create output directory path - where final AAB will be saved
    const outputPath = androidConfig.outputPath 
        ? _path.default.resolve(androidConfig.outputPath)
        : _path.default.resolve(parentDir, 'build-output');
    
    progress.log(`Original project: ${projectPath}`, 'info');
    progress.log(`Output directory: ${outputPath}`, 'info');
    
    progress.log('Project structure validation completed', 'success');
    
    return {
        parentDir,
        currentProjectDir,
        oldProjectPath: projectPath,
        outputPath,
        diagnostics
    };
}

async function createBackup(projectPaths, androidConfig) {
    if (!androidConfig.createBackup) {
        progress.log('Backup creation skipped (not requested)', 'info');
        return null;
    }
    
    progress.log('Creating project backup...', 'info');
    
    const backupPath = `${projectPaths.oldProjectPath}_backup_${Date.now()}`;
    
    try {
        (0, _utils.runCommand)(`cp -r "${projectPaths.oldProjectPath}" "${backupPath}"`);
        progress.log(`Backup created at: ${backupPath}`, 'success');
        return backupPath;
    } catch (error) {
        throw new Error(`Failed to create backup: ${error.message}`);
    }
}

async function createTempDeploymentProject(projectPaths, androidConfig) {
    const { oldProjectPath } = projectPaths;
    const { oldProjectName, newProjectName } = androidConfig;
    
    progress.log('Creating temporary deployment project...', 'info');
    
    // Create a unique temporary directory
    const tempDir = _path.default.join(_path.default.dirname(oldProjectPath), `temp_build_${Date.now()}`);
    
    try {
        // First, let's check what's actually in the source directory
        progress.log(`Inspecting source directory: ${oldProjectPath}`, 'info');
        if (!_fs.default.existsSync(oldProjectPath)) {
            throw new Error(`Source project path does not exist: ${oldProjectPath}`);
        }
        
        const sourceFiles = _fs.default.readdirSync(oldProjectPath);
        progress.log(`Source directory contents: ${sourceFiles.join(', ')}`, 'info');
        
        // Copy the entire project to the temporary location using rsync for better file preservation
        progress.log(`Copying project to temporary location...`, 'info');
        progress.log(`Source: ${oldProjectPath}`, 'info');
        progress.log(`Temp destination: ${tempDir}`, 'info');
        
        // Use rsync to preserve all file attributes and handle symlinks properly
        (0, _utils.runCommand)(`rsync -av "${oldProjectPath}/" "${tempDir}/"`);
        progress.log(`Created temporary copy for building`, 'success');
        
        // Only check for gradlew which is absolutely essential for building
        const gradlewPath = _path.default.join(tempDir, 'gradlew');
        if (!_fs.default.existsSync(gradlewPath)) {
            throw new Error('Critical file missing: gradlew not found. This is required for building the project.');
        }
        
        // Log what we have (for debugging purposes only, not validation)
        progress.log(`Checking copied files (informational only):`, 'info');
        const filesToCheck = [
            { path: 'gradlew', desc: 'Gradle wrapper' },
            { path: 'build.gradle', desc: 'Root build.gradle' },
            { path: 'build.gradle.kts', desc: 'Root build.gradle.kts' },
            { path: 'app/build.gradle', desc: 'App build.gradle' },
            { path: 'app/build.gradle.kts', desc: 'App build.gradle.kts' },
            { path: 'settings.gradle', desc: 'Settings gradle' },
            { path: 'settings.gradle.kts', desc: 'Settings gradle.kts' },
            { path: 'app/src/main/AndroidManifest.xml', desc: 'Android manifest' }
        ];
        
        filesToCheck.forEach(file => {
            const fullPath = _path.default.join(tempDir, file.path);
            const exists = _fs.default.existsSync(fullPath);
            progress.log(`  ${file.desc}: ${exists ? '✅ Found' : '⚠️  Not found'}`, exists ? 'info' : 'warning');
        });
        
        // List all files in temp directory for debugging
        if (_fs.default.existsSync(tempDir)) {
            const tempFiles = _fs.default.readdirSync(tempDir);
            progress.log(`Temp directory contents: ${tempFiles.join(', ')}`, 'info');
        }
        
    } catch (error) {
        // Clean up on error
        if (_fs.default.existsSync(tempDir)) {
            try {
                (0, _utils.runCommand)(`rm -rf "${tempDir}"`);
            } catch (cleanupError) {
                progress.log(`Warning: Could not cleanup temp directory: ${cleanupError.message}`, 'warning');
            }
        }
        throw new Error(`Failed to create temporary deployment copy: ${error.message}`);
    }
    
    // Find and rename any subdirectories that contain the old project name within the temp copy
    try {
        const findCommand = `find "${tempDir}" -type d -name "*${oldProjectName}*"`;
        const result = (0, _utils.runCommand)(findCommand);
        
        if (result.trim()) {
            const dirsToRename = result.trim().split('\n').filter(dir => dir.trim());
            
            for (const dir of dirsToRename) {
                const newDirName = dir.replace(new RegExp(oldProjectName, 'g'), newProjectName);
                if (dir !== newDirName) {
                    (0, _utils.runCommand)(`mv "${dir}" "${newDirName}"`);
                    progress.log(`Renamed subdirectory: ${_path.default.basename(dir)} → ${_path.default.basename(newDirName)}`, 'success');
                }
            }
        }
    } catch (error) {
        progress.log(`Warning: Error finding subdirectories to rename: ${error.message}`, 'warning');
    }
    
    progress.log('Temporary deployment project created successfully', 'success');
    return tempDir;
}

async function finalizeAABAndCleanup(projectPaths, androidConfig, aabResult, tempDeploymentPath) {
    const { oldProjectPath } = projectPaths;
    
    progress.log('Finalizing AAB and cleaning up temporary files...', 'info');
    
    try {
        // Create final output directory next to original project
        const outputDir = androidConfig.outputPath || _path.default.join(_path.default.dirname(oldProjectPath), 'build-output');
        if (!_fs.default.existsSync(outputDir)) {
            _fs.default.mkdirSync(outputDir, { recursive: true });
            progress.log(`Created output directory: ${outputDir}`, 'success');
        }
        
        // Copy AAB to final location with descriptive name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const finalAabName = `${androidConfig.newProjectName}-release-${timestamp}.aab`;
        const finalAabPath = _path.default.join(outputDir, finalAabName);
        
        _fs.default.copyFileSync(aabResult.outputAabPath, finalAabPath);
        progress.log(`AAB saved to final location: ${finalAabPath}`, 'success');
        
        // Copy keystore to output directory for future use
        const keystorePath = _path.default.join(tempDeploymentPath, 'app', 'keystore.jks');
        if (_fs.default.existsSync(keystorePath)) {
            const finalKeystorePath = _path.default.join(outputDir, `${androidConfig.newProjectName}-keystore.jks`);
            _fs.default.copyFileSync(keystorePath, finalKeystorePath);
            progress.log(`Keystore copied to: ${finalKeystorePath}`, 'success');
        }
        
        // Clean up temporary deployment directory
        await cleanupTempDeployment(tempDeploymentPath);
        
        return {
            ...aabResult,
            finalAabPath,
            finalAabName,
            outputDir
        };
        
    } catch (error) {
        throw new Error(`Failed to finalize AAB: ${error.message}`);
    }
}

async function cleanupTempDeployment(tempDeploymentPath) {
    if (!tempDeploymentPath || !_fs.default.existsSync(tempDeploymentPath)) {
        return;
    }
    
    try {
        progress.log('Cleaning up temporary deployment files...', 'info');
        (0, _utils.runCommand)(`rm -rf "${tempDeploymentPath}"`);
        progress.log('Temporary files cleaned up successfully', 'success');
    } catch (error) {
        progress.log(`Warning: Could not cleanup temporary directory: ${error.message}`, 'warning');
    }
}

async function updateFileContents(projectPaths, androidConfig) {
    const { newProjectPath } = projectPaths;
    const { oldProjectName, newProjectName } = androidConfig;
    
    progress.log('Updating file contents and names...', 'info');
    
    try {
        // Find and rename files that contain the old project name
        const findFilesCommand = `find "${newProjectPath}" -type f -name "*${oldProjectName}*"`;
        const fileResult = (0, _utils.runCommand)(findFilesCommand);
        
        if (fileResult.trim()) {
            const filesToRename = fileResult.trim().split('\n').filter(file => file.trim());
            
            for (const file of filesToRename) {
                const newFileName = file.replace(new RegExp(oldProjectName, 'g'), newProjectName);
                if (file !== newFileName) {
                    (0, _utils.runCommand)(`mv "${file}" "${newFileName}"`);
                    progress.log(`Renamed file: ${_path.default.basename(file)} → ${_path.default.basename(newFileName)}`, 'success');
                }
            }
        }
        
        // Update file contents that reference the old project name
        // Include .kts files for Kotlin DSL support
        const fileTypes = [
            '*.gradle',
            '*.gradle.kts',  // Added Kotlin DSL gradle files
            '*.xml',
            '*.json',
            '*.properties',
            '*.java',
            '*.kt',
            '*.kts',         // Added general Kotlin script files
            '*.js',
            '*.ts',
            '*.md'
        ];
        
        for (const fileType of fileTypes) {
            try {
                const findContentCommand = `find "${newProjectPath}" -name "${fileType}" -type f`;
                const files = (0, _utils.runCommand)(findContentCommand);
                
                if (files.trim()) {
                    const fileList = files.trim().split('\n').filter(file => file.trim());
                    
                    for (const file of fileList) {
                        try {
                            const content = _fs.default.readFileSync(file, 'utf8');
                            if (content.includes(oldProjectName)) {
                                const updatedContent = content.replace(new RegExp(oldProjectName, 'g'), newProjectName);
                                _fs.default.writeFileSync(file, updatedContent, 'utf8');
                                progress.log(`Updated content in: ${_path.default.relative(newProjectPath, file)}`, 'info');
                            }
                        } catch (fileError) {
                            progress.log(`Warning: Could not update file ${file}: ${fileError.message}`, 'warning');
                        }
                    }
                }
            } catch (typeError) {
                // Continue with other file types if one fails
                progress.log(`Warning: Error processing ${fileType} files: ${typeError.message}`, 'warning');
            }
        }
        
        progress.log('File content updates completed', 'success');
        
    } catch (error) {
        throw new Error(`Error updating file contents: ${error.message}`);
    }
}

async function buildAndroidAAB(configPathOrConfig) {
    let androidConfig;
    let projectPaths;
    let backupPath;
    let tempDeploymentPath;
    
    try {
        // Initialize configuration - handle both config path and direct config object
        progress.start('config');
        if (typeof configPathOrConfig === 'string') {
            const { android } = await initializeConfig(configPathOrConfig);
            androidConfig = android;
        } else {
            // Direct config object passed (from buildAppAndroid.js)
            // All defaults should already be applied in buildAppAndroid.js
            androidConfig = configPathOrConfig;
            
            // Validate required fields
            if (!androidConfig.newProjectName) {
                throw new Error('newProjectName is required in android config');
            }
            if (!androidConfig.projectPath) {
                throw new Error('projectPath is required in android config');
            }
            if (!androidConfig.oldProjectName) {
                throw new Error('oldProjectName is required in android config');
            }
            
            progress.log(`Using configuration from buildAppAndroid.js`, 'info');
            progress.log(`Project path: ${androidConfig.projectPath}`, 'info');
            progress.log(`Old project name: ${androidConfig.oldProjectName}`, 'info');
            progress.log(`New project name: ${androidConfig.newProjectName}`, 'info');
            progress.log(`Deployment path: ${androidConfig.deploymentPath || 'Not specified'}`, 'info');
            progress.log(`Overwrite existing: ${androidConfig.overwriteExisting}`, 'info');
        }
        progress.complete('config');

        // Validate project structure
        progress.start('validation');
        projectPaths = await validateProjectStructure(androidConfig);
        progress.complete('validation');

        // Create backup if requested
        progress.start('backup');
        backupPath = await createBackup(projectPaths, androidConfig);
        progress.complete('backup');
        
        // Create temporary deployment project copy
        progress.start('createTempDeployment');
        tempDeploymentPath = await createTempDeploymentProject(projectPaths, androidConfig);
        progress.complete('createTempDeployment');
        
        // Update file contents in temp deployment
        progress.start('updateFileContents');
        await updateFileContents({ ...projectPaths, newProjectPath: tempDeploymentPath }, androidConfig);
        progress.complete('updateFileContents');
        
        // Create keystore if needed
        progress.start('createKeystore');
        const keystorePath = await createKeystore({ ...projectPaths, newProjectPath: tempDeploymentPath }, androidConfig);
        progress.complete('createKeystore');
        
        // Create signed AAB if keystore was created/found and enabled in config
        let aabResult = null;
        if (keystorePath && androidConfig.createSignedAAB) {
            progress.start('createSignedAAB');
            aabResult = await createSignedAAB({ ...projectPaths, newProjectPath: tempDeploymentPath }, androidConfig, keystorePath);
            progress.complete('createSignedAAB');
            
            // Copy AAB to final location and cleanup temp deployment
            if (aabResult) {
                progress.start('finalizeAAB');
                aabResult = await finalizeAABAndCleanup(projectPaths, androidConfig, aabResult, tempDeploymentPath);
                progress.complete('finalizeAAB');
            }
        } else if (!androidConfig.createSignedAAB) {
            progress.log('Signed AAB creation skipped (not enabled in config)', 'info');
            // Clean up temp deployment since we're not building AAB
            await cleanupTempDeployment(tempDeploymentPath);
        } else if (!keystorePath) {
            progress.log('Signed AAB creation skipped (no keystore available)', 'warning');
            // Clean up temp deployment since we're not building AAB
            await cleanupTempDeployment(tempDeploymentPath);
        }

        // Print completion summary
        progress.printTreeContent('Build Summary', [
            'Android AAB build completed successfully:',
            { text: `Original project: ${projectPaths.oldProjectPath}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Project name: ${androidConfig.oldProjectName} → ${androidConfig.newProjectName}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Deployment path: ${androidConfig.deploymentPath || 'Not specified'}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Overwrite existing: ${androidConfig.overwriteExisting}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Backup created: ${backupPath ? 'Yes' : 'No'}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Keystore: ${keystorePath ? 'Created/Verified' : 'Skipped'}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Signed AAB: ${aabResult ? 'Created' : 'Skipped'}`, indent: 1, prefix: '└─ ', color: 'gray' },
            '',
            'Output Files:',
            { text: `Original preserved at: ${projectPaths.oldProjectPath}`, indent: 1, prefix: '├─ ', color: 'green' },
            ...(backupPath ? [{ text: `Backup: ${backupPath}`, indent: 1, prefix: '├─ ', color: 'gray' }] : []),
            ...(aabResult ? [
                { text: `AAB file: ${aabResult.finalAabPath}`, indent: 1, prefix: '├─ ', color: 'green' },
                { text: `AAB size: ${aabResult.fileSize} MB`, indent: 1, prefix: '└─ ', color: 'green' }
            ] : [{ text: `No AAB created`, indent: 1, prefix: '└─ ', color: 'gray' }])
        ]);

        process.exit(0);
        
    } catch (error) {
        // Clean up temp deployment on error
        if (tempDeploymentPath) {
            await cleanupTempDeployment(tempDeploymentPath);
        }
        
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, error.message);
            
            progress.printTreeContent('Troubleshooting Guide', [
                'Build operation failed. Please check the following:',
                { text: 'Verify config file exists and contains required android configuration', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Ensure project path exists and is accessible', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Check file/directory permissions', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Verify no processes are using the project directory', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Ensure sufficient disk space for project copy', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Update keystore passwords (do not use "your_store_password")', indent: 1, prefix: '└─ ', color: 'yellow' },
                '\nConfiguration Details:',
                { text: `Config: ${typeof configPathOrConfig === 'string' ? configPathOrConfig : 'Direct object from buildAppAndroid.js'}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `Project path: ${androidConfig?.projectPath || 'Not loaded'}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `Deployment path: ${androidConfig?.deploymentPath || 'Not loaded'}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `Old project name: ${androidConfig?.oldProjectName || 'Not loaded'}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `New project name: ${androidConfig?.newProjectName || 'Not loaded'}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `Overwrite existing: ${androidConfig?.overwriteExisting !== undefined ? androidConfig.overwriteExisting : 'Not loaded'}`, indent: 1, prefix: '└─ ', color: 'gray' },
                '\nFor keystore issues, ensure your config has:',
                { text: 'Real passwords (not placeholder values)', indent: 1, prefix: '├─ ', color: 'cyan' },
                { text: 'Valid organization information', indent: 1, prefix: '├─ ', color: 'cyan' },
                { text: 'Consistent store and key passwords for PKCS12', indent: 1, prefix: '└─ ', color: 'cyan' }
            ]);
        }
        
        process.exit(1);
    }
}

// Export functions for use as a module - using the same export pattern as buildAppAndroid.js
// This allows the functions to be imported with ES6 import syntax from other modules
exports.buildAndroidAAB = buildAndroidAAB;
exports.createAndroidDeployment = buildAndroidAAB;
exports.renameAndroidProject = buildAndroidAAB;

// Execute if run directly
if (require.main === module) {
    const configPath = process.argv[2];
    if (!configPath) {
        console.error('Usage: node renameAndroidProject.js <config-path>');
        process.exit(1);
    }
    buildAndroidAAB(configPath).catch(error => {
        console.error('Script failed:', error.message);
        process.exit(1);
    });
}