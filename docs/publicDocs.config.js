// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const lightCodeTheme = require('prism-react-renderer/themes/github')
const darkCodeTheme = require('prism-react-renderer/themes/dracula')
const config = require('./config.json')

const basePublicDocsUrl = config.server.public_docs_mount_url
    ? `/${config.server.public_docs_mount_url}/`
    : '/'

/** @type {import('@docusaurus/types').Config} */
const configObject = {
    title: 'Catalyst Documentation',
    tagline:
        'A highly composable framework that provides great performance out of the box',
    url: `${config.docs.public_docs_site_url}`,
    baseUrl: basePublicDocsUrl,
    onBrokenLinks: 'warn',
    onBrokenMarkdownLinks: 'warn',
    favicon: 'img/favicon.ico',

    // GitHub pages deployment config.
    // If you aren't using GitHub pages, you don't need these.
    organizationName: 'TATA1mg', // Usually your GitHub org/user name.
    projectName: 'merchant-documentation', // Usually your repo name.

    presets: [
        [
            'classic',
            /** @type {import('@docusaurus/preset-classic').Options} */
            ({
                docs: {
                    path: 'public-docs/docs',
                    sidebarPath: require.resolve('./publicSidebars.js'),
                    // Please change this to your repo.
                    // Remove this to remove the "edit this page" links.
                    docLayoutComponent: '@theme/DocPage',
                    docItemComponent: '@theme/ApiItem', // Derived from docusaurus-theme-openapi
                    exclude: [],
                },
                pages: {
                    exclude: ['access.js', 'create.js', 'create-doc.js'],
                },
                theme: {
                    customCss: require.resolve('./src/css/custom.css'),
                },
            }),
        ],
    ],

    themeConfig:
        /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
        ({
            docs: {
                sidebar: {
                    hideable: true,
                },
            },
            colorMode: {
                defaultMode: 'dark',
                disableSwitch: false,
            },
            navbar: {
                title: 'Catalyst',
                logo: {
                    alt: 'catalyst logo',
                    src: 'img/logo-light.svg',
                    srcDark: 'img/logo-dark.svg',
                },
                items: [
                    {
                        type: 'search',
                        position: 'left',
                    },
                    {
                        to: 'content/Introduction/why-catalyst/',
                        label: 'Documentation',
                        position: 'left',
                        activeBaseRegex: `/content/`,
                    },
                    {
                        to: '/#features',
                        label: 'Features',
                        position: 'left',
                    },
                    {
                        label: 'Community',
                        position: 'left',
                        items: [
                            {
                                label: 'Conferences',
                                to: '/content/conferences',
                            },
                            {
                                label: 'Discord',
                                href: 'https://discord.gg/GTzYzP8X6s',
                            },
                            {
                                label: 'X (formerly Twitter)',
                                href: 'https://x.com/Catalyst448356',
                            },
                            {
                                label: 'GitHub Community',
                                href: 'https://github.com/tata1mg/catalyst-core/discussions',
                            },
                        ],
                    },
                    {
                        label: 'Contribute',
                        position: 'left',
                        to: '/content/contribution',
                    },
                    {
                        href: 'https://github.com/tata1mg/catalyst-core',
                        position: 'right',
                        className: 'header-github-link',
                        'aria-label': 'GitHub repository',
                    },
                ],
            },
            prism: {
                theme: lightCodeTheme,
                darkTheme: darkCodeTheme,
                additionalLanguages: ['ruby', 'csharp', 'php'],
            },
        }),

    plugins: [
        [
            'docusaurus-plugin-openapi-docs',
            {
                id: 'openapi',
                docsPluginId: 'classic',
                config: {},
            },
        ],
        [
            '@docusaurus/plugin-content-docs',
            {
                id: 'tutorialSidebar',
                path: 'content',
                routeBasePath: 'content',
            },
        ],
        require.resolve('@cmfcmf/docusaurus-search-local'),
    ],

    themes: ['docusaurus-theme-openapi-docs'],
    customFields: {
        public: {},
    },
}

module.exports = configObject
