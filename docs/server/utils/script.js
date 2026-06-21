const path = require('node:path')
const fs = require('node:fs')
const esprima = require('esprima')
const escodegen = require('escodegen')
const { exec } = require('node:child_process')
const {
    generateConfigEntry,
    requireUncached,
    generateStringEntry,
    generateServiceEntry,
    generateVersionImport,
    generateVersionedServiceSidebar,
    generateVersionEntryForConfig,
    generateCustomFieldVersion,
    generatePublicRouteEntry,
    generatePublicServiceAndVersionList,
} = require('./constants')
const {
    stringToKebabCase,
    stringToSnakeCase,
    filterRoutes,
} = require('./common')
const {
    updateFilesToBitbucketRepo,
    createPullRequestOnBitbucket,
} = require('./bitbucket')
const config = require('../config.json')
const FormData = require('form-data')
const short = require('short-uuid')
const { promisify } = require('util')
const execAsync = promisify(exec)

const updateConfigFile = (docusaurusConfigPath, apiName, docType, version) => {
    try {
        let currentConfigFile
        if (docType === 'public-docs') {
            currentConfigFile = requireUncached('../../publicDocs.config.js')
        } else {
            currentConfigFile = requireUncached(docusaurusConfigPath)
        }
        const code = fs.readFileSync(docusaurusConfigPath, 'utf8')

        // Parse the JavaScript code using esprima
        const configAST = esprima.parseModule(code, {
            range: true,
            tokens: true,
            comment: true,
        })

        // Find the config object inside plugins array
        const configVariablesAST = configAST?.body?.filter(
            (value) => value?.type === 'VariableDeclaration'
        )
        let mainConfigObject = {}
        configVariablesAST?.map((variable) => {
            const config = variable?.declarations?.find(
                (item) => item.id.name === 'configObject'
            )
            if (config) {
                mainConfigObject = { ...config }
            }
        })
        const pluginsArray = mainConfigObject?.init?.properties?.find(
            (property) => property?.key?.name === 'plugins'
        )
        const arrayHavingConfigObject = pluginsArray?.value?.elements?.find(
            (element) => element?.type === 'ArrayExpression'
        )
        const configObjectAST = arrayHavingConfigObject?.elements
            ?.find((item) => item?.type === 'ObjectExpression')
            ?.properties?.find((value) => value?.key?.name === 'config')

        if (configObjectAST) {
            // Extract the code for the config object
            const configObjectStringCode = code.substring(
                configObjectAST.range[0],
                configObjectAST.range[1]
            )

            // create the entry to add into docusaurus.config.json file
            const currentServiceList = Object.keys(
                currentConfigFile?.plugins[0][1]?.config
            )
            const currentServiceVersionList = Object.keys(
                currentConfigFile?.plugins[0][1]?.config[
                    stringToSnakeCase(apiName)
                ]?.versions ?? {}
            )
            if (!currentServiceList?.includes(stringToSnakeCase(apiName))) {
                configObjectAST.value.properties.push(
                    generateConfigEntry(apiName, version, docType)
                )
            } else if (
                currentServiceList?.includes(stringToSnakeCase(apiName)) &&
                !currentServiceVersionList?.includes(version)
            ) {
                configObjectAST?.value.properties
                    ?.find(
                        (item) => item?.key?.name === stringToSnakeCase(apiName)
                    )
                    ?.value?.properties?.find(
                        (value) => value?.key?.name === 'versions'
                    )
                    ?.value?.properties?.push(
                        generateVersionEntryForConfig(apiName, version, docType)
                    )
            }

            // Convert the modified config object back to code
            const updateConfigStringCode = escodegen.generate(configObjectAST)

            // Replace the old config object code with the updated one in the original code
            const updatedCode = code.replace(
                configObjectStringCode,
                updateConfigStringCode
            )

            // Write the updated code back to the file
            const newFileName =
                docType === 'public-docs'
                    ? 'publicDocs.config.js'
                    : 'privateDocs.config.js'

            fs.writeFileSync(
                path.resolve(__dirname, `../../temp/${newFileName}`),
                updatedCode,
                'utf8'
            )
            console.log('New config entry added to docusaurus.config.js')
        } else {
            console.log('config object not found in the code.')
        }
    } catch (error) {
        console.log(`Error in updating config file: ${error}`)
    }
}

const replaceStringInDirectory = (
    directoryPath,
    originalString,
    substituteString
) => {
    fs.readdir(directoryPath, { encoding: 'utf-8' }, (err, files) => {
        if (err) {
            console.log(`Error in replacing <br> tag: ${err}`)
            return
        }
        files?.map((file) => {
            filePath = path.resolve(directoryPath, file)
            const fileCode = fs.readFileSync(filePath, 'utf-8')
            const updatedFileCode = fileCode?.replaceAll(
                originalString,
                substituteString
            )
            fs.writeFileSync(filePath, updatedFileCode, 'utf-8')
        })
    })
}

