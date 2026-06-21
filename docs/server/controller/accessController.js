const router = require('express').Router()
const path = require('node:path')
const fs = require('node:fs')
const {
    updateExcludeEntryInConfig,
    updateConfigFile,
    addPublicDocsRouteToConfig,
    pushFilesToBitbucket,
    createTempDir,
    deleteTempDir,
    findRoutesAndVersions,
    updateVersionSidebarFile,
    addServiceAndVersionListForPublicDocs,
} = require('../utils/script')
const { exec } = require('node:child_process')
const { filterRoutes, snakeCaseToString } = require('../utils/common')
const { requireUncached, generateBasicTemplate } = require('../utils/constants')
const {
    apiAuthChecker,
    checkAccessControlPermission,
} = require('../middleware/authCheker')
const config = require('../config.json')

router.post(
    '/assign_access',
    apiAuthChecker,
    checkAccessControlPermission,
    async (req, res) => {
        // req.body format = {
        //     "serive_1": ["route-1", "route-2"],
        //     "service_2": ["route-1", "route-2"]
        // }
        createTempDir()
        const privateDocusaurusConfig = requireUncached(
            '../../privateDocs.config.js'
        )
        // Extract the unchecked routes which are to be removed from the build
        const serviceNames = filterRoutes(
            privateDocusaurusConfig.customFields.private,
            req.body
        )

        const publicDocsConfigPath = path.resolve(
            __dirname,
            '../../publicDocs.config.js'
        )
        const publicSidebarPath = path.resolve(
            __dirname,
            '../../publicSidebars.js'
        )
        res.status(201).json({ is_success: true, status_code: 201 })
        try {
            const publicDocusaurusConfig = requireUncached(publicDocsConfigPath)
            const serviceList = Object.keys(
                publicDocusaurusConfig.plugins[0][1].config
            )
            fs.copyFileSync(
                publicDocsConfigPath,
                path.resolve(__dirname, '../../temp/publicDocs.config.js')
            )
            fs.copyFileSync(
                publicSidebarPath,
                path.resolve(__dirname, '../../temp/publicSidebars.js')
            )
            // Find all the not allowed filenames and allowed service and their versions
            const { excludeEntries, serviceVersionsToAdd } =
                findRoutesAndVersions(serviceNames)
            // Remove all entries from the sidebar and generate a new sidebar file
            generateBasicTemplate(
                path.resolve(__dirname, '../../temp/publicSidebars.js')
            )

            // Check if the service is already present in docusaurus.config.js or not. if not then create a new entry for the service
            for ([key, value] of Object.entries(serviceVersionsToAdd)) {
                value.map((version, idx) => {
                    updateConfigFile(
                        path.resolve(
                            __dirname,
                            '../../temp/publicDocs.config.js'
                        ),
                        snakeCaseToString(key),
                        'public-docs',
                        version
                    )
                    // create entries in public sidebars file for all the allowed services and versions
                    updateVersionSidebarFile(
                        path.resolve(__dirname, '../../temp/publicSidebars.js'),
                        snakeCaseToString(key),
                        'public-docs',
                        version,
                        idx === 0 ? true : false
                    )
                })
            }
            // Add all the filenames which are to be removed from the public build, in publicConfig's exclude field
            updateExcludeEntryInConfig(
                path.resolve(__dirname, '../../temp/publicDocs.config.js'),
                excludeEntries
            )
            // Add all the allowed service and routes in privateConfig's custom -> public field
            addPublicDocsRouteToConfig(req.body)
            // Add all the service and their versions in publicConfig's custom -> public field (for the UI of service list page)
            addServiceAndVersionListForPublicDocs(
                path.resolve(__dirname, '../../temp/publicDocs.config.js'),
                serviceVersionsToAdd
            )

            if (!config.server.BUILD_USING_BITBUCKET) {
                exec(
                    'npm run build',
                    { cwd: path.resolve(__dirname, '../../') },
                    (err) => {
                        if (err) {
                            console.log(`Build Failed: ${err}`)
                            return
                        }
                    }
                )
            } else {
                const oldFileList = [
                    path.resolve(__dirname, '../../publicDocs.config.js'),
                    path.resolve(__dirname, '../../privateDocs.config.js'),
                    path.resolve(__dirname, '../../publicSidebars.js'),
                ]
                await pushFilesToBitbucket(null, oldFileList, false, false)
                console.log('Pushed to bitbucket successfully')
                deleteTempDir()
            }
        } catch (error) {
            console.log(error)
        }
    }
)

module.exports = router
