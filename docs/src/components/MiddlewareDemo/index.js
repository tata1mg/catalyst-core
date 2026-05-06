import React, { useState } from 'react'
import CopyButton from '../CopyButton'
import '../CopyButton/styles.css'
import './styles.css'

const middlewares = {
    logging: {
        name: 'Request Logging',
        description: 'Log all incoming requests for debugging and monitoring.',
        code: `app.use((req, res, next) => {\n  console.log(\`${'${req.method} ${req.url} - ${new Date().toISOString()}'}\`)\n  next()\n})`,
        benefits: ['Debug requests', 'Monitor performance', 'Track errors'],
    },
    cors: {
        name: 'CORS',
        description: 'Handle Cross-Origin Resource Sharing for API endpoints.',
        code: `app.use(cors({\n  origin: ['http://localhost:3000', 'https://yourdomain.com'],\n  credentials: true\n}))`,
        benefits: ['Cross-origin requests', 'Security control', 'API access'],
    },
    compression: {
        name: 'Compression',
        description: 'Compress response bodies for better performance.',
        code: `app.use(compression({\n  level: 6,\n  threshold: 1024\n}))`,
        benefits: ['Reduced bandwidth', 'Faster loading', 'Better UX'],
    },
    rateLimit: {
        name: 'Rate Limiting',
        description: 'Limit requests per IP to prevent abuse.',
        code: `app.use(rateLimit({\n  windowMs: 15 * 60 * 1000, // 15 minutes\n  max: 100 // limit each IP to 100 requests per windowMs\n}))`,
        benefits: ['Prevent abuse', 'Protect resources', 'Fair usage'],
    },
}

const bestPractices = [
    {
        title: 'Order Matters',
        desc: "Middleware executes in the order they're added. Add security middleware first.",
    },
    {
        title: 'Error Handling',
        desc: 'Always call next() or send a response to prevent hanging requests.',
    },
    {
        title: 'Performance',
        desc: 'Keep middleware lightweight and avoid blocking operations.',
    },
    {
        title: 'Conditional Use',
        desc: 'Use middleware conditionally based on routes or environment.',
    },
]

export default function MiddlewareDemo() {
    const [selected, setSelected] = useState('logging')
    const [copied, setCopied] = useState(false)

    const handleCopy = async (text) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {}
    }

    return (
        <div className="demoContainer middleware-demo">
            <div className="middleware-info" style={{ marginBottom: '1.5rem' }}>
                <h2>Middleware Best Practices</h2>
                <div className="practices-grid">
                    {bestPractices.slice(0, 3).map((p, i) => (
                        <div className="practice" key={i}>
                            <h4>{p.title}</h4>
                            <p>{p.desc}</p>
                        </div>
                    ))}
                </div>
            </div>

            <h2 className="middleware-title">Middleware Examples</h2>
            <p className="middleware-desc">
                This example demonstrates how to implement custom middleware in
                Catalyst applications.
            </p>

            <div className="middleware-controls">
                <div className="middleware-tabs">
                    {Object.keys(middlewares).map((key) => (
                        <button
                            key={key}
                            className={`middleware-tab${selected === key ? ' active' : ''}`}
                            onClick={() => setSelected(key)}
                        >
                            {middlewares[key].name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="middleware-main">
                <div className="middleware-example">
                    <h3>{middlewares[selected].name}</h3>
                    <p>{middlewares[selected].description}</p>
                    <div className="benefits">
                        <h4>Benefits</h4>
                        <ul>
                            {middlewares[selected].benefits
                                .slice(0, 3)
                                .map((b, i) => (
                                    <li key={i}>{b}</li>
                                ))}
                        </ul>
                    </div>
                    <div className="code-block">
                        <div className="code-header">
                            <span>Implementation</span>
                            <button
                                onClick={() =>
                                    handleCopy(middlewares[selected].code)
                                }
                                className={`copy-btn${copied ? ' copied' : ''}`}
                            >
                                {copied ? '✓ Copied!' : '📋 Copy'}
                            </button>
                        </div>
                        <pre>
                            <code>{middlewares[selected].code}</code>
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    )
}