const createDocument = async (apiName, version) => {
    try {
        const originalConfigPath = path.resolve(
            __dirname,
            '../../privateDocs.config.js'
        )
        const tempConfigPath = path.resolve(
            __dirname,
            '../../temp/privateDocs.config.js'
        )
        const originalSidebarsPath = path.resolve(
            __dirname,
            '../../privateSidebars.js'
        )
        const tempSidebarsPath = path.resolve(
            __dirname,
            '../../temp/privateSidebars.js'
        )
        const oldDocsFilePathList = []
        // function to add all the file names in old service to the oldDocsFilePathList array
        handleNestedDirsForFormData(
            path.resolve(
                __dirname,
                `../../docs/${stringToKebabCase(apiName)}/${version}`
            ),
            oldDocsFilePathList
        )

        // ------------------------------First Update the entry in docusaurus.config.js file------------------------------------------
        addVersionsFileInServiceDir(apiName)
        updateConfigFile(
            path.resolve(__dirname, '../../privateDocs.config.js'),
            apiName,
            'private-docs',
            version
        )

        const configData = fs.readFileSync(originalConfigPath, 'utf-8')
        const newConfigData = fs.readFileSync(tempConfigPath, 'utf-8')
        fs.writeFileSync(originalConfigPath, newConfigData, 'utf-8')

        // generate the document
        await execAsync(
            `npm run gen-private-api-docs:version ${stringToSnakeCase(apiName)}:${version}`,
            { cwd: path.resolve(__dirname, '../../') }
        )
        console.log('docs generated successfully!')
        fs.writeFileSync(originalConfigPath, configData, 'utf-8')
        // ----------------------------------Update the entry in sidebars.js file---------------------------------------------
        updateVersionSidebarFile(
            path.resolve(__dirname, '../../privateSidebars.js'),
            apiName,
            'private-docs',
            version
        )

        // Replace all the <br> tag in generated files with <br/> tag
        replaceStringInDirectory(
            path.resolve(
                __dirname,
                `../../temp/docs/${stringToKebabCase(apiName)}/${version}`
            ),
            '<br>',
            '<br/>'
        )

        const updatedRouteList = addPrivateDocsRouteToConfig(apiName, version)

        handleAccessOnNewVersion(apiName, updatedRouteList, version)
        // create the build with updated values
        if (config.server.BUILD_USING_BITBUCKET) {
            await pushFilesToBitbucket(
                stringToKebabCase(apiName),
                oldDocsFilePathList,
                version
            )
            console.log('Pushed to bitbucket successfully!')
            deleteTempDir()
        } else {
            await execAsync('npm run build-private-docs', {
                cwd: path.resolve(__dirname, '../../'),
            })
        }
    } catch (error) {
        console.log(`Error in creating document ${error}`)
    }
}

const updateExcludeEntryInConfig = (docusaurusConfigPath, routeList) => {
    try {
        const code = fs.readFileSync(docusaurusConfigPath, 'utf8')

        // Parse the JavaScript code using esprima
        const configAST = esprima.parseModule(code, {
            range: true,
            tokens: true,
            comment: true,
        })

        // Find the config object inside plugins array
        const configVariablesAST = configAST?.body?.filter(
            (value) => value?.type === 'VariableDeclaration'
        )
        let mainConfigObject = {}
        configVariablesAST?.map((variable) => {
            const config = variable?.declarations?.find(
                (item) => item.id.name === 'configObject'
            )
            if (config) {
                mainConfigObject = { ...config }
            }
        })

        const presetsArray = mainConfigObject?.init?.properties?.find(
            (property) => property?.key?.name === 'presets'
        )
        const arrayHavingExcludeObject = presetsArray?.value?.elements?.find(
            (element) => element?.type === 'ArrayExpression'
        )
        const excludeArrayAST = arrayHavingExcludeObject?.elements
            ?.find((item) => item?.type === 'ObjectExpression')
            ?.properties?.find((item) => item.key.name === 'docs')
            ?.value.properties.find((item) => item.key.name === 'exclude')

        const excludeArrayStringCode = code.substring(
            excludeArrayAST.range[0],
            excludeArrayAST.range[1]
        )

        const newEntriesArray = routeList.map((route) => {
            return generateStringEntry(route)
        })
        excludeArrayAST.value.elements = newEntriesArray
        const updatedExludeStringCode = escodegen.generate(excludeArrayAST)
        const updatedExcludeCode = code.replace(
            excludeArrayStringCode,
            updatedExludeStringCode
        )
        fs.writeFileSync(docusaurusConfigPath, updatedExcludeCode, 'utf-8')
    } catch (error) {
        console.log(`Error in updating Exclude array in config file: ${error}`)
    }
}

