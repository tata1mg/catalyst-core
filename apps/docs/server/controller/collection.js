const router = require('express').Router()
const postmanToOpenApi = require('postman-to-openapi')
const path = require('node:path')
const fs = require('node:fs')
const SwaggerParser = require('@apidevtools/swagger-parser')
const multer = require('multer')
const {
    createDocument,
    handleNestedDirsForFormData,
    pushFilesToBitbucket,
    updateServiceDocumentation,
    createTempDir,
    deleteTempDir,
    getServiceListAndVersions,
} = require('../utils/script')
const {
    stringToKebabCase,
    stringToSnakeCase,
    snakeCaseToString,
} = require('../utils/common.js')
const { exec } = require('node:child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const { requireUncached } = require('../utils/constants.js')
const validateRequest = require('../middleware/reqValidator.js')
const {
    apiAuthChecker,
    checkCreateNewDocPermission,
} = require('../middleware/authCheker.js')
const config = require('../config.json')

const storage = multer.diskStorage({
    destination: path.resolve(__dirname, '../collection-files'),
    filename: (req, file, cb) => {
        cb(
            null,
            stringToKebabCase(req?.body?.service_name) +
                path.extname(file.originalname)
        )
    },
})

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5000000,
    },
    fileFilter: (req, file, cb) => {
        if (!file) {
            cb(new Error('Collection file is missing'))
        } else if (file.mimetype.startsWith('application/json')) {
            cb(null, true)
        } else {
            cb(new Error('Only JSON files are allowed'))
        }
    },
})

router.post(
    '/add_collection',
    apiAuthChecker,
    checkCreateNewDocPermission,
    validateRequest,
    async (req, res) => {
        const { service_name: serviceName, data } = req.body
        let service_name = serviceName
        if (serviceName?.includes('_')) {
            service_name = snakeCaseToString(serviceName)
        }
        const fileName = stringToKebabCase(service_name)
        let serviceVersion
        const oldDocsFilePathList = []

        try {
            createTempDir()
            const postmanCollectionData = JSON.parse(data)
            serviceVersion =
                postmanCollectionData?.variable?.find(
                    (item) => item?.key === 'version'
                )?.value ?? '1.0.0'
            const filePath = path.resolve(
                __dirname,
                `../collection-files/${fileName}-${serviceVersion}.json`
            )
            const outputFileUrl = path.resolve(
                __dirname,
                `../../api/${fileName}-${serviceVersion}.json`
            )

            // function to add all the file names in old service to the oldDocsFilePathList array
            handleNestedDirsForFormData(
                path.resolve(
                    __dirname,
                    `../../docs/${fileName}/${serviceVersion}`
                ),
                oldDocsFilePathList
            )
            fs.writeFileSync(filePath, data, 'utf-8')
            await postmanToOpenApi(filePath, outputFileUrl, {
                defaultTag: 'General',
                outputFormat: 'json',
                servers: [
                    {
                        url: 'https://jupiterapi.1mg.com',
                        description: 'Testing Server',
                    },
                    {
                        url: 'https://api.1mg.com',
                        description: 'Production server',
                    },
                ],
            })
            let api = await SwaggerParser.validate(outputFileUrl)
            res.status(201).json({
                is_success: true,
                status_code: 201,
                data: {
                    message: 'Your code upload was successfull',
                    services: getServiceListAndVersions(),
                },
            })
        } catch (error) {
            console.log(
                `Error in converting and validation of collection ${error}`
            )
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: error?.message?.includes(
                    'Swagger schema validation failed'
                )
                    ? 'Swagger schema validation failed'
                    : 'Invalid JSON',
            })
        }

        try {
            const docusaurusConfig = requireUncached(
                '../../privateDocs.config.js'
            )
            const documentedServiceList = Object.keys(
                docusaurusConfig?.plugins[0][1]?.config
            )
            const documentedServiceVersionsList = Object.keys(
                docusaurusConfig?.plugins[0][1]?.config[
                    stringToSnakeCase(service_name)
                ]?.versions ?? {}
            )
            // Check if the docs are alredy present for the service
            if (
                documentedServiceList.includes(
                    stringToSnakeCase(service_name)
                ) &&
                documentedServiceVersionsList?.includes(serviceVersion)
            ) {
                await updateServiceDocumentation(service_name, serviceVersion)
                if (config.server.BUILD_USING_BITBUCKET) {
                    await pushFilesToBitbucket(
                        fileName,
                        oldDocsFilePathList,
                        serviceVersion
                    )
                    deleteTempDir()
                } else {
                    await execAsync('npm run build-private-docs', {
                        cwd: path.resolve(__dirname, '../../'),
                    })
                }
            } else {
                createDocument(service_name, serviceVersion)
            }
        } catch (error) {
            console.log(error)
        }
    }
)

