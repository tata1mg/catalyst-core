import React, { useState } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const ModuleAliasesDemo = () => {
    const [selectedAlias, setSelectedAlias] = useState('containers')
    const [copiedCode, setCopiedCode] = useState('')

    // Copy to clipboard function
    const copyToClipboard = async (text, codeType) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedCode(codeType)
            setTimeout(() => setCopiedCode(''), 2000)
        } catch (err) {
            console.error('Failed to copy: ', err)
        }
    }

    const aliases = {
        containers: {
            without: "import Home from '../../../containers/Home/Home'",
            with: "import Home from '@containers/Home/Home'",
            description: 'Import containers and page components',
        },
        components: {
            without: "import Button from '../../../components/Button/Button'",
            with: "import Button from '@components/Button'",
            description: 'Import reusable UI components',
        },
        store: {
            without: "import store from '../../../store/index.js'",
            with: "import store from '@store'",
            description: 'Import Redux store and actions',
        },
        api: {
            without: "import fetchFunction from '../../../api.js'",
            with: "import fetchFunction from '@api'",
            description: 'Import API utilities and functions',
        },
        config: {
            without: "import config from '../../../config/config.json'",
            with: "import config from '@config/config.json'",
            description: 'Import configuration files',
        },
        css: {
            without:
                "import styles from '../../../static/css/base/styles.scss'",
            with: "import styles from '@css/base/styles.scss'",
            description: 'Import stylesheets and CSS modules',
        },
    }

    // Code examples
    const packageJsonCode = `{
  "_moduleAliases": {
    "@api": "api.js",
    "@containers": "src/js/containers",
    "@components": "src/js/components",
    "@server": "server",
    "@config": "config",
    "@css": "src/static/css",
    "@routes": "src/js/routes/",
    "@store": "src/js/store/index.js"
  }
}`

    const usageExamplesCode = `// Import page components
import Home from '@containers/Home/Home'
import Products from '@containers/Products/Products'

// Import UI components
import Button from '@components/Button'
import Modal from '@components/Modal'

// Import Redux store
import store from '@store'
import { fetchProducts } from '@store/actions'

// Import stylesheets
import styles from '@css/base/styles.scss'
import variables from '@css/resources/_variables.scss'`

    return (
        <div className={styles.moduleAliasesDemo}>
            <div className={styles.demoContent}>
                <h2>Module Aliases</h2>
                <p>
                    This demo shows how to use module aliases in Catalyst to
                    create cleaner and more maintainable import paths.
                </p>

                <div className={styles.benefits}>
                    <h3>Module Alias Benefits</h3>
                    <div className={styles.benefitsGrid}>
                        <div className={styles.benefit}>
                            <h4>🎯 Cleaner Imports</h4>
                            <p>
                                Shorter, more descriptive import paths that are
                                easier to read
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>🔧 Easier Refactoring</h4>
                            <p>
                                Move files around without breaking import paths
                                throughout your codebase
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>⚡ Better DX</h4>
                            <p>
                                Improved developer experience with autocomplete
                                and easier navigation
                            </p>
                        </div>
                    </div>
                </div>

                <div className={styles.aliasSelector}>
                    <h3>Select Alias Type</h3>
                    <div className={styles.aliasButtons}>
                        {Object.keys(aliases).map((alias) => (
                            <button
                                key={alias}
                                onClick={() => setSelectedAlias(alias)}
                                className={
                                    selectedAlias === alias ? styles.active : ''
                                }
                            >
                                @{alias}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.comparisonSection}>
                    <h3>Import Comparison</h3>
                    <div className={styles.comparisonGrid}>
                        <div className={styles.importExample}>
                            <h4>Without Aliases</h4>
                            <div className={styles.codeBlock}>
                                <pre>{aliases[selectedAlias].without}</pre>
                            </div>
                        </div>
                        <div className={styles.arrow}>→</div>
                        <div className={styles.importExample}>
                            <h4>With Aliases</h4>
                            <div className={styles.codeBlock}>
                                <pre>{aliases[selectedAlias].with}</pre>
                            </div>
                        </div>
                    </div>
                    <div className={styles.description}>
                        <p>
                            <strong>Description:</strong>{' '}
                            {aliases[selectedAlias].description}
                        </p>
                    </div>
                </div>

                <div className={styles.configSection}>
                    <h3>Configuration</h3>
                    <p>
                        Add the <code>_moduleAliases</code> key to your{' '}
                        <code>package.json</code> file:
                    </p>
                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>package.json Configuration</h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(
                                        packageJsonCode,
                                        'packageJson'
                                    )
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]:
                                        copiedCode === 'packageJson',
                                })}
                            >
                                {copiedCode === 'packageJson'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{packageJsonCode}</pre>
                    </div>
                </div>

                <div className={styles.usageExamples}>
                    <h3>Common Usage Examples</h3>
                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>Usage Examples</h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(usageExamplesCode, 'usage')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'usage',
                                })}
                            >
                                {copiedCode === 'usage'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{usageExamplesCode}</pre>
                    </div>
                </div>

                <div className={styles.examplesGrid}>
                    <div className={styles.example}>
                        <h4>Containers</h4>
                        <pre>{`// Import page components
import Home from '@containers/Home/Home'
import Products from '@containers/Products/Products'`}</pre>
                    </div>
                    <div className={styles.example}>
                        <h4>Components</h4>
                        <pre>{`// Import UI components
import Button from '@components/Button'
import Modal from '@components/Modal'`}</pre>
                    </div>
                    <div className={styles.example}>
                        <h4>Store</h4>
                        <pre>{`// Import Redux store
import store from '@store'
import { fetchProducts } from '@store/actions'`}</pre>
                    </div>
                    <div className={styles.example}>
                        <h4>Styles</h4>
                        <pre>{`// Import stylesheets
import styles from '@css/base/styles.scss'
import variables from '@css/resources/_variables.scss'`}</pre>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default ModuleAliasesDemo