const findRoutesAndVersions = (
    serviceAndRouteList,
    editSidebar = false,
    useTempDir = false
) => {
    try {
        const parentCategoryList = new Set([])
        const routeList = new Set([])
        const serviceVersionList = {}
        for ([serviceName, routes] of Object.entries(serviceAndRouteList)) {
            const serviceDocsPath = useTempDir
                ? path.resolve(
                      __dirname,
                      `../../temp/docs/${serviceName.split('_').join('-')}`
                  )
                : path.resolve(
                      __dirname,
                      `../../docs/${serviceName.split('_').join('-')}`
                  )
            const folderInsideServiceDocs = fs.readdirSync(serviceDocsPath)
            folderInsideServiceDocs.forEach((file) => {
                const filePath = path.join(serviceDocsPath, file)
                if (fs.statSync(filePath).isDirectory()) {
                    const sidebarItems = requireUncached(
                        useTempDir
                            ? `../../temp/docs/${serviceName.split('_').join('-')}/${file}/sidebar.js`
                            : `../../docs/${serviceName.split('_').join('-')}/${file}/sidebar.js`
                    )
                    let finalSidebarItems = []
                    if (routes.length > 0) {
                        routes.map((route) => {
                            const filteredSidebarItems = sidebarItems.map(
                                (sidebarItem) => {
                                    if (sidebarItem.items) {
                                        sidebarItem.items =
                                            sidebarItem.items.filter(
                                                (item) =>
                                                    item.id
                                                        .split(`${file}/`)
                                                        .join('') !== route
                                            )
                                        routeList.add(
                                            route.split('/').join(`/${file}/`) +
                                                '.api.mdx'
                                        )
                                        return sidebarItem
                                    } else {
                                        return sidebarItem
                                    }
                                }
                            )

                            finalSidebarItems = filteredSidebarItems.filter(
                                (sidebarItem) => {
                                    if (!sidebarItem.items) {
                                        return true
                                    } else if (sidebarItem?.items?.length > 0) {
                                        return true
                                    } else if (sidebarItem?.items?.length < 1) {
                                        sidebarItem?.link?.id &&
                                            parentCategoryList.add(
                                                `${sidebarItem?.link?.id}.tag.mdx`
                                            )
                                        return false
                                    }
                                }
                            )
                        })

                        serviceVersionList[serviceName] =
                            serviceVersionList[serviceName] ?? []
                        if (finalSidebarItems?.length === 1) {
                            if (
                                fs.existsSync(
                                    path.resolve(
                                        serviceDocsPath,
                                        file,
                                        `${finalSidebarItems[0].id.split('/')[2]}.info.mdx`
                                    )
                                )
                            ) {
                                routeList.add(
                                    `${finalSidebarItems[0].id}.info.mdx`
                                )
                                finalSidebarItems = []
                            }
                        } else {
                            serviceVersionList[serviceName]?.push(file)
                        }
                        if (
                            editSidebar &&
                            fs.existsSync(
                                path.resolve(
                                    __dirname,
                                    `../../public-docs/docs/${serviceName.split('_').join('-')}/${file}/sidebar.js`
                                )
                            )
                        ) {
                            fs.writeFileSync(
                                path.resolve(
                                    __dirname,
                                    `../../public-docs/docs/${serviceName.split('_').join('-')}/${file}/sidebar.js`
                                ),
                                `module.exports = ${JSON.stringify(finalSidebarItems)}`,
                                'utf-8'
                            )
                        }
                    } else {
                        serviceVersionList[serviceName] =
                            serviceVersionList[serviceName] ?? []
                        serviceVersionList[serviceName]?.push(file)
                    }
                }
            })
        }

        return {
            excludeEntries: [...routeList, ...parentCategoryList],
            serviceVersionsToAdd: serviceVersionList,
        }
    } catch (error) {
        console.log(`Error in filtering out service Sidebars ${error}`)
    }
}

const addPrivateDocsRouteToConfig = (
    apiName,
    version,
    updateVersion = false
) => {
    try {
        const serviceSidebarPath = path.resolve(
            __dirname,
            `../../temp/docs/${stringToKebabCase(apiName)}/${version}/sidebar.js`
        )
        const docConfigPath = path.resolve(
            __dirname,
            '../../temp/privateDocs.config.js'
        )
        const serviceSidebar = requireUncached(serviceSidebarPath)
        let serviceRouteList = []
        serviceSidebar.map((record) => {
            if (record?.items) {
                const docIds = record.items.map((doc) =>
                    doc.id?.split(`/${version}`).join('')
                )
                serviceRouteList = [...serviceRouteList, ...docIds]
            }
        })
        let currentServiceRoutes = []
        if (updateVersion) {
            const oldServiceSidebar = requireUncached(
                path.resolve(
                    __dirname,
                    `../../docs/${stringToKebabCase(apiName)}/${version}/sidebar.js`
                )
            )
            oldServiceSidebar.map((record) => {
                if (record?.items) {
                    const docIds = record.items.map((doc) =>
                        doc.id?.split(`/${version}`).join('')
                    )
                    currentServiceRoutes = [...currentServiceRoutes, ...docIds]
                }
            })
            const currentConfig = requireUncached(
                path.resolve(__dirname, '../../privateDocs.config.js')
            )
            const totalServiceRoutes =
                currentConfig.customFields.private[stringToSnakeCase(apiName)]
                    ?.routes ?? []
            currentServiceRoutes = totalServiceRoutes.filter(
                (item) => !currentServiceRoutes?.includes(item)
            )
        } else {
            const currentConfig = requireUncached(
                path.resolve(__dirname, '../../privateDocs.config.js')
            )
            currentServiceRoutes =
                currentConfig.customFields.private[stringToSnakeCase(apiName)]
                    ?.routes ?? []
        }
        const allVersionRoutes = [
            ...new Set([...serviceRouteList, ...currentServiceRoutes]),
        ]
        addServiceToConfigCustomFields(
            docConfigPath,
            apiName,
            allVersionRoutes,
            version
        )
        return allVersionRoutes
    } catch (err) {
        console.log(err)
    }
}

const addServiceToConfigCustomFields = (
    docusaurusConfigPath,
    apiName,
    serviceRouteList,
    version
) => {
    try {
        const code = fs.readFileSync(docusaurusConfigPath, 'utf8')

        // Parse the JavaScript code using esprima
        const configAST = esprima.parseModule(code, {
            range: true,
            tokens: true,
            comment: true,
        })

        // Find the config object inside plugins array
        const configVariablesAST = configAST?.body?.filter(
            (value) => value?.type === 'VariableDeclaration'
        )
        let mainConfigObject = {}
        configVariablesAST?.map((variable) => {
            const config = variable?.declarations?.find(
                (item) => item.id.name === 'configObject'
            )
            if (config) {
                mainConfigObject = { ...config }
            }
        })

        const customFieldsObject = mainConfigObject?.init?.properties?.find(
            (property) => property?.key?.name === 'customFields'
        )

        const privateObject = customFieldsObject?.value?.properties?.find(
            (property) => property?.key?.name === 'private'
        )

        const serviceObjectAST = privateObject?.value?.properties?.find(
            (property) =>
                property?.key?.name === `${stringToSnakeCase(apiName)}`
        )
        if (serviceObjectAST) {
            const docusaurusConfig = requireUncached(
                path.resolve(__dirname, '../../privateDocs.config.js')
            )
            const checkVersion = docusaurusConfig?.customFields?.private[
                stringToSnakeCase(apiName)
            ]?.info?.find((item) => item.version === version)
            const routeArrayAST = serviceObjectAST?.value?.properties?.find(
                (property) => property?.key?.name === 'routes'
            )
            const routeArrayStringCode = code.substring(
                routeArrayAST.range[0],
                routeArrayAST.range[1]
            )
            routeArrayAST.value.elements = serviceRouteList?.map((route) =>
                generateStringEntry(route)
            )
            const updatedRouteArrayStringCode =
                escodegen.generate(routeArrayAST)
            const updatedRouteArrayCode = code.replace(
                routeArrayStringCode,
                updatedRouteArrayStringCode
            )
            fs.writeFileSync(
                docusaurusConfigPath,
                updatedRouteArrayCode,
                'utf-8'
            )
            // If service is already listed in private object then update it
            updateVersion(
                docusaurusConfigPath,
                apiName,
                version,
                checkVersion ? true : false
            )
        } else {
            // If service is not present in private service routes then add it
            const privateObjectStringCode = code.substring(
                privateObject.range[0],
                privateObject.range[1]
            )
            privateObject.value.properties.push(
                generateServiceEntry(apiName, serviceRouteList, version)
            )
            const updatedStringPrivateObjectCode =
                escodegen.generate(privateObject)
            const updatedPrivateObjectCode = code.replace(
                privateObjectStringCode,
                updatedStringPrivateObjectCode
            )
            fs.writeFileSync(
                docusaurusConfigPath,
                updatedPrivateObjectCode,
                'utf-8'
            )
        }
    } catch (error) {
        console.log(
            `Error in updating entries into customFields object in config file: ${error}`
        )
    }
}