router.post(
    '/add_file',
    apiAuthChecker,
    checkCreateNewDocPermission,
    upload.single('file'),
    async (req, res) => {
        if (!req.body.service_name) {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'service_name is missing in req body',
            })
        }
        if (typeof req.body.service_name !== 'string') {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'service_name should be string',
            })
        }
        const testPattern = /[!@#$%^&*(),.?":{}|<>-]/
        if (testPattern.test(req?.body?.service_name)) {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'service_name should not contain any special character',
            })
        }
        const { service_name: serviceName, data } = req.body
        let service_name = serviceName
        if (serviceName?.includes('_')) {
            service_name = snakeCaseToString(serviceName)
        }
        const fileName = service_name.split(' ').join('-').toLowerCase()
        let serviceVersion
        const oldDocsFilePathList = []
        try {
            createTempDir()
            const filePath = path.resolve(
                __dirname,
                `../collection-files/${fileName}.json`
            )
            const postmanCollectionData = require(filePath)
            serviceVersion =
                postmanCollectionData?.variable?.find(
                    (item) => item?.key === 'version'
                )?.value ?? '1.0.0'
            const outputFileUrl = path.resolve(
                __dirname,
                `../../api/${fileName}-${serviceVersion}.json`
            )
            // function to add all the file names in old service to the oldDocsFilePathList array
            handleNestedDirsForFormData(
                path.resolve(
                    __dirname,
                    `../../docs/${fileName}/${serviceVersion}`
                ),
                oldDocsFilePathList
            )
            await postmanToOpenApi(filePath, outputFileUrl, {
                defaultTag: 'General',
                outputFormat: 'json',
                servers: [
                    {
                        url: 'https://jupiterapi.1mg.com',
                        description: 'Testing Server',
                    },
                    {
                        url: 'https://api.1mg.com',
                        description: 'Production server',
                    },
                ],
            })
            let api = await SwaggerParser.validate(outputFileUrl)
            res.status(201).json({
                is_success: true,
                status_code: 201,
                data: {
                    message: 'Your code upload was successfull',
                    services: getServiceListAndVersions(),
                },
            })
        } catch (error) {
            console.log(
                `Error in converting and validation of collection ${error}`
            )
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: error?.message?.includes(
                    'Swagger schema validation failed'
                )
                    ? 'Swagger schema validation failed'
                    : 'Invalid JSON file',
            })
        }
        try {
            const docusaurusConfig = requireUncached(
                '../../privateDocs.config.js'
            )
            const documentedServiceList = Object.keys(
                docusaurusConfig.plugins[0][1].config
            )
            const documentedServiceVersionsList = Object.keys(
                docusaurusConfig?.plugins[0][1]?.config[
                    stringToSnakeCase(service_name)
                ]?.versions ?? {}
            )
            // Check if the docs are alredy present for the service
            if (
                documentedServiceList.includes(
                    stringToSnakeCase(service_name)
                ) &&
                documentedServiceVersionsList?.includes(serviceVersion)
            ) {
                await updateServiceDocumentation(service_name, serviceVersion)
                if (config.server.BUILD_USING_BITBUCKET) {
                    await pushFilesToBitbucket(
                        fileName,
                        oldDocsFilePathList,
                        serviceVersion
                    )
                    deleteTempDir()
                } else {
                    await execAsync('npm run build-private-docs', {
                        cwd: path.resolve(__dirname, '../../'),
                    })
                }
            } else {
                createDocument(service_name, serviceVersion)
            }
        } catch (error) {
            console.log(error)
        }
    }
)

