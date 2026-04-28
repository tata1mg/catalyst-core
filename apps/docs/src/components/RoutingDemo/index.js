import React, { useState } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const RoutingDemo = () => {
    const [currentRoute, setCurrentRoute] = useState('home')
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

    // Code examples
    const routesCode = `const routes = [
  {
    path: "/",
    index: true,
    component: "HomePage",
  },
  {
    path: "/products",
    component: "Products",
  },
  {
    path: "/user/:id",
    component: "UserPage",
  },
  {
    path: "/about",
    component: "About",
  },
]`

    const routeConfigCode = `// src/js/routes/index.js
import { createBrowserRouter } from '@tata1mg/router'
import HomePage from '../pages/Home'
import About from '../pages/About'
import Products from '../pages/Products'
import UserPage from '../pages/User'

const routes = [
  {
    path: "/",
    index: true,
    element: <HomePage />
  },
  {
    path: "/products",
    element: <Products />
  },
  {
    path: "/user/:id",
    element: <UserPage />
  },
  {
    path: "/about",
    element: <About />
  }
]

export default routes`

    const [routeParams, setRouteParams] = useState({})

    const routes = [
        {
            path: '/',
            index: true,
            component: 'HomePage',
        },
        {
            path: '/products',
            component: 'Products',
        },
        {
            path: '/user/:id',
            component: 'UserPage',
        },
        {
            path: '/about',
            component: 'About',
        },
    ]

    const handleRouteChange = (route) => {
        setCurrentRoute(route)
        if (route === 'user') {
            setRouteParams({ id: '123' })
        } else {
            setRouteParams({})
        }
    }

    return (
        <div className={styles.routingDemo}>
            <div className={styles.demoContent}>
                <h2>Dynamic Routing Examples</h2>
                <p>
                    This example demonstrates Catalyst's routing capabilities
                    including dynamic parameters and navigation.
                </p>

                <div className={styles.routingExample}>
                    <div className={styles.routeNavigation}>
                        <h3>Route Navigation</h3>
                        <div className={styles.navButtons}>
                            <button
                                className={clsx(styles.navBtn, {
                                    [styles.active]: currentRoute === 'home',
                                })}
                                onClick={() => handleRouteChange('home')}
                            >
                                Home
                            </button>
                            <button
                                className={clsx(styles.navBtn, {
                                    [styles.active]: currentRoute === 'about',
                                })}
                                onClick={() => handleRouteChange('about')}
                            >
                                About
                            </button>
                            <button
                                className={clsx(styles.navBtn, {
                                    [styles.active]: currentRoute === 'user',
                                })}
                                onClick={() => handleRouteChange('user')}
                            >
                                User Profile
                            </button>
                            <button
                                className={clsx(styles.navBtn, {
                                    [styles.active]:
                                        currentRoute === 'products',
                                })}
                                onClick={() => handleRouteChange('products')}
                            >
                                Products
                            </button>
                        </div>
                    </div>

                    <div className={styles.routeDisplay}>
                        <h3>Current Route</h3>
                        <div className={styles.routeInfo}>
                            <div className={styles.routePath}>
                                <strong>Path:</strong>{' '}
                                {currentRoute === 'home'
                                    ? '/'
                                    : `/${currentRoute}`}
                            </div>
                            <div className={styles.routeComponent}>
                                <strong>Component:</strong>{' '}
                                {currentRoute === 'home'
                                    ? 'HomePage'
                                    : currentRoute.charAt(0).toUpperCase() +
                                      currentRoute.slice(1) +
                                      (currentRoute === 'user' ? 'Page' : '')}
                            </div>
                            {Object.keys(routeParams).length > 0 && (
                                <div className={styles.routeParams}>
                                    <strong>Parameters:</strong>
                                    <pre>
                                        {JSON.stringify(routeParams, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={styles.routeContent}>
                        <h3>Component Content</h3>
                        <div className={styles.contentSimulation}>
                            {currentRoute === 'home' && (
                                <div
                                    className={clsx(
                                        styles.pageContent,
                                        styles.home
                                    )}
                                >
                                    <h4>Welcome to Home Page</h4>
                                    <p>
                                        This is the main landing page of our
                                        application.
                                    </p>
                                </div>
                            )}
                            {currentRoute === 'about' && (
                                <div
                                    className={clsx(
                                        styles.pageContent,
                                        styles.about
                                    )}
                                >
                                    <h4>About Us</h4>
                                    <p>
                                        Learn more about our company and
                                        mission.
                                    </p>
                                </div>
                            )}
                            {currentRoute === 'user' && (
                                <div
                                    className={clsx(
                                        styles.pageContent,
                                        styles.user
                                    )}
                                >
                                    <h4>User Profile</h4>
                                    <p>
                                        Viewing profile for user ID:{' '}
                                        {routeParams.id}
                                    </p>
                                </div>
                            )}
                            {currentRoute === 'products' && (
                                <div
                                    className={clsx(
                                        styles.pageContent,
                                        styles.products
                                    )}
                                >
                                    <h4>Products Catalog</h4>
                                    <p>Browse our collection of products.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className={styles.codeExample}>
                    <h3>Code Example</h3>
                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>Route Definition (src/js/routes/index.js)</h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(routesCode, 'routes')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'routes',
                                })}
                            >
                                {copiedCode === 'routes'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{routesCode}</pre>
                    </div>

                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>Route Configuration</h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(routeConfigCode, 'config')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'config',
                                })}
                            >
                                {copiedCode === 'config'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{routeConfigCode}</pre>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default RoutingDemo