const updateVersion = (
    docusaurusConfigPath,
    apiName,
    version,
    updateOperation
) => {
    try {
        const code = fs.readFileSync(docusaurusConfigPath, 'utf8')

        // Parse the JavaScript code using esprima
        const configAST = esprima.parseModule(code, {
            range: true,
            tokens: true,
            comment: true,
        })

        // Find the config object inside plugins array
        const configVariablesAST = configAST?.body?.filter(
            (value) => value?.type === 'VariableDeclaration'
        )
        let mainConfigObject = {}
        configVariablesAST?.map((variable) => {
            const config = variable?.declarations?.find(
                (item) => item.id.name === 'configObject'
            )
            if (config) {
                mainConfigObject = { ...config }
            }
        })

        const customFieldsObject = mainConfigObject?.init?.properties?.find(
            (property) => property?.key?.name === 'customFields'
        )

        const privateObject = customFieldsObject?.value?.properties?.find(
            (property) => property?.key?.name === 'private'
        )

        const serviceObjectAST = privateObject?.value?.properties?.find(
            (property) =>
                property?.key?.name === `${stringToSnakeCase(apiName)}`
        )
        const serviceInfoArrayAST = serviceObjectAST?.value?.properties?.find(
            (property) => property?.key?.name === 'info'
        )

        if (updateOperation) {
            let customServiceInfo = {}
            serviceInfoArrayAST?.value?.elements?.map((item) => {
                item.properties.map((value) => {
                    if (
                        value.key.name === 'version' &&
                        value.value.value === version
                    ) {
                        customServiceInfo = item
                    }
                })
            })

            const customServiceInfoArrayStringCode = code.substring(
                customServiceInfo.range[0],
                customServiceInfo.range[1]
            )
            const newServiceInfo = generateCustomFieldVersion(version)
            const newServiceInfoStringCode = escodegen.generate(newServiceInfo)
            const updatedCode = code.replace(
                customServiceInfoArrayStringCode,
                newServiceInfoStringCode
            )
            fs.writeFileSync(docusaurusConfigPath, updatedCode, 'utf-8')
        } else {
            const serviceInfoArrayStringCode = code.substring(
                serviceInfoArrayAST.range[0],
                serviceInfoArrayAST.range[1]
            )
            serviceInfoArrayAST.value.elements.push(
                generateCustomFieldVersion(version)
            )
            const newServiceInfoArrayStringCode =
                escodegen.generate(serviceInfoArrayAST)
            const updatedServiceInfoArrayCode = code.replace(
                serviceInfoArrayStringCode,
                newServiceInfoArrayStringCode
            )
            fs.writeFileSync(
                docusaurusConfigPath,
                updatedServiceInfoArrayCode,
                'utf-8'
            )
        }
    } catch (error) {
        console.log(
            `Error in updating version info in custom field in config ${error}`
        )
    }
}

const addPublicDocsRouteToConfig = (serviceAndRouteList) => {
    try {
        const docConfigPath = path.resolve(
            __dirname,
            '../../privateDocs.config.js'
        )

        const code = fs.readFileSync(docConfigPath, 'utf8')

        // Parse the JavaScript code using esprima
        const configAST = esprima.parseModule(code, {
            range: true,
            tokens: true,
            comment: true,
        })

        // Find the config object inside plugins array
        const configVariablesAST = configAST?.body?.filter(
            (value) => value?.type === 'VariableDeclaration'
        )
        let mainConfigObject = {}
        configVariablesAST?.map((variable) => {
            const config = variable?.declarations?.find(
                (item) => item.id.name === 'configObject'
            )
            if (config) {
                mainConfigObject = { ...config }
            }
        })

        const customFieldsObject = mainConfigObject?.init?.properties?.find(
            (property) => property?.key?.name === 'customFields'
        )
        const publicObject = customFieldsObject?.value?.properties?.find(
            (property) => property?.key?.name === 'public'
        )
        const publicObjectStringCode = code.substring(
            publicObject.range[0],
            publicObject.range[1]
        )
        publicObject.value.properties = []
        for ([key, value] of Object.entries(serviceAndRouteList)) {
            publicObject.value.properties.push(
                generatePublicRouteEntry(key.split('_').join(' '), value)
            )
        }
        const updatedStringpublicObjectCode = escodegen.generate(publicObject)
        const updatedpublicObjectCode = code.replace(
            publicObjectStringCode,
            updatedStringpublicObjectCode
        )
        fs.writeFileSync(
            path.resolve(__dirname, '../../temp/privateDocs.config.js'),
            updatedpublicObjectCode,
            'utf-8'
        )
    } catch (err) {
        console.log(err)
    }
}