router.get('/service_list', (req, res) => {
    try {
        return res.status(201).json({
            is_success: true,
            status_code: 200,
            data: getServiceListAndVersions,
        })
    } catch (error) {
        return res
            .status(500)
            .json({ is_success: false, status_code: 500, error: error })
    }
})

router.post('/add_openapi_collection', validateRequest, async (req, res) => {
    let { service_name: serviceName, data } = req.body
    if (typeof data !== 'string') {
        data = JSON.stringify(data)
    }
    let service_name = serviceName
    if (serviceName?.includes('_')) {
        service_name = snakeCaseToString(serviceName)
    }
    const fileName = stringToKebabCase(service_name)
    let serviceVersion
    const oldDocsFilePathList = []
    try {
        createTempDir()
        const openApiCollection = JSON.parse(data)
        serviceVersion = openApiCollection?.info?.version ?? '1.0.0'
        // save here for temporary basis
        const filePath = path.resolve(
            __dirname,
            `../collection-files/${fileName}-${serviceVersion}.json`
        )
        fs.writeFileSync(filePath, data, 'utf-8')
        const outputFileUrl = path.resolve(
            __dirname,
            `../../api/${fileName}-${serviceVersion}.json`
        )
        fs.writeFileSync(outputFileUrl, data, 'utf-8')
        // function to add all the file names in old service to the oldDocsFilePathList array
        handleNestedDirsForFormData(
            path.resolve(__dirname, `../../docs/${fileName}/${serviceVersion}`),
            oldDocsFilePathList
        )
        let api = await SwaggerParser.validate(outputFileUrl)
        res.status(201).json({
            is_success: true,
            status_code: 201,
            data: {
                message: 'Your code upload was successfull',
                services: getServiceListAndVersions(),
            },
        })
    } catch (error) {
        console.log(`Error in validation of collection ${error}`)
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: error?.message?.includes('Swagger schema validation failed')
                ? 'Swagger schema validation failed'
                : 'The JSON is not valid openApi format',
        })
    }
    try {
        const docusaurusConfig = requireUncached('../../privateDocs.config.js')
        const documentedServiceList = Object.keys(
            docusaurusConfig.plugins[0][1].config
        )
        const documentedServiceVersionsList = Object.keys(
            docusaurusConfig?.plugins[0][1]?.config[
                stringToSnakeCase(service_name)
            ]?.versions ?? {}
        )
        // Check if the docs are alredy present for the service
        if (
            documentedServiceList.includes(stringToSnakeCase(service_name)) &&
            documentedServiceVersionsList?.includes(serviceVersion)
        ) {
            await updateServiceDocumentation(service_name, serviceVersion)
            if (config.server.BUILD_USING_BITBUCKET) {
                await pushFilesToBitbucket(
                    fileName,
                    oldDocsFilePathList,
                    serviceVersion
                )
                deleteTempDir()
            } else {
                await execAsync('npm run build-private-docs', {
                    cwd: path.resolve(__dirname, '../../'),
                })
            }
        } else {
            createDocument(service_name, serviceVersion)
        }
    } catch (error) {
        console.log(error)
    }
})

