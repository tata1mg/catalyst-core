const path = require('node:path')
const {
    stringToKebabCase,
    stringToSnakeCase,
    kebabCasetoString,
    stringToCamelCase,
    epochTime,
    eachWordCamelCaseFromString,
} = require('./common')
const fs = require('node:fs')

const generateConfigEntry = (serviceName, version, docType) => {
    const apiName = stringToKebabCase(serviceName)
    return {
        type: 'Property',
        key: {
            type: 'Identifier',
            name: `${stringToSnakeCase(serviceName)}`,
        },
        value: {
            type: 'ObjectExpression',
            properties: [
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'specPath',
                    },
                    value: {
                        type: 'Literal',
                        value: `./api/${apiName}-${version}.json`,
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'outputDir',
                    },
                    value: {
                        type: 'Literal',
                        value:
                            docType === 'public-docs'
                                ? `public-docs/docs/${apiName}`
                                : `temp/docs/${apiName}`,
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'sidebarOptions',
                    },
                    value: {
                        type: 'ObjectExpression',
                        properties: [
                            {
                                type: 'Property',
                                key: {
                                    type: 'Identifier',
                                    name: 'groupPathsBy',
                                },
                                value: {
                                    type: 'Literal',
                                    value: 'tag',
                                },
                            },
                            {
                                type: 'Property',
                                key: {
                                    type: 'Identifier',
                                    name: 'categoryLinkSource',
                                },
                                value: {
                                    type: 'Literal',
                                    value: 'tag',
                                },
                            },
                        ],
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'version',
                    },
                    value: {
                        type: 'Literal',
                        value: version,
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'label',
                    },
                    value: {
                        type: 'Literal',
                        value: `v${version}`,
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'baseUrl',
                    },
                    value: {
                        type: 'TemplateLiteral',
                        quasis: [
                            {
                                type: 'TemplateElement',
                                value: {
                                    raw: '',
                                    cooked: '',
                                },
                                tail: false,
                            },
                            {
                                type: 'TemplateElement',
                                value: {
                                    raw: `docs/${apiName}/${version}`,
                                    cooked: `docs/${apiName}/${version}`,
                                },
                                tail: true,
                            },
                        ],
                        expressions: [
                            {
                                type: 'Identifier',
                                name:
                                    docType === 'public-docs'
                                        ? 'basePublicDocsUrl'
                                        : 'basePrivateDocsUrl',
                            },
                        ],
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'versions',
                    },
                    value: {
                        type: 'ObjectExpression',
                        properties: [
                            {
                                type: 'Property',
                                key: {
                                    type: 'Identifier',
                                    name: `"${version}"`,
                                },
                                value: {
                                    type: 'ObjectExpression',
                                    properties: [
                                        {
                                            type: 'Property',
                                            key: {
                                                type: 'Identifier',
                                                name: 'specPath',
                                            },
                                            value: {
                                                type: 'Literal',
                                                value: `./api/${apiName}-${version}.json`,
                                            },
                                        },
                                        {
                                            type: 'Property',
                                            key: {
                                                type: 'Identifier',
                                                name: 'outputDir',
                                            },
                                            value: {
                                                type: 'Literal',
                                                value:
                                                    docType === 'public-docs'
                                                        ? `public-docs/docs/${apiName}/${version}`
                                                        : `temp/docs/${apiName}/${version}`,
                                            },
                                        },
                                        {
                                            type: 'Property',
                                            key: {
                                                type: 'Identifier',
                                                name: 'label',
                                            },
                                            value: {
                                                type: 'Literal',
                                                value: `v${version}`,
                                            },
                                        },
                                        {
                                            type: 'Property',
                                            key: {
                                                type: 'Identifier',
                                                name: 'baseUrl',
                                            },
                                            value: {
                                                type: 'TemplateLiteral',
                                                quasis: [
                                                    {
                                                        type: 'TemplateElement',
                                                        value: {
                                                            raw: '',
                                                            cooked: '',
                                                        },
                                                        tail: false,
                                                    },
                                                    {
                                                        type: 'TemplateElement',
                                                        value: {
                                                            raw: `docs/${apiName}/${version}`,
                                                            cooked: `docs/${apiName}/${version}`,
                                                        },
                                                        tail: true,
                                                    },
                                                ],
                                                expressions: [
                                                    {
                                                        type: 'Identifier',
                                                        name:
                                                            docType ===
                                                            'public-docs'
                                                                ? 'basePublicDocsUrl'
                                                                : 'basePrivateDocsUrl',
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        },
    }
}

const generateSidebarEntry = (serviceName, docType) => {
    const apiName = stringToKebabCase(serviceName)
    return {
        type: 'ObjectExpression',
        properties: [
            {
                type: 'Property',
                key: {
                    type: 'Identifier',
                    name: 'type',
                },
                value: {
                    type: 'Literal',
                    value: 'category',
                },
            },
            {
                type: 'Property',
                key: {
                    type: 'Identifier',
                    name: 'label',
                },
                value: {
                    type: 'Literal',
                    value: `${kebabCasetoString(apiName)} API Docs`,
                },
            },
            {
                type: 'Property',
                key: {
                    type: 'Identifier',
                    name: 'link',
                },
                value: {
                    type: 'ObjectExpression',
                    properties: [
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'type',
                            },
                            value: {
                                type: 'Literal',
                                value: 'generated-index',
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'title',
                            },
                            value: {
                                type: 'Literal',
                                value: `${kebabCasetoString(apiName)} API Docs`,
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'description',
                            },
                            value: {
                                type: 'Literal',
                                value: `This is the documentation for TATA1mg ${kebabCasetoString(apiName)} Integration APIs`,
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'slug',
                            },
                            value: {
                                type: 'Literal',
                                value: `/${apiName}`,
                            },
                        },
                    ],
                },
            },
            {
                type: 'Property',
                key: {
                    type: 'Identifier',
                    name: 'items',
                },
                value: {
                    type: 'CallExpression',
                    callee: {
                        type: 'Identifier',
                        name: 'require',
                    },
                    arguments: [
                        {
                            type: 'Literal',
                            value:
                                docType === 'public-docs'
                                    ? `./public-docs/docs/${apiName}/sidebar.js`
                                    : `./docs/${apiName}/sidebar.js`,
                        },
                    ],
                },
            },
        ],
    }
}

const generateStringEntry = (apiRoute) => {
    return {
        type: 'Literal',
        value: apiRoute,
    }
}

const requireUncached = (path) => {
    delete require.cache[require.resolve(path)]
    return require(path)
}

const generateServiceEntry = (apiName, routeList, version) => {
    const serviceName = stringToSnakeCase(apiName)
    return {
        type: 'Property',
        key: {
            type: 'Identifier',
            name: serviceName,
        },
        value: {
            type: 'ObjectExpression',
            properties: [
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'routes',
                    },
                    value: {
                        type: 'ArrayExpression',
                        elements: routeList.map((route) =>
                            generateStringEntry(route)
                        ),
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'info',
                    },
                    value: {
                        type: 'ArrayExpression',
                        elements: [
                            {
                                type: 'ObjectExpression',
                                properties: [
                                    {
                                        type: 'Property',
                                        key: {
                                            type: 'Identifier',
                                            name: 'version',
                                        },
                                        value: {
                                            type: 'Literal',
                                            value: version,
                                        },
                                    },
                                    {
                                        type: 'Property',
                                        key: {
                                            type: 'Identifier',
                                            name: 'lastUpdated',
                                        },
                                        value: {
                                            type: 'Literal',
                                            value: epochTime(),
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        },
    }
}

const generatePublicRouteEntry = (apiName, routeList) => {
    const serviceName = stringToSnakeCase(apiName)
    return {
        type: 'Property',
        key: {
            type: 'Identifier',
            name: serviceName,
        },
        value: {
            type: 'ArrayExpression',
            elements: routeList.map((route) => generateStringEntry(route)),
        },
    }
}

const userRole = {
    // Random values because these are accessible by user on client side
    ROLE_SUPER_ADMIN: 13,
    ROLE_USER: 1387,
    ROLE_ACCESS_CONTROL: 3645,
    ROLE_CREATE_DOC: 9427,
}

const generateVersionImport = (apiName, docType) => {
    const kebabCaseApiName = stringToKebabCase(apiName)
    return {
        type: 'VariableDeclaration',
        kind: 'const',
        declarations: [
            {
                type: 'VariableDeclarator',
                id: {
                    type: 'Identifier',
                    name: `${stringToCamelCase(apiName)}Versions`,
                },
                init: {
                    type: 'CallExpression',
                    callee: {
                        type: 'Identifier',
                        name: 'require',
                    },
                    arguments: [
                        {
                            type: 'Literal',
                            value:
                                docType === 'public-docs'
                                    ? `./public-docs/docs/${kebabCaseApiName}/versions.json`
                                    : `./docs/${kebabCaseApiName}/versions.json`,
                        },
                    ],
                },
            },
        ],
    }
}

const generateVersionedServiceSidebar = (apiName, version, docType) => {
    const kebabCaseApiName = stringToKebabCase(apiName)
    return {
        type: 'Property',
        key: {
            type: 'Literal',
            value: `${kebabCaseApiName}-${version}`,
            raw: `"${kebabCaseApiName}-${version}"`,
        },
        kind: 'init',
        value: {
            type: 'ArrayExpression',
            elements: [
                {
                    type: 'ObjectExpression',
                    properties: [
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'type',
                            },
                            value: {
                                type: 'Literal',
                                value: 'html',
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'defaultStyle',
                            },
                            value: {
                                type: 'Literal',
                                value: true,
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'value',
                            },
                            value: {
                                type: 'CallExpression',
                                callee: {
                                    type: 'Identifier',
                                    name: 'versionSelector',
                                },
                                arguments: [
                                    {
                                        type: 'Identifier',
                                        name: `${stringToCamelCase(apiName)}Versions`,
                                    },
                                ],
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'className',
                            },
                            value: {
                                type: 'Literal',
                                value: 'version-button',
                            },
                        },
                    ],
                },
                {
                    type: 'ObjectExpression',
                    properties: [
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'type',
                            },
                            value: {
                                type: 'Literal',
                                value: 'html',
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'defaultStyle',
                            },
                            value: {
                                type: 'Literal',
                                value: true,
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'value',
                            },
                            value: {
                                type: 'CallExpression',
                                callee: {
                                    type: 'Identifier',
                                    name: 'versionCrumb',
                                },
                                arguments: [
                                    {
                                        type: 'Identifier',
                                        name: `"v${version}"`,
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    type: 'ObjectExpression',
                    properties: [
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'type',
                            },
                            value: {
                                type: 'Literal',
                                value: 'category',
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'label',
                            },
                            value: {
                                type: 'Literal',
                                value: `${eachWordCamelCaseFromString(apiName)} API Docs`,
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'link',
                            },
                            value: {
                                type: 'ObjectExpression',
                                properties: [
                                    {
                                        type: 'Property',
                                        key: {
                                            type: 'Identifier',
                                            name: 'type',
                                        },
                                        value: {
                                            type: 'Literal',
                                            value: 'generated-index',
                                        },
                                    },
                                    {
                                        type: 'Property',
                                        key: {
                                            type: 'Identifier',
                                            name: 'title',
                                        },
                                        value: {
                                            type: 'Literal',
                                            value: `${eachWordCamelCaseFromString(apiName)} API Docs`,
                                        },
                                    },
                                    {
                                        type: 'Property',
                                        key: {
                                            type: 'Identifier',
                                            name: 'description',
                                        },
                                        value: {
                                            type: 'Literal',
                                            value: `This is the documentation for TATA1mg ${eachWordCamelCaseFromString(apiName)} Integration APIs`,
                                        },
                                    },
                                    {
                                        type: 'Property',
                                        key: {
                                            type: 'Identifier',
                                            name: 'slug',
                                        },
                                        value: {
                                            type: 'Literal',
                                            value: `/${kebabCaseApiName}/${version}`,
                                        },
                                    },
                                ],
                            },
                        },
                        {
                            type: 'Property',
                            key: {
                                type: 'Identifier',
                                name: 'items',
                            },
                            value: {
                                type: 'CallExpression',
                                callee: {
                                    type: 'Identifier',
                                    name: 'require',
                                },
                                arguments: [
                                    {
                                        type: 'Literal',
                                        value:
                                            docType === 'public-docs'
                                                ? `./public-docs/docs/${kebabCaseApiName}/${version}/sidebar.js`
                                                : `./docs/${kebabCaseApiName}/${version}/sidebar.js`,
                                    },
                                ],
                            },
                        },
                    ],
                },
            ],
        },
    }
}

const generateVersionEntryForConfig = (apiName, version, docType) => {
    return {
        type: 'Property',
        key: {
            type: 'Identifier',
            name: `"${version}"`,
        },
        value: {
            type: 'ObjectExpression',
            properties: [
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'specPath',
                    },
                    value: {
                        type: 'Literal',
                        value: `./api/${stringToKebabCase(apiName)}-${version}.json`,
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'outputDir',
                    },
                    value: {
                        type: 'Literal',
                        value: `temp/docs/${stringToKebabCase(apiName)}/${version}`,
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'label',
                    },
                    value: {
                        type: 'Literal',
                        value: `v${version}`,
                    },
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'baseUrl',
                    },
                    value: {
                        type: 'TemplateLiteral',
                        quasis: [
                            {
                                type: 'TemplateElement',
                                value: {
                                    raw: '',
                                    cooked: '',
                                },
                                tail: false,
                            },
                            {
                                type: 'TemplateElement',
                                value: {
                                    raw: `docs/${apiName}/${version}`,
                                    cooked: `docs/${apiName}/${version}`,
                                },
                                tail: true,
                            },
                        ],
                        expressions: [
                            {
                                type: 'Identifier',
                                name:
                                    docType === 'public-docs'
                                        ? 'basePublicDocsUrl'
                                        : 'basePrivateDocsUrl',
                            },
                        ],
                    },
                },
            ],
        },
    }
}

const generateCustomFieldVersion = (version) => {
    return {
        type: 'ObjectExpression',
        properties: [
            {
                type: 'Property',
                key: {
                    type: 'Identifier',
                    name: 'version',
                },
                value: {
                    type: 'Literal',
                    value: version,
                },
            },
            {
                type: 'Property',
                key: {
                    type: 'Identifier',
                    name: 'lastUpdated',
                },
                value: {
                    type: 'Literal',
                    value: epochTime(),
                },
            },
        ],
    }
}

const generateBasicTemplate = (sidebarPath) => {
    const data = `const { versionSelector, versionCrumb } = require("docusaurus-plugin-openapi-docs/lib/sidebars/utils")
    // @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */

const sidebars = {

}

module.exports = sidebars`

    try {
        fs.writeFileSync(sidebarPath, data, 'utf-8')
    } catch (error) {
        console.log(`Error in generating basic template for sidebar ${error}`)
    }
}

const generatePublicServiceAndVersionList = (serviceName, versionList) => {
    return {
        type: 'Property',
        key: {
            type: 'Identifier',
            name: serviceName,
        },
        value: {
            type: 'ArrayExpression',
            elements: versionList.map((version) =>
                generateStringEntry(version)
            ),
        },
    }
}

module.exports = {
    generateConfigEntry,
    generateSidebarEntry,
    generateStringEntry,
    requireUncached,
    generateServiceEntry,
    userRole,
    generateVersionImport,
    generateVersionedServiceSidebar,
    generateVersionEntryForConfig,
    generateCustomFieldVersion,
    generateBasicTemplate,
    generatePublicRouteEntry,
    generatePublicServiceAndVersionList,
}