const pushFilesToBitbucket = async (
    serviceName,
    oldFileNameList,
    serviceVersion,
    privateDoc = true
) => {
    try {
        // list all the filepaths which will be commited to the bitbucket
        const filePathList = []
        handleNestedDirsForFormData(
            path.resolve(__dirname, '../../temp'),
            filePathList
        )

        if (privateDoc) {
            filePathList.push(
                path.resolve(
                    __dirname,
                    `../../api/${stringToKebabCase(serviceName)}-${serviceVersion}.json`
                )
            )
        }

        // To get the relative file path of newly added documentation files.
        const newFilesRelativePathList = filePathList?.map((filePath) => {
            const rootDirName = path.dirname(
                path.resolve(__dirname, '../../temp/docs')
            )
            if (filePath?.includes(rootDirName)) {
                return filePath.split(rootDirName)[1]?.replaceAll('\\', '/')
            } else {
                const apiDirName = path.dirname(
                    path.resolve(__dirname, '../../api')
                )
                return filePath.split(apiDirName)[1]?.replaceAll('\\', '/')
            }
        })

        // To filter out the files which have been removed if a documentation update is happening
        const filesToDelete = oldFileNameList?.filter(
            (path) =>
                !newFilesRelativePathList?.includes(() => {
                    const rootDirName = path.dirname(
                        path.resolve(__dirname, '../')
                    )
                    return filePath.split(rootDirName)[1]?.replaceAll('\\', '/')
                })
        )

        // To push the large amount of files to bitbucket we break the array
        // Maximum number of files allowed in single commit for bitbucket is 99, to be on safe side it's kept at 95
        const MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT = 95
        const maximumCommitNumber = Math.floor(
            filePathList?.length / MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT
        )

        // Generate branch name for new branch
        const newBranchName = `${serviceName ? serviceName : 'access-update'}-${short.generate()}`
        for (i = 0; i <= maximumCommitNumber; i++) {
            const body = new FormData()

            // Map all files inside temp folder to the original docs directory
            const startPoint = i * MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT
            const endPoint =
                i * MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT +
                MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT
            filePathList?.slice(startPoint, endPoint)?.forEach((filePath) => {
                const rootDirName = path.dirname(
                    path.resolve(__dirname, '../../temp/docs')
                )
                if (filePath?.includes(rootDirName)) {
                    const relativeFilePath = filePath
                        .split(rootDirName)[1]
                        ?.replaceAll('\\', '/')
                    const fileStream = fs.createReadStream(filePath)
                    body.append(relativeFilePath, fileStream)
                } else {
                    const apiDirName = path.dirname(
                        path.resolve(__dirname, '../../api')
                    )
                    const relativeFilePath = filePath
                        .split(apiDirName)[1]
                        ?.replaceAll('\\', '/')
                    const fileStream = fs.createReadStream(filePath)
                    body.append(relativeFilePath, fileStream)
                }
            })

            // Write all the old filepaths, so it will get deleted if there is no mapping of file in formData with the given path
            if (i === 0 && filesToDelete?.length > 0) {
                filesToDelete?.map((filePath) => {
                    const rootDirName = path.dirname(
                        path.resolve(__dirname, '../')
                    )
                    const relativeFilePath = filePath
                        .split(rootDirName)[1]
                        ?.replaceAll('\\', '/')
                    body.append('files', relativeFilePath)
                })
            }

            // to push the required changes to bitbucket
            const data = await updateFilesToBitbucketRepo({
                repoSlug: config.server.BITBUCKET_REPO,
                workspace: config.server.BITBUCKET_WORKSPACE,
                body: body,
                branch: newBranchName,
                ...(i === 0 && {
                    parents: config.server.BITBUCKET_PARENT_BRANCH,
                }),
            })
        }

        const response = await createPullRequestOnBitbucket(
            newBranchName,
            config.server.BITBUCKET_PARENT_BRANCH
        )
    } catch (error) {
        console.log(error, 'Error in pushing code to bitbucket')
    }
}

