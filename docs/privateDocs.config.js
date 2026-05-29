// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const lightCodeTheme = require('prism-react-renderer/themes/github')
const darkCodeTheme = require('prism-react-renderer/themes/dracula')
const config = require('./config.json')

const basePrivateDocsUrl = config.server.private_docs_mount_url
    ? `/${config.server.private_docs_mount_url}/`
    : '/private_docs/'
const socialPreviewImageUrl =
    'https://onemg.gumlet.io/staging/2fdb0975-8f51-4fd1-bd7d-6375d793f581.svg'

/** @type {import('@docusaurus/types').Config} */
const configObject = {
    title: 'Catalyst Documentation',
    tagline:
        'A highly composable framework that provides great performance out of the box',
    url: `${config.docs.private_docs_site_url}`,
    baseUrl: basePrivateDocsUrl,
    onBrokenLinks: 'throw',
    onBrokenMarkdownLinks: 'warn',
    favicon: 'img/favicon.ico',
    headTags: [
        {
            tagName: 'meta',
            attributes: {
                property: 'og:image',
                content: socialPreviewImageUrl,
            },
        },
        {
            tagName: 'meta',
            attributes: {
                property: 'og:image:secure_url',
                content: socialPreviewImageUrl,
            },
        },
        {
            tagName: 'meta',
            attributes: {
                property: 'og:image:type',
                content: 'image/svg+xml',
            },
        },
        {
            tagName: 'meta',
            attributes: {
                name: 'twitter:card',
                content: 'summary_large_image',
            },
        },
        {
            tagName: 'meta',
            attributes: {
                name: 'twitter:image',
                content: socialPreviewImageUrl,
            },
        },
    ],

    // GitHub pages deployment config.
    // If you aren't using GitHub pages, you don't need these.
    organizationName: 'TATA1mg', // Usually your GitHub org/user name.
    projectName: 'merchant-documentation', // Usually your repo name.
    scripts: [
        {
            src: 'js/config.js',
            async: true,
        },
        {
            src: 'js/authScript.js',
            async: true,
        },
    ],

    presets: [
        [
            'classic',
            /** @type {import('@docusaurus/preset-classic').Options} */
            ({
                docs: {
                    path: 'content',
                    routeBasePath: 'content',
                    sidebarPath: require.resolve('./privateSidebars.js'),
                    // Please change this to your repo.
                    // Remove this to remove the "edit this page" links.
                    docLayoutComponent: '@theme/DocPage',
                    docItemComponent: '@theme/DocItem',
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
                    ...(config.docs.show_documentation_button
                        ? [
                              {
                                  to: 'content/Introduction/why-catalyst/',
                                  label: 'Documentation',
                                  position: 'left',
                                  activeBaseRegex: `/content/`,
                              },
                          ]
                        : []),
                    ...(config.docs.show_api_docs_button
                        ? [
                              {
                                  label: 'API Spec',
                                  position: 'left',
                                  to: '/servicelist',
                              },
                          ]
                        : []),
                    {
                        label: 'Onboard API',
                        position: 'left',
                        to: '/create',
                    },
                    {
                        label: 'Manage Permissions',
                        position: 'left',
                        to: '/access',
                    },
                    {
                        label: 'Add Documents',
                        position: 'left',
                        to: '/create-doc',
                    },
                    {
                        label: 'Admin',
                        position: 'left',
                        href: `${config.docs.private_docs_site_url}${basePrivateDocsUrl}admin/`,
                    },
                    {
                        href: 'https://www.npmjs.com/package/catalyst-core',
                        position: 'right',
                        className: 'header-npm-link',
                        'aria-label': 'npm package',
                    },
                    {
                        type: 'html',
                        position: 'right',
                        value: `<button class=\"logout-btn\" onClick='deleteAllCookies()'>Logout</button>`,
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
        require.resolve('@cmfcmf/docusaurus-search-local'),
    ],

    themes: [],
    customFields: {
        private: {},
        public: {},
    },
}

module.exports = configObject
