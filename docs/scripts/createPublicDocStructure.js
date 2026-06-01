const fs = require('fs')
const path = require('path')
const { requireUncached } = require('../server/utils/constants')
const { filterRoutes } = require('../server/utils/common')
const { findRoutesAndVersions } = require('../server/utils/script')

const folderName = path.join(__dirname, '../public-docs/docs')
const collectionFolder = path.resolve(__dirname, '../server/collection-files')
const privateDocsPath = path.resolve(__dirname, '../docs')
const contentFolder = path.resolve(__dirname, '../content')
const publicDocsPlaceholderPath = path.resolve(
    __dirname,
    '../public-docs/docs/Installation.md'
)
const legacyInstallationPlaceholders = [
    path.resolve(__dirname, '../public-docs/docs/00-Installation.md'),
    path.resolve(__dirname, '../public-docs/docs/00-index.md'),
    path.resolve(__dirname, '../docs/Installation.md'),
]
const privateDocsConfig = requireUncached(
    path.resolve(__dirname, '../privateDocs.config.js')
)

try {
    if (!fs.existsSync(folderName)) {
        fs.mkdirSync(folderName, { recursive: true })
    }
    if (!fs.existsSync(privateDocsPath)) {
        fs.mkdirSync(privateDocsPath, { recursive: true })
    }
    if (!fs.existsSync(contentFolder)) {
        fs.mkdirSync(contentFolder, { recursive: true })
    }
    if (!fs.existsSync(collectionFolder)) {
        fs.mkdirSync(collectionFolder, { recursive: true })
    }
    legacyInstallationPlaceholders.forEach((legacyPath) => {
        if (fs.existsSync(legacyPath)) {
            fs.rmSync(legacyPath)
        }
    })
    fs.writeFileSync(
        publicDocsPlaceholderPath,
        [
            '---',
            'title: Internal Placeholder',
            'unlisted: true',
            'slug: /public-docs-placeholder',
            'noindex: true',
            '---',
            '',
            'Internal placeholder doc to satisfy docs plugin minimum content.',
            '',
        ].join('\n'),
        'utf-8'
    )
    // copy all the docs to the public-docs folder and then edit the sidebar files
    const serviceNames = filterRoutes(
        privateDocsConfig.customFields.private,
        privateDocsConfig.customFields.public
    )
    Object.keys(serviceNames ?? {})?.forEach((item) => {
        const serviceDir = path.resolve(
            __dirname,
            `../public-docs/docs/${item.split('_').join('-')}`
        )
        if (!fs.existsSync(serviceDir)) {
            fs.mkdirSync(serviceDir, { recursive: true })
        }
        fs.cpSync(
            path.resolve(__dirname, `../docs/${item.split('_').join('-')}`),
            serviceDir,
            { recursive: true }
        )
    })
    const { serviceVersionsToAdd } = findRoutesAndVersions(serviceNames, true)
    for ([key, value] of Object.entries(serviceVersionsToAdd)) {
        if (
            fs.existsSync(
                path.resolve(
                    __dirname,
                    `../public-docs/docs/${key.split('_').join('-')}/versions.json`
                )
            )
        ) {
            const versionFile = requireUncached(
                path.resolve(
                    __dirname,
                    `../public-docs/docs/${key.split('_').join('-')}/versions.json`
                )
            )
            const filteredVersionFile = versionFile.filter((item) =>
                value.includes(item.version)
            )
            let versionFileString = JSON.stringify(filteredVersionFile)
            const finalVersionFile = versionFileString.replaceAll(
                'private_docs',
                'public_docs'
            )
            fs.writeFileSync(
                path.resolve(
                    __dirname,
                    `../public-docs/docs/${key.split('_').join('-')}/versions.json`
                ),
                finalVersionFile,
                'utf-8'
            )
        }
    }
    console.log('Public-docs copied successfully')
} catch (err) {
    console.error(err)
}