const pushContentDocsToBitbucketAndCreatePR = async (
    bucket_object_name,
    extraction_folder_name,
    content_folder_name,
    oldFileNameList = []
) => {
    try {
        // list all the filepaths which will be commited to the bitbucket
        const filePathList = []
        handleNestedDirsForFormData(
            path.resolve(__dirname, `../../temp/${extraction_folder_name}`),
            filePathList
        )

        // To get the relative file path of newly added documentation files.
        const newFilesRelativePathList = filePathList?.map((filePath) => {
            const rootDirName = path.dirname(
                path.resolve(__dirname, `../../temp/${content_folder_name}`)
            )
            if (filePath?.includes(rootDirName)) {
                const relativeFilePath = filePath.split(rootDirName)[1]
                const splitCharacter = relativeFilePath?.includes('/')
                    ? '/'
                    : '\\'
                const splittedArray = relativeFilePath.split(splitCharacter)
                splittedArray[2] = bucket_object_name
                return splittedArray.join(splitCharacter)?.replaceAll('\\', '/')
            }
        })

        // To filter out the files which have been removed if a documentation update is happening
        const filesToDelete = oldFileNameList?.filter(
            (path) =>
                !newFilesRelativePathList?.includes(() => {
                    const rootDirName = path.dirname(
                        path.resolve(__dirname, '../')
                    )
                    return filePath.split(rootDirName)[1]?.replaceAll('\\', '/')
                })
        )

        // To push the large amount of files to bitbucket we break the array
        // Maximum number of files allowed in single commit for bitbucket is 99, to be on safe side it's kept at 95
        const MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT = 95
        const maximumCommitNumber = Math.floor(
            filePathList?.length / MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT
        )

        // Generate branch name for new branch
        const newBranchName = `Content-Sync-${bucket_object_name}-${short.generate()}`

        for (i = 0; i <= maximumCommitNumber; i++) {
            const startPoint = i * MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT
            const endPoint =
                i * MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT +
                MAXIMUM_FILE_NUMBER_ALLOWED_FOR_COMMIT

            const body = new FormData()

            // Map all files inside temp folder to the original contents directory
            filePathList?.slice(startPoint, endPoint)?.forEach((filePath) => {
                const rootDirName = path.dirname(
                    path.resolve(__dirname, `../../temp/${content_folder_name}`)
                )
                if (filePath?.includes(rootDirName)) {
                    const relativeFilePath = filePath.split(rootDirName)[1]
                    const splitCharacter = relativeFilePath?.includes('/')
                        ? '/'
                        : '\\'
                    const splittedArray = relativeFilePath.split(splitCharacter)
                    splittedArray[2] = bucket_object_name
                    const finalPath = splittedArray
                        .join(splitCharacter)
                        ?.replaceAll('\\', '/')
                    const fileStream = fs.createReadStream(filePath)
                    body.append(finalPath, fileStream)
                }
            })

            // Write all the old filepaths, so it will get deleted if there is no mapping of file in formData with the given path
            if (i === 0 && filesToDelete?.length > 0) {
                filesToDelete?.map((filePath) => {
                    const rootDirName = path.dirname(
                        path.resolve(__dirname, '../')
                    )
                    const relativeFilePath = filePath
                        .split(rootDirName)[1]
                        ?.replaceAll('\\', '/')
                    body.append('files', relativeFilePath)
                })
            }

            // to push the required changes to bitbucket
            const data = await updateFilesToBitbucketRepo({
                repoSlug: config.server.BITBUCKET_REPO,
                workspace: config.server.BITBUCKET_WORKSPACE,
                body: body,
                branch: newBranchName,
                ...(i === 0 && {
                    parents: config.server.BITBUCKET_PARENT_BRANCH,
                }),
            })
        }

        const response = await createPullRequestOnBitbucket(
            newBranchName,
            config.server.BITBUCKET_PARENT_BRANCH
        )
    } catch (error) {
        console.log(error, 'Error in pushing code to bitbucket')
    }
}

const replaceStringInDirectoryForContent = (
    directoryPath,
    originalString,
    substituteString
) => {
    fs.readdir(directoryPath, { encoding: 'utf-8' }, (err, files) => {
        if (err) {
            console.log(`Error in replacing <br> tag: ${err}`)
            return
        }
        files.forEach((file) => {
            const filePath = path.join(directoryPath, file)
            if (fs.statSync(filePath).isDirectory()) {
                // Recursively read nested directories
                replaceStringInDirectoryForContent(filePath, '<br>', '<br/>')
            } else {
                const fileCode = fs.readFileSync(filePath, 'utf-8')
                const updatedFileCode = fileCode?.replaceAll(
                    originalString,
                    substituteString
                )
                fs.writeFileSync(filePath, updatedFileCode, 'utf-8')
            }
        })
    })
}

const handleNestedDirsForFormData = (dirPath, filePathList) => {
    try {
        const files = fs.readdirSync(dirPath)
        files.forEach((file) => {
            // Construct the full path of the file
            const filePath = path.join(dirPath, file)

            // Check if the file is a directory
            if (fs.statSync(filePath).isDirectory()) {
                // Recursively read nested directories
                handleNestedDirsForFormData(filePath, filePathList)
            } else {
                filePathList?.push(filePath)
            }
        })
    } catch (error) {
        console.log('Service is not documented')
    }
}

const updateServiceDocumentation = async (serviceName, version) => {
    try {
        fs.copyFileSync(
            path.resolve(__dirname, '../../privateDocs.config.js'),
            path.resolve(__dirname, '../../temp/privateDocs.config.js')
        )
        fs.copyFileSync(
            path.resolve(__dirname, '../../privateSidebars.js'),
            path.resolve(__dirname, '../../temp/privateSidebars.js')
        )
        await execAsync(
            `npm run clean-private-api-docs:version ${stringToSnakeCase(serviceName)}:${version}`,
            { cwd: path.resolve(__dirname, '../../') }
        )
        await execAsync(
            `npm run gen-private-api-docs:version ${stringToSnakeCase(serviceName)}:${version}`,
            { cwd: path.resolve(__dirname, '../../') }
        )
        replaceStringInDirectory(
            path.resolve(
                __dirname,
                `../../temp/docs/${stringToKebabCase(serviceName)}/${version}`
            ),
            '<br>',
            '<br/>'
        )
        const updatedRouteList = addPrivateDocsRouteToConfig(
            serviceName,
            version,
            true
        )
        handleAccessOnNewVersion(serviceName, updatedRouteList, version, true)
        return Promise.resolve()
    } catch (e) {
        console.error('Error updating documentation:', e)
        return Promise.reject(e)
    }
}

const createTempDir = () => {
    try {
        const tempFolderPath = path.resolve(__dirname, '../../temp')
        const docsFolderPath = path.resolve(__dirname, '../../temp/docs')
        if (!fs.existsSync(tempFolderPath)) {
            fs.mkdirSync(tempFolderPath, { recursive: true })
        }
        if (!fs.existsSync(docsFolderPath)) {
            fs.mkdirSync(docsFolderPath, { recursive: true })
        }
    } catch (e) {
        console.log(`Error in making Temp docs dir ${e}`)
    }
}

