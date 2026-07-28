import React, { useEffect, useState } from "react"
import { useGoogleSignIn } from "catalyst-core/hooks"
import ShowcaseBar from "../ShowcaseBar"
import css from "../Showcase.scss"

const GoogleSignInShowcase = () => {
    const { data: user, execute, clear, isNative, loading, error: hookError } = useGoogleSignIn()
    const [error, setError] = useState(null)

    useEffect(() => {
        if (hookError) setError(hookError.message || "Google Sign-In failed")
    }, [hookError])

    return (
        <>
            <ShowcaseBar title="Google Sign-In" />
            <p className={css.lede}>
                Account auth through the platform&rsquo;s native Google SDK — no redirect
                dance, no embedded web login.
            </p>

            {error && <div className={css.bannerError}>{error}</div>}
            {!isNative && (
                <div className={css.bannerInfo}>
                    Requires the native Google SDK inside the Companion app.
                </div>
            )}

            {user ? (
                <>
                    <div className={css.group}>
                        <div className={css.account}>
                            <span className={css.avatar}>{user.name?.[0]?.toUpperCase() || "U"}</span>
                            <span className={css.accountMeta}>
                                <strong>{user.name}</strong>
                                <span>{user.email}</span>
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        className={`${css.btn} ${css.btnDanger}`}
                        onClick={() => {
                            setError(null)
                            clear()
                        }}
                        disabled={loading}
                    >
                        Sign Out
                    </button>
                </>
            ) : (
                <button
                    type="button"
                    className={css.btnPrimary}
                    onClick={() => {
                        setError(null)
                        execute()
                    }}
                    disabled={loading || !isNative}
                >
                    {loading ? "Signing in…" : "Sign in with Google"}
                </button>
            )}
        </>
    )
}

export default GoogleSignInShowcase