router.post('/add_openapi_file', upload.single('file'), async (req, res) => {
    if (!req.body.service_name) {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'service_name is missing in req body',
        })
    }
    if (typeof req.body.service_name !== 'string') {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'service_name should be string',
        })
    }
    const testPattern = /[!@#$%^&*(),.?":{}|<>-]/
    if (testPattern.test(req?.body?.service_name)) {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'service_name should not contain any special character',
        })
    }
    const { service_name: serviceName, data } = req.body
    let service_name = serviceName
    if (serviceName?.includes('_')) {
        service_name = snakeCaseToString(serviceName)
    }
    const fileName = service_name.split(' ').join('-').toLowerCase()
    let serviceVersion
    const oldDocsFilePathList = []

    try {
        createTempDir()
        const filePath = path.resolve(
            __dirname,
            `../collection-files/${fileName}.json`
        )
        const openApiCollection = require(filePath)
        serviceVersion = openApiCollection?.info?.version ?? '1.0.0'
        const outputFileUrl = path.resolve(
            __dirname,
            `../../api/${fileName}-${serviceVersion}.json`
        )
        // function to add all the file names in old service to the oldDocsFilePathList array
        handleNestedDirsForFormData(
            path.resolve(__dirname, `../../docs/${fileName}/${serviceVersion}`),
            oldDocsFilePathList
        )
        const jsonFileData = fs.readFileSync(filePath, 'utf-8')
        fs.writeFileSync(outputFileUrl, jsonFileData, 'utf-8')
        let api = await SwaggerParser.validate(outputFileUrl)
        res.status(201).json({
            is_success: true,
            status_code: 201,
            data: {
                message: 'Your code upload was successfull',
                services: getServiceListAndVersions(),
            },
        })
    } catch (error) {
        console.log(`Error in validation of collection ${error}`)
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: error?.message?.includes('Swagger schema validation failed')
                ? 'Swagger schema validation failed'
                : 'Invalid JSON file',
        })
    }

    try {
        const docusaurusConfig = requireUncached('../../privateDocs.config.js')
        const documentedServiceList = Object.keys(
            docusaurusConfig.plugins[0][1].config
        )
        const documentedServiceVersionsList = Object.keys(
            docusaurusConfig?.plugins[0][1]?.config[
                stringToSnakeCase(service_name)
            ]?.versions ?? {}
        )
        // Check if the docs are alredy present for the service
        if (
            documentedServiceList.includes(stringToSnakeCase(service_name)) &&
            documentedServiceVersionsList?.includes(serviceVersion)
        ) {
            await updateServiceDocumentation(service_name, serviceVersion)
            if (config.server.BUILD_USING_BITBUCKET) {
                await pushFilesToBitbucket(
                    fileName,
                    oldDocsFilePathList,
                    serviceVersion
                )
                deleteTempDir()
            } else {
                await execAsync('npm run build-private-docs', {
                    cwd: path.resolve(__dirname, '../../'),
                })
            }
        } else {
            createDocument(service_name, serviceVersion)
        }
    } catch (error) {
        console.log(error)
    }
})

router.post(
    '/add_openapi_collection_user',
    apiAuthChecker,
    checkCreateNewDocPermission,
    validateRequest,
    async (req, res) => {
        let { service_name: serviceName, data } = req.body
        if (typeof data !== 'string') {
            data = JSON.stringify(data)
        }
        let service_name = serviceName
        if (serviceName?.includes('_')) {
            service_name = snakeCaseToString(serviceName)
        }
        const fileName = stringToKebabCase(service_name)
        let serviceVersion
        const oldDocsFilePathList = []
        try {
            createTempDir()
            const openApiCollection = JSON.parse(data)
            serviceVersion = openApiCollection?.info?.version ?? '1.0.0'
            // save here for temporary basis
            const filePath = path.resolve(
                __dirname,
                `../collection-files/${fileName}-${serviceVersion}.json`
            )
            fs.writeFileSync(filePath, data, 'utf-8')
            const outputFileUrl = path.resolve(
                __dirname,
                `../../api/${fileName}-${serviceVersion}.json`
            )
            fs.writeFileSync(outputFileUrl, data, 'utf-8')
            // function to add all the file names in old service to the oldDocsFilePathList array
            handleNestedDirsForFormData(
                path.resolve(
                    __dirname,
                    `../../docs/${fileName}/${serviceVersion}`
                ),
                oldDocsFilePathList
            )
            let api = await SwaggerParser.validate(outputFileUrl)
            res.status(201).json({
                is_success: true,
                status_code: 201,
                data: {
                    message: 'Your code upload was successfull',
                    services: getServiceListAndVersions(),
                },
            })
        } catch (error) {
            console.log(`Error in validation of collection ${error}`)
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: error?.message?.includes(
                    'Swagger schema validation failed'
                )
                    ? 'Swagger schema validation failed'
                    : 'The JSON is not valid openApi format',
            })
        }
        try {
            const docusaurusConfig = requireUncached(
                '../../privateDocs.config.js'
            )
            const documentedServiceList = Object.keys(
                docusaurusConfig.plugins[0][1].config
            )
            const documentedServiceVersionsList = Object.keys(
                docusaurusConfig?.plugins[0][1]?.config[
                    stringToSnakeCase(service_name)
                ]?.versions ?? {}
            )
            // Check if the docs are alredy present for the service
            if (
                documentedServiceList.includes(
                    stringToSnakeCase(service_name)
                ) &&
                documentedServiceVersionsList?.includes(serviceVersion)
            ) {
                await updateServiceDocumentation(service_name, serviceVersion)
                if (config.server.BUILD_USING_BITBUCKET) {
                    await pushFilesToBitbucket(
                        fileName,
                        oldDocsFilePathList,
                        serviceVersion
                    )
                    deleteTempDir()
                } else {
                    await execAsync('npm run build-private-docs', {
                        cwd: path.resolve(__dirname, '../../'),
                    })
                }
            } else {
                createDocument(service_name, serviceVersion)
            }
        } catch (error) {
            console.log(error)
        }
    }
)