const createContentTempDir = (dir_name) => {
    try {
        const tempFolderPath = path.resolve(__dirname, `../../${dir_name}`)
        if (!fs.existsSync(tempFolderPath)) {
            fs.mkdirSync(tempFolderPath, { recursive: true })
        }
        return tempFolderPath
    } catch (e) {
        console.log(`Error in making Temp content dir ${e}`)
    }
}

const deleteTempDir = () => {
    try {
        const tempFolderPath = path.resolve(__dirname, '../../temp')
        fs.rmSync(tempFolderPath, { recursive: true })
        console.log('Temp directory deleted successfully!')
    } catch (error) {
        console.log(`Error in deleting Temp docs dir ${error}`)
    }
}

const updateVersionSidebarFile = (
    sidebarConfigPath,
    apiName,
    docType,
    version,
    generateImport
) => {
    // This function checks if the service is listed, if the service is listed then it checks if provided version is listed, if not then it creates new entry(service and version accordingly)
    try {
        const sideBarFileCode = fs.readFileSync(sidebarConfigPath, 'utf-8')

        const sidebarAST = esprima.parseModule(sideBarFileCode, {
            range: true,
            tokens: true,
            comment: true,
        })
        let currentSidebarFile
        if (docType === 'public-docs') {
            currentSidebarFile = requireUncached(
                path.resolve(__dirname, '../../publicSidebars.js')
            )
        } else {
            currentSidebarFile = requireUncached(sidebarConfigPath)
        }
        if (
            generateImport === undefined &&
            !Object.keys(currentSidebarFile)?.find((item) =>
                item?.includes(stringToKebabCase(apiName))
            )
        ) {
            sidebarAST.body.unshift(generateVersionImport(apiName, docType))
        } else if (generateImport) {
            sidebarAST.body.unshift(generateVersionImport(apiName, docType))
        }
        const sidebarVariablesArrayAST = sidebarAST?.body?.filter(
            (value) => value?.type === 'VariableDeclaration'
        )

        let mainSidebarObject = {}
        sidebarVariablesArrayAST?.map((node) => {
            const sidebar = node?.declarations?.find(
                (item) => item.id.name === 'sidebars'
            )
            if (sidebar) {
                mainSidebarObject = sidebar
            }
        })
        mainSidebarObject?.init?.properties.push(
            generateVersionedServiceSidebar(apiName, version, docType)
        )

        const updatedSidebarString = escodegen.generate(sidebarAST)
        const sidebarFilePath =
            docType === 'public-docs'
                ? path.resolve(__dirname, '../../temp/publicSidebars.js')
                : path.resolve(__dirname, '../../temp/privateSidebars.js')
        fs.writeFileSync(sidebarFilePath, updatedSidebarString, 'utf-8')
    } catch (error) {
        console.log(`Error in updating sidebars.js file: ${error}`)
    }
}

const addVersionsFileInServiceDir = (service_name) => {
    try {
        const serviceFolderPath = path.resolve(
            __dirname,
            `../../temp/docs/${stringToKebabCase(service_name)}`
        )
        const versionFilePath = path.resolve(
            __dirname,
            `../../temp/docs/${stringToKebabCase(service_name)}/versions.json`
        )
        if (!fs.existsSync(serviceFolderPath)) {
            fs.mkdirSync(serviceFolderPath, { recursive: true })
        }
        if (!fs.existsSync(versionFilePath)) {
            fs.writeFileSync(versionFilePath, '', 'utf-8')
        }
    } catch (error) {
        console.log(`error in making versions.json file - ${error}`)
    }
}

const getServiceListAndVersions = () => {
    const configFile = requireUncached(
        path.resolve(__dirname, '../../privateDocs.config.js')
    )
    let data = {}
    for (const [key, value] of Object.entries(
        configFile.customFields.private
    )) {
        data[key] = value.info
    }
    return data
}

const addServiceAndVersionListForPublicDocs = (
    docusaurusConfigPath,
    serviceAndVersionList = {}
) => {
    try {
        const code = fs.readFileSync(docusaurusConfigPath, 'utf8')

        // Parse the JavaScript code using esprima
        const configAST = esprima.parseModule(code, {
            range: true,
            tokens: true,
            comment: true,
        })

        // Find the config object inside plugins array
        const configVariablesAST = configAST?.body?.filter(
            (value) => value?.type === 'VariableDeclaration'
        )
        let mainConfigObject = {}
        configVariablesAST?.map((variable) => {
            const config = variable?.declarations?.find(
                (item) => item.id.name === 'configObject'
            )
            if (config) {
                mainConfigObject = { ...config }
            }
        })

        const customFieldsObject = mainConfigObject?.init?.properties?.find(
            (property) => property?.key?.name === 'customFields'
        )
        const publicObjectAST = customFieldsObject.value.properties.find(
            (property) => property?.key?.name === 'public'
        )
        const publicObjectStringCode = code.substring(
            publicObjectAST.range[0],
            publicObjectAST.range[1]
        )
        publicObjectAST.value.properties = []
        for ([service, version] of Object.entries(serviceAndVersionList)) {
            publicObjectAST.value.properties.push(
                generatePublicServiceAndVersionList(service, version)
            )
        }
        const newPublicObjectStringCode = escodegen.generate(publicObjectAST)
        const updatedPublicObject = code.replace(
            publicObjectStringCode,
            newPublicObjectStringCode
        )
        fs.writeFileSync(docusaurusConfigPath, updatedPublicObject, 'utf-8')
    } catch (error) {
        console.log(`Error in adding public versions ${error}`)
    }
}

