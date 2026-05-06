const fs = require('fs')
const path = require('path')
const config = require('../config.json')

// Define the target folders
const targetFolders = ['login-page', 'server', 'static']

// Read the content of config.json
const configContent = fs.readFileSync(
    path.resolve(__dirname, '..', 'config.json'),
    'utf8'
)

// Copy config.json to each target folder
targetFolders.forEach((folder) => {
    let targetPath = path.resolve(__dirname, '..', folder, 'config.json')
    if (folder === 'login-page') {
        targetPath = path.resolve(__dirname, '..', folder, 'src', 'config.json')
    }
    if (folder === 'static') {
        targetPath = path.resolve(__dirname, '..', folder, 'js', 'config.js')
        const scriptContent = `const serverUrl = "${config.docs.server_url}"`
        fs.writeFileSync(targetPath, scriptContent, 'utf-8')
    } else {
        fs.writeFileSync(targetPath, configContent, 'utf8')
    }
})

console.log('Prebuild step completed.')