router.post(
    '/add_openapi_file_user',
    apiAuthChecker,
    checkCreateNewDocPermission,
    upload.single('file'),
    async (req, res) => {
        if (!req.body.service_name) {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'service_name is missing in req body',
            })
        }
        if (typeof req.body.service_name !== 'string') {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'service_name should be string',
            })
        }
        const testPattern = /[!@#$%^&*(),.?":{}|<>-]/
        if (testPattern.test(req?.body?.service_name)) {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'service_name should not contain any special character',
            })
        }
        const { service_name: serviceName, data } = req.body
        let service_name = serviceName
        if (serviceName?.includes('_')) {
            service_name = snakeCaseToString(serviceName)
        }
        const fileName = service_name.split(' ').join('-').toLowerCase()
        let serviceVersion
        const oldDocsFilePathList = []

        try {
            createTempDir()
            const filePath = path.resolve(
                __dirname,
                `../collection-files/${fileName}.json`
            )
            const openApiCollection = require(filePath)
            serviceVersion = openApiCollection?.info?.version ?? '1.0.0'
            const outputFileUrl = path.resolve(
                __dirname,
                `../../api/${fileName}-${serviceVersion}.json`
            )
            // function to add all the file names in old service to the oldDocsFilePathList array
            handleNestedDirsForFormData(
                path.resolve(
                    __dirname,
                    `../../docs/${fileName}/${serviceVersion}`
                ),
                oldDocsFilePathList
            )
            const jsonFileData = fs.readFileSync(filePath, 'utf-8')
            fs.writeFileSync(outputFileUrl, jsonFileData, 'utf-8')
            let api = await SwaggerParser.validate(outputFileUrl)
            res.status(201).json({
                is_success: true,
                status_code: 201,
                data: {
                    message: 'Your code upload was successfull',
                    services: getServiceListAndVersions(),
                },
            })
        } catch (error) {
            console.log(`Error in validation of collection ${error}`)
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: error?.message?.includes(
                    'Swagger schema validation failed'
                )
                    ? 'Swagger schema validation failed'
                    : 'Invalid JSON file',
            })
        }

        try {
            const docusaurusConfig = requireUncached(
                '../../privateDocs.config.js'
            )
            const documentedServiceList = Object.keys(
                docusaurusConfig.plugins[0][1].config
            )
            const documentedServiceVersionsList = Object.keys(
                docusaurusConfig?.plugins[0][1]?.config[
                    stringToSnakeCase(service_name)
                ]?.versions ?? {}
            )
            // Check if the docs are alredy present for the service
            if (
                documentedServiceList.includes(
                    stringToSnakeCase(service_name)
                ) &&
                documentedServiceVersionsList?.includes(serviceVersion)
            ) {
                await updateServiceDocumentation(service_name, serviceVersion)
                if (config.server.BUILD_USING_BITBUCKET) {
                    await pushFilesToBitbucket(
                        fileName,
                        oldDocsFilePathList,
                        serviceVersion
                    )
                    deleteTempDir()
                } else {
                    await execAsync('npm run build-private-docs', {
                        cwd: path.resolve(__dirname, '../../'),
                    })
                }
            } else {
                createDocument(service_name, serviceVersion)
            }
        } catch (error) {
            console.log(error)
        }
    }
)

module.exports = router