const handleAccessOnNewVersion = (
    apiName,
    updatedRouteList,
    version,
    updateVersion = false
) => {
    const privateConfigPath = path.resolve(
        __dirname,
        '../../privateDocs.config.js'
    )
    const privateDocsConfig = requireUncached(privateConfigPath)
    // Check if service is new, only update public docs configs if the service access update has been changed(old service)
    const currentServiceList = Object.keys(
        privateDocsConfig?.plugins[0][1]?.config
    )
    if (currentServiceList?.includes(stringToSnakeCase(apiName))) {
        const publicConfigPath = path.resolve(
            __dirname,
            '../../publicDocs.config.js'
        )
        const publicDocsConfig = requireUncached(publicConfigPath)
        const existingExcludeEntries =
            publicDocsConfig?.presets[0][1]?.docs?.exclude
        const existingAllServiceVersions =
            publicDocsConfig?.customFields?.public
        const tempPublicConfigPath = path.resolve(
            __dirname,
            '../../temp/publicDocs.config.js'
        )
        const publicSidebarPath = path.resolve(
            __dirname,
            '../../publicSidebars.js'
        )
        const tempPublicSidebarPath = path.resolve(
            __dirname,
            '../../temp/publicSidebars.js'
        )
        const existingServiceVersions =
            existingAllServiceVersions[stringToSnakeCase(apiName)]
        const filteredServiceVersion = existingServiceVersions?.filter(
            (item) => item !== version
        )
        fs.copyFileSync(publicConfigPath, tempPublicConfigPath)
        fs.copyFileSync(publicSidebarPath, tempPublicSidebarPath)
        const allowedRoutes =
            privateDocsConfig.customFields.public[stringToSnakeCase(apiName)]
        // Filter out not allowed routes
        const serviceRouteList = {
            [stringToSnakeCase(apiName)]: {
                routes: updatedRouteList,
            },
        }
        const serviceNameAndRoutes = filterRoutes(serviceRouteList, {
            [stringToSnakeCase(apiName)]: allowedRoutes,
        })
        // Get the filenames to be removed and check if version is okay to add to public docs
        const { excludeEntries, serviceVersionsToAdd } = findRoutesAndVersions(
            serviceNameAndRoutes,
            false,
            true
        )
        if (updateVersion) {
            const filteredExcludeEntries = existingExcludeEntries?.filter(
                (item) =>
                    !item?.startsWith(
                        `${stringToKebabCase(apiName)}/${version}`
                    )
            )
            updateExcludeEntryInConfig(tempPublicConfigPath, [
                ...filteredExcludeEntries,
                ...excludeEntries,
            ])
            addServiceAndVersionListForPublicDocs(tempPublicConfigPath, {
                ...existingAllServiceVersions,
                [stringToSnakeCase(apiName)]: filteredServiceVersion,
            })
            removeVersionedSidebarEntry(tempPublicSidebarPath, apiName, version)
        } else {
            updateExcludeEntryInConfig(tempPublicConfigPath, [
                ...existingExcludeEntries,
                ...excludeEntries,
            ])
        }
        if (
            serviceVersionsToAdd[stringToSnakeCase(apiName)]?.includes(version)
        ) {
            updateConfigFile(
                tempPublicConfigPath,
                apiName,
                'public-docs',
                version
            )
            updateVersionSidebarFile(
                tempPublicSidebarPath,
                apiName,
                'public-docs',
                version,
                false
            )
            addServiceAndVersionListForPublicDocs(tempPublicConfigPath, {
                ...existingAllServiceVersions,
                [stringToSnakeCase(apiName)]: [
                    ...filteredServiceVersion,
                    ...serviceVersionsToAdd[stringToSnakeCase(apiName)],
                ],
            })
        }
    }
}

const removeVersionedSidebarEntry = (sidebarConfigPath, apiName, version) => {
    try {
        const sideBarFileCode = fs.readFileSync(sidebarConfigPath, 'utf-8')

        const sidebarAST = esprima.parseModule(sideBarFileCode, {
            range: true,
            tokens: true,
            comment: true,
        })
        const sidebarVariablesArrayAST = sidebarAST?.body?.filter(
            (value) => value?.type === 'VariableDeclaration'
        )

        let mainSidebarObject = {}
        sidebarVariablesArrayAST?.map((node) => {
            const sidebar = node?.declarations?.find(
                (item) => item.id.name === 'sidebars'
            )
            if (sidebar) {
                mainSidebarObject = sidebar
            }
        })
        const mainSidebarObjectStringCode = sideBarFileCode.substring(
            mainSidebarObject.range[0],
            mainSidebarObject.range[1]
        )
        const newEntries = mainSidebarObject?.init?.properties?.filter(
            (item) =>
                item?.key?.value !== `${stringToKebabCase(apiName)}-${version}`
        )
        mainSidebarObject.init.properties = newEntries
        const updatedSidebarObjectStringCode =
            escodegen.generate(mainSidebarObject)
        const updatedSidebarObjectCode = sideBarFileCode.replace(
            mainSidebarObjectStringCode,
            updatedSidebarObjectStringCode
        )
        fs.writeFileSync(sidebarConfigPath, updatedSidebarObjectCode, 'utf-8')
    } catch (error) {
        console.log(`Error in updating sidebars.js file: ${error}`)
    }
}

module.exports = {
    createDocument,
    updateExcludeEntryInConfig,
    updateConfigFile,
    replaceStringInDirectory,
    addPublicDocsRouteToConfig,
    pushFilesToBitbucket,
    handleNestedDirsForFormData,
    updateServiceDocumentation,
    createTempDir,
    createContentTempDir,
    deleteTempDir,
    updateVersionSidebarFile,
    addVersionsFileInServiceDir,
    getServiceListAndVersions,
    findRoutesAndVersions,
    replaceStringInDirectoryForContent,
    addServiceAndVersionListForPublicDocs,
    pushContentDocsToBitbucketAndCreatePR,
}
