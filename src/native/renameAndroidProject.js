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

const progress = new SimpleProgress("Android Project Rename");

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
    
    return { android, config };
}

async function validateProjectStructure(androidConfig) {
    const { projectPath, oldProjectName } = androidConfig;
    
    progress.log('Validating project structure...', 'info');
    
    if (!fs.existsSync(projectPath)) {
        throw new Error(`Project path does not exist: ${projectPath}`);
    }
    
    // Check if the old project name exists in the path
    if (!projectPath.includes(oldProjectName)) {
        progress.log(`Warning: Project path doesn't contain old project name "${oldProjectName}"`, 'warning');
    }
    
    // Get the parent directory where the project should be renamed
    const parentDir = path.dirname(projectPath);
    const currentProjectDir = path.basename(projectPath);
    
    if (currentProjectDir !== oldProjectName) {
        progress.log(`Warning: Current directory name "${currentProjectDir}" differs from old project name "${oldProjectName}"`, 'warning');
    }
    
    progress.log('Project structure validation completed', 'success');
    
    return {
        parentDir,
        currentProjectDir,
        oldProjectPath: projectPath,
        newProjectPath: path.join(parentDir, androidConfig.newProjectName)
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

async function renameProjectDirectories(projectPaths, androidConfig) {
    const { oldProjectPath, newProjectPath } = projectPaths;
    const { oldProjectName, newProjectName } = androidConfig;
    
    progress.log('Renaming project directories...', 'info');
    
    // First, rename the main project directory
    if (fs.existsSync(newProjectPath)) {
        if (!androidConfig.overwriteExisting) {
            throw new Error(`Target directory already exists: ${newProjectPath}. Set overwriteExisting: true to proceed.`);
        }
        progress.log('Removing existing target directory...', 'warning');
        runCommand(`rm -rf "${newProjectPath}"`);
    }
    
    try {
        runCommand(`mv "${oldProjectPath}" "${newProjectPath}"`);
        progress.log(`Renamed main directory: ${path.basename(oldProjectPath)} → ${path.basename(newProjectPath)}`, 'success');
    } catch (error) {
        throw new Error(`Failed to rename main directory: ${error.message}`);
    }
    
    // Find and rename any subdirectories that contain the old project name
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
    
    progress.log('Directory renaming completed', 'success');
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
            throw new Error('New project directory not found after rename operation');
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

async function renameAndroidProject(configPath) {
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
        
        // Rename directories
        progress.start('renameDirectories');
        await renameProjectDirectories(projectPaths, androidConfig);
        progress.complete('renameDirectories');
        
        // Update file contents
        progress.start('updateFileContents');
        await updateFileContents(projectPaths, androidConfig);
        progress.complete('updateFileContents');
        
        // Cleanup and verify
        progress.start('cleanup');
        await cleanupAndVerify(projectPaths, androidConfig);
        progress.complete('cleanup');

        // Print completion summary
        progress.printTreeContent('Rename Summary', [
            'Project rename completed successfully:',
            { text: `Old name: ${androidConfig.oldProjectName}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `New name: ${androidConfig.newProjectName}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `New path: ${projectPaths.newProjectPath}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Backup created: ${backupPath ? 'Yes' : 'No'}`, indent: 1, prefix: '└─ ', color: 'gray' },
            ...(backupPath ? [{ text: `Backup location: ${backupPath}`, indent: 1, prefix: '   ', color: 'gray' }] : [])
        ]);

        process.exit(0);
        
    } catch (error) {
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, error.message);
            
            progress.printTreeContent('Troubleshooting Guide', [
                'Rename operation failed. Please check the following:',
                { text: 'Verify config file exists and contains required android configuration', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Ensure project path exists and is accessible', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Check file/directory permissions', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Verify no processes are using the project directory', indent: 1, prefix: '└─ ', color: 'yellow' },
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
export { renameAndroidProject };

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const configPath = process.argv[2];
    if (!configPath) {
        console.error('Usage: node renameAndroidProject.js <config-path>');
        process.exit(1);
    }
    renameAndroidProject(configPath);
}