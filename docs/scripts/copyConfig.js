const fs = require('fs')
const path = require('path')
const config = require('../config.json')

// Define the target folders
const targetFolders = ['server', 'static']

// Read the content of config.json
const configContent = fs.readFileSync(
    path.resolve(__dirname, '..', 'config.json'),
    'utf8'
)

// Copy config.json to each target folder
targetFolders.forEach((folder) => {
    if (folder === 'static') {
        const targetPath = path.resolve(
            __dirname,
            '..',
            'static',
            'js',
            'config.js'
        )
        const scriptContent = `const serverUrl = "${config.docs.server_url}"`
        fs.writeFileSync(targetPath, scriptContent, 'utf-8')
    } else {
        const targetPath = path.resolve(
            __dirname,
            '..',
            'server',
            'config.json'
        )
        fs.writeFileSync(targetPath, configContent, 'utf8')
    }
})

console.log('Prebuild step completed.')
