import fs from 'fs';
import path from 'path';
import { runCommand } from './utils.js';

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

const progress = new SimpleProgress("Android Project Deployment");

async function createKeystore(projectPaths, androidConfig) {
    const { newProjectPath } = projectPaths;
    const { keystoreConfig } = androidConfig;
    
    if (!keystoreConfig) {
        progress.log('Keystore configuration not found, skipping keystore creation', 'info');
        return null;
    }
    
    progress.log('Checking keystore configuration...', 'info');
    
    // Define keystore path
    const keystorePath = path.join(newProjectPath, 'app', 'keystore.jks');
    
    // Check if keystore already exists
    if (fs.existsSync(keystorePath)) {
        progress.log('Keystore already exists, skipping creation', 'success');
        return keystorePath;
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
        const keystoreDir = path.dirname(keystorePath);
        if (!fs.existsSync(keystoreDir)) {
            fs.mkdirSync(keystoreDir, { recursive: true });
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
        
        // Generate keystore using keytool
        const validityDays = (keystoreConfig.validityYears || 25) * 365;
        const keystoreCommand = [
            'keytool',
            '-genkeypair',
            '-v',
            `-keystore "${keystorePath}"`,
            `-alias "${keystoreConfig.keyAlias}"`,
            `-keyalg RSA`,
            `-keysize 2048`,
            `-validity ${validityDays}`,
            `-storepass "${keystoreConfig.storePassword}"`,
            `-keypass "${keystoreConfig.keyPassword}"`,
            `-dname "${dn}"`
        ].join(' ');
        
        progress.log('Executing keytool command...', 'info');
        runCommand(keystoreCommand);
        
        // Verify keystore was created
        if (!fs.existsSync(keystorePath)) {
            throw new Error('Keystore file was not created successfully');
        }
        
        progress.log(`Keystore created successfully at: ${keystorePath}`, 'success');
        progress.log(`Key alias: ${keystoreConfig.keyAlias}`, 'info');
        progress.log(`Validity: ${keystoreConfig.validityYears || 25} years`, 'info');
        
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
        if (!fs.existsSync(keystorePath)) {
            throw new Error(`Keystore not found at: ${keystorePath}`);
        }
        
        // Get absolute path for the project directory
        const absoluteProjectPath = path.resolve(newProjectPath);
        
        // Change to project directory
        const originalCwd = process.cwd();
        process.chdir(absoluteProjectPath);
        
        progress.log(`Changed to project directory: ${absoluteProjectPath}`, 'info');
        
        // Verify gradlew exists using absolute path
        const gradlewPath = path.join(absoluteProjectPath, 'gradlew');
        progress.log(`Looking for gradlew at: ${gradlewPath}`, 'info');
        
        if (!fs.existsSync(gradlewPath)) {
            // List files in the project directory for debugging
            try {
                const files = fs.readdirSync(absoluteProjectPath);
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
            runCommand(`chmod +x ./gradlew`);
        } catch (chmodError) {
            progress.log(`Warning: Could not make gradlew executable: ${chmodError.message}`, 'warning');
        }
        
        try {
            // Clean previous builds
            progress.log('Cleaning previous builds...', 'info');
            try {
                runCommand('./gradlew clean');
                progress.log('Clean completed successfully', 'success');
            } catch (cleanError) {
                progress.log(`Warning: Clean failed: ${cleanError.message}`, 'warning');
                // Continue anyway as this might not be critical
            }
            
            // Build signed AAB
            progress.log('Building signed AAB...', 'info');
            const bundleCommand = [
                './gradlew bundleRelease',
                `-Pandroid.injected.signing.store.file="${keystorePath}"`,
                `-Pandroid.injected.signing.store.password="${keystoreConfig.storePassword}"`,
                `-Pandroid.injected.signing.key.alias="${keystoreConfig.keyAlias}"`,
                `-Pandroid.injected.signing.key.password="${keystoreConfig.keyPassword}"`
            ].join(' ');
            
            progress.log(`Executing: ${bundleCommand}`, 'info');
            runCommand(bundleCommand);
            progress.log('Bundle build completed', 'success');
            
            // Find the generated AAB file
            const aabPath = path.join(newProjectPath, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
            
            progress.log(`Looking for AAB file at: ${aabPath}`, 'info');
            
            if (!fs.existsSync(aabPath)) {
                // Try to find AAB files in the build output directory
                const bundleDir = path.join(newProjectPath, 'app', 'build', 'outputs', 'bundle');
                progress.log(`AAB not found at expected location. Checking bundle directory: ${bundleDir}`, 'warning');
                
                if (fs.existsSync(bundleDir)) {
                    try {
                        const findAabCommand = `find "${bundleDir}" -name "*.aab" -type f`;
                        const foundAabs = runCommand(findAabCommand);
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
            const stats = fs.statSync(aabPath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            
            progress.log(`Signed AAB created successfully!`, 'success');
            progress.log(`AAB location: ${aabPath}`, 'info');
            progress.log(`AAB size: ${fileSizeMB} MB`, 'info');
            
            // Optionally copy AAB to a more accessible location
            const outputDir = path.join(newProjectPath, 'release');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            const outputAabPath = path.join(outputDir, `${androidConfig.newProjectName}-release.aab`);
            fs.copyFileSync(aabPath, outputAabPath);
            
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

    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found at: ${configPath}`);
    }

    progress.log(`Reading config from: ${configPath}`, 'info');
    
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    
    if (!config.android) {
        throw new Error('Android configuration missing in config file');
    }

    const { android } = config;
    
    // Validate required fields
    if (!android.oldProjectName) {
        throw new Error('oldProjectName is required in android config');
    }
    
    if (!android.newProjectName) {
        throw new Error('newProjectName is required in android config');
    }
    
    if (!android.projectPath) {
        throw new Error('projectPath is required in android config');
    }

    progress.log(`Old project name: ${android.oldProjectName}`, 'info');
    progress.log(`New project name: ${android.newProjectName}`, 'info');
    progress.log(`Project path: ${android.projectPath}`, 'info');
    
    if (android.deploymentPath) {
        progress.log(`Custom deployment path: ${android.deploymentPath}`, 'info');
    } else {
        const parentDir = path.dirname(android.projectPath);
        const defaultDeploymentPath = path.join(parentDir, `${android.newProjectName}-deployment`);
        progress.log(`Default deployment path: ${defaultDeploymentPath}`, 'info');
    }
    
    if (android.createSignedAAB) {
        progress.log(`Signed AAB creation: Enabled`, 'info');
    } else {
        progress.log(`Signed AAB creation: Disabled (set createSignedAAB: true to enable)`, 'info');
    }
    
    return { android, config };
}

async function validateProjectStructure(androidConfig) {
    const { projectPath, oldProjectName, newProjectName } = androidConfig;
    
    progress.log('Validating project structure...', 'info');
    
    if (!fs.existsSync(projectPath)) {
        throw new Error(`Project path does not exist: ${projectPath}`);
    }
    
    // Check if the old project name exists in the path
    if (!projectPath.includes(oldProjectName)) {
        progress.log(`Warning: Project path doesn't contain old project name "${oldProjectName}"`, 'warning');
    }
    
    // Get the parent directory where the deployment project should be created
    const parentDir = path.dirname(projectPath);
    const currentProjectDir = path.basename(projectPath);
    
    if (currentProjectDir !== oldProjectName) {
        progress.log(`Warning: Current directory name "${currentProjectDir}" differs from old project name "${oldProjectName}"`, 'warning');
    }
    
    // Create deployment directory path - ensure it's absolute
    const deploymentPath = androidConfig.deploymentPath 
        ? path.resolve(androidConfig.deploymentPath)
        : path.resolve(parentDir, `${newProjectName}-deployment`);
    
    progress.log(`Original project: ${projectPath}`, 'info');
    progress.log(`Deployment target: ${deploymentPath}`, 'info');
    
    // Verify paths are absolute
    if (!path.isAbsolute(deploymentPath)) {
        throw new Error(`Deployment path must be absolute: ${deploymentPath}`);
    }
    progress.log('Project structure validation completed', 'success');
    
    return {
        parentDir,
        currentProjectDir,
        oldProjectPath: projectPath,
        newProjectPath: deploymentPath,
        deploymentPath
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
        runCommand(`cp -r "${projectPaths.oldProjectPath}" "${backupPath}"`);
        progress.log(`Backup created at: ${backupPath}`, 'success');
        return backupPath;
    } catch (error) {
        throw new Error(`Failed to create backup: ${error.message}`);
    }
}

async function createDeploymentProject(projectPaths, androidConfig) {
    const { oldProjectPath, newProjectPath } = projectPaths;
    const { oldProjectName, newProjectName } = androidConfig;
    
    progress.log('Creating deployment project...', 'info');
    
    // Check if deployment directory already exists
    if (fs.existsSync(newProjectPath)) {
        if (!androidConfig.overwriteExisting) {
            throw new Error(`Deployment directory already exists: ${newProjectPath}. Set overwriteExisting: true to proceed.`);
        }
        progress.log('Removing existing deployment directory...', 'warning');
        runCommand(`rm -rf "${newProjectPath}"`);
    }
    
    try {
        // Copy the entire project to the deployment location
        progress.log(`Copying project to deployment location...`, 'info');
        progress.log(`Source: ${oldProjectPath}`, 'info');
        progress.log(`Destination: ${newProjectPath}`, 'info');
        
        runCommand(`cp -r "${oldProjectPath}" "${newProjectPath}"`);
        progress.log(`Created deployment copy: ${path.basename(oldProjectPath)} → ${path.basename(newProjectPath)}`, 'success');
        
        // Verify critical files were copied
        const gradlewPath = path.join(newProjectPath, 'gradlew');
        const buildGradlePath = path.join(newProjectPath, 'build.gradle');
        const appBuildGradlePath = path.join(newProjectPath, 'app', 'build.gradle');
        
        progress.log(`Checking copied files:`, 'info');
        progress.log(`  gradlew exists: ${fs.existsSync(gradlewPath)}`, 'info');
        progress.log(`  build.gradle exists: ${fs.existsSync(buildGradlePath)}`, 'info');
        progress.log(`  app/build.gradle exists: ${fs.existsSync(appBuildGradlePath)}`, 'info');
        
        if (!fs.existsSync(gradlewPath)) {
            // List files in the copied directory
            try {
                const files = fs.readdirSync(newProjectPath);
                progress.log(`Files in deployment directory: ${files.join(', ')}`, 'warning');
            } catch (listError) {
                progress.log(`Could not list deployment directory: ${listError.message}`, 'warning');
            }
        }
        
    } catch (error) {
        throw new Error(`Failed to create deployment copy: ${error.message}`);
    }
    
    // Find and rename any subdirectories that contain the old project name within the deployment copy
    try {
        const findCommand = `find "${newProjectPath}" -type d -name "*${oldProjectName}*"`;
        const result = runCommand(findCommand);
        
        if (result.trim()) {
            const dirsToRename = result.trim().split('\n').filter(dir => dir.trim());
            
            for (const dir of dirsToRename) {
                const newDirName = dir.replace(new RegExp(oldProjectName, 'g'), newProjectName);
                if (dir !== newDirName) {
                    runCommand(`mv "${dir}" "${newDirName}"`);
                    progress.log(`Renamed subdirectory: ${path.basename(dir)} → ${path.basename(newDirName)}`, 'success');
                }
            }
        }
    } catch (error) {
        progress.log(`Warning: Error finding subdirectories to rename: ${error.message}`, 'warning');
    }
    
    progress.log('Deployment project creation completed', 'success');
    progress.log(`Original project preserved at: ${oldProjectPath}`, 'info');
    progress.log(`Deployment project created at: ${newProjectPath}`, 'success');
}

async function updateFileContents(projectPaths, androidConfig) {
    const { newProjectPath } = projectPaths;
    const { oldProjectName, newProjectName } = androidConfig;
    
    progress.log('Updating file contents and names...', 'info');
    
    try {
        // Find and rename files that contain the old project name
        const findFilesCommand = `find "${newProjectPath}" -type f -name "*${oldProjectName}*"`;
        const fileResult = runCommand(findFilesCommand);
        
        if (fileResult.trim()) {
            const filesToRename = fileResult.trim().split('\n').filter(file => file.trim());
            
            for (const file of filesToRename) {
                const newFileName = file.replace(new RegExp(oldProjectName, 'g'), newProjectName);
                if (file !== newFileName) {
                    runCommand(`mv "${file}" "${newFileName}"`);
                    progress.log(`Renamed file: ${path.basename(file)} → ${path.basename(newFileName)}`, 'success');
                }
            }
        }
        
        // Update file contents that reference the old project name
        const fileTypes = [
            '*.gradle',
            '*.xml',
            '*.json',
            '*.properties',
            '*.java',
            '*.kt',
            '*.js',
            '*.ts',
            '*.md'
        ];
        
        for (const fileType of fileTypes) {
            try {
                const findContentCommand = `find "${newProjectPath}" -name "${fileType}" -type f`;
                const files = runCommand(findContentCommand);
                
                if (files.trim()) {
                    const fileList = files.trim().split('\n').filter(file => file.trim());
                    
                    for (const file of fileList) {
                        try {
                            const content = fs.readFileSync(file, 'utf8');
                            if (content.includes(oldProjectName)) {
                                const updatedContent = content.replace(new RegExp(oldProjectName, 'g'), newProjectName);
                                fs.writeFileSync(file, updatedContent, 'utf8');
                                progress.log(`Updated content in: ${path.relative(newProjectPath, file)}`, 'info');
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

async function cleanupAndVerify(projectPaths, androidConfig) {
    const { newProjectPath } = projectPaths;
    const { oldProjectName, newProjectName } = androidConfig;
    
    progress.log('Performing cleanup and verification...', 'info');
    
    try {
        // Verify that the new project directory exists
        if (!fs.existsSync(newProjectPath)) {
            throw new Error('New project directory not found after deployment operation');
        }
        
        // Check for any remaining references to the old project name
        const remainingRefsCommand = `find "${newProjectPath}" -type f \\( -name "*.gradle" -o -name "*.xml" -o -name "*.json" -o -name "*.properties" \\) -exec grep -l "${oldProjectName}" {} \\;`;
        
        try {
            const remainingRefs = runCommand(remainingRefsCommand);
            if (remainingRefs.trim()) {
                progress.log('Warning: Some files still contain references to the old project name:', 'warning');
                const files = remainingRefs.trim().split('\n');
                files.forEach(file => {
                    progress.log(`  - ${path.relative(newProjectPath, file)}`, 'warning');
                });
            } else {
                progress.log('No remaining references to old project name found', 'success');
            }
        } catch (grepError) {
            // No matches found (grep returns non-zero exit code when no matches)
            progress.log('No remaining references to old project name found', 'success');
        }
        
        progress.log('Cleanup and verification completed', 'success');
        
    } catch (error) {
        throw new Error(`Error during cleanup and verification: ${error.message}`);
    }
}

async function createAndroidDeployment(configPath) {
    let androidConfig;
    let projectPaths;
    let backupPath;
    
    try {
        // Initialize configuration
        progress.start('config');
        const { android } = await initializeConfig(configPath);
        androidConfig = android;
        progress.complete('config');

        // Validate project structure
        progress.start('validation');
        projectPaths = await validateProjectStructure(androidConfig);
        progress.complete('validation');

        // Create backup if requested
        progress.start('backup');
        backupPath = await createBackup(projectPaths, androidConfig);
        progress.complete('backup');
        
        // Create deployment project copy
        progress.start('createDeploymentProject');
        await createDeploymentProject(projectPaths, androidConfig);
        progress.complete('createDeploymentProject');
        
        // Update file contents
        progress.start('updateFileContents');
        await updateFileContents(projectPaths, androidConfig);
        progress.complete('updateFileContents');
        
        // Create keystore if needed
        progress.start('createKeystore');
        const keystorePath = await createKeystore(projectPaths, androidConfig);
        progress.complete('createKeystore');
        
        // Create signed AAB if keystore was created/found and enabled in config
        let aabResult = null;
        if (keystorePath && androidConfig.createSignedAAB) {
            progress.start('createSignedAAB');
            aabResult = await createSignedAAB(projectPaths, androidConfig, keystorePath);
            progress.complete('createSignedAAB');
        } else if (!androidConfig.createSignedAAB) {
            progress.log('Signed AAB creation skipped (not enabled in config)', 'info');
        } else if (!keystorePath) {
            progress.log('Signed AAB creation skipped (no keystore available)', 'warning');
        }
        
        // Cleanup and verify
        progress.start('cleanup');
        await cleanupAndVerify(projectPaths, androidConfig);
        progress.complete('cleanup');

        // Print completion summary
        progress.printTreeContent('Deployment Summary', [
            'Project deployment completed successfully:',
            { text: `Original project: ${projectPaths.oldProjectPath}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Deployment project: ${projectPaths.newProjectPath}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Old name: ${androidConfig.oldProjectName}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `New name: ${androidConfig.newProjectName}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Backup created: ${backupPath ? 'Yes' : 'No'}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Keystore: ${keystorePath ? 'Created/Verified' : 'Skipped'}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Signed AAB: ${aabResult ? 'Created' : 'Skipped'}`, indent: 1, prefix: '└─ ', color: 'gray' },
            '',
            'File Locations:',
            { text: `Original preserved at: ${projectPaths.oldProjectPath}`, indent: 1, prefix: '├─ ', color: 'green' },
            ...(backupPath ? [{ text: `Backup location: ${backupPath}`, indent: 1, prefix: '├─ ', color: 'gray' }] : []),
            ...(keystorePath ? [{ text: `Keystore: ${keystorePath}`, indent: 1, prefix: '├─ ', color: 'gray' }] : []),
            ...(aabResult ? [
                { text: `AAB file: ${aabResult.outputAabPath}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `AAB size: ${aabResult.fileSize} MB`, indent: 1, prefix: '└─ ', color: 'gray' }
            ] : [{ text: `Deployment ready at: ${projectPaths.newProjectPath}`, indent: 1, prefix: '└─ ', color: 'green' }])
        ]);

        process.exit(0);
        
    } catch (error) {
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, error.message);
            
            progress.printTreeContent('Troubleshooting Guide', [
                'Deployment operation failed. Please check the following:',
                { text: 'Verify config file exists and contains required android configuration', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Ensure project path exists and is accessible', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Check file/directory permissions', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Verify no processes are using the project directory', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Ensure sufficient disk space for project copy', indent: 1, prefix: '└─ ', color: 'yellow' },
                '\nConfiguration Details:',
                { text: `Config path: ${configPath}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `Old project name: ${androidConfig?.oldProjectName || 'Not loaded'}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `New project name: ${androidConfig?.newProjectName || 'Not loaded'}`, indent: 1, prefix: '├─ ', color: 'gray' },
                { text: `Project path: ${androidConfig?.projectPath || 'Not loaded'}`, indent: 1, prefix: '└─ ', color: 'gray' }
            ]);
        }
        
        process.exit(1);
    }
}

// Export the main function for use as a module
export { createAndroidDeployment, createAndroidDeployment as renameAndroidProject };

// Execute if run directly
if (import.meta.url.startsWith('file:') && process.argv[1] === new URL(import.meta.url).pathname) {
    const configPath = process.argv[2];
    if (!configPath) {
        console.error('Usage: node renameAndroidProject.js <config-path>');
        process.exit(1);
    }
    createAndroidDeployment(configPath).catch(error => {
        console.error('Script failed:', error.message);
        process.exit(1);
    });
}