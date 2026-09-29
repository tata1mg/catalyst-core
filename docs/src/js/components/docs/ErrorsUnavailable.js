import React from 'react'
import { rawIndexUrl } from '../../data/errorsCatalog'
import { githubBlobUrlFor } from '../../data/errorsSource'

/**
 * Shown on both the SSR direct-hit path and the CSR navigation path when the
 * live fetch of `errors/index.json` from GitHub fails. Always keeps the raw
 * GitHub link usable so a developer who followed a `Docs:` link from a
 * terminal error still gets to the doc, plus a Retry for the client path.
 *
 * `code` / `category` are the ones from the URL — passed through even though
 * the catalog is unavailable, so the panel can still name what they were
 * looking for and deep-link the blob.
 */

const ErrorsUnavailable = ({ code, category, reason, onRetry }) => (
    <div className="errors-offline" role="alert">
        <h1>Error documentation is temporarily unavailable</h1>
        <p>
            The catalog is loaded live from GitHub and that request didn&apos;t
            succeed{reason ? ` — ${reason}` : ''}.
        </p>
        {code && (
            <p className="errors-offline-code">
                You were looking for <code>{code}</code>.
            </p>
        )}
        <p>
            You can read{' '}
            <a
                href={githubBlobUrlFor(category, code)}
                target="_blank"
                rel="noreferrer"
            >
                {code ? `${code} on GitHub` : 'the error docs on GitHub'}
            </a>{' '}
            directly, or{' '}
            <a href={rawIndexUrl()} target="_blank" rel="noreferrer">
                the raw index
            </a>
            .
        </p>
        {onRetry && (
            <button type="button" className="errors-offline-retry" onClick={onRetry}>
                Retry
            </button>
        )}
    </div>
)

export default ErrorsUnavailable
