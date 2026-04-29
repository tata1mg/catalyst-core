import React, { useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import styles from './styles.module.css'
import config from '../../config.json'

export const GoogleSignInWidget = ({ signInCallback }) => {
    const signInWrapper = useRef()

    useEffect(() => {
        var myScript = document.createElement('script')
        const signInButton = signInWrapper.current
        myScript.src = 'https://accounts.google.com/gsi/client'
        myScript.onload = function () {
            if (
                typeof window !== 'undefined' &&
                typeof window.google !== 'undefined' &&
                signInButton
            ) {
                var client_1 = window.google.accounts.oauth2.initCodeClient({
                    client_id: config.login.google_client_id,
                    scope: 'profile email',
                    callback: signInCallback,
                })
                signInButton.onclick = function (event) {
                    event.preventDefault()
                    client_1.requestCode()
                }
            }
        }
        document.body.appendChild(myScript)

        return () => {
            if (signInButton) {
                signInButton.onclick = null
            }
            if (myScript.parentNode) {
                myScript.parentNode.removeChild(myScript)
            }
        }
    }, [signInCallback])

    return (
        <>
            <button
                className={styles['gsi-material-button']}
                ref={signInWrapper}
            >
                <div className={styles['gsi-material-button-state']}></div>
                <div className={styles['gsi-material-button-content-wrapper']}>
                    <div className={styles['gsi-material-button-icon']}>
                        <svg
                            version="1.1"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 48 48"
                            xlink="http://www.w3.org/1999/xlink"
                            style={{ display: 'block' }}
                        >
                            <path
                                fill="#EA4335"
                                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                            ></path>
                            <path
                                fill="#4285F4"
                                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                            ></path>
                            <path
                                fill="#FBBC05"
                                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                            ></path>
                            <path
                                fill="#34A853"
                                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                            ></path>
                            <path fill="none" d="M0 0h48v48H0z"></path>
                        </svg>
                    </div>
                    <span className={styles['gsi-material-button-contents']}>
                        Sign in with Google
                    </span>
                    <span style={{ display: 'none' }}>Sign in with Google</span>
                </div>
            </button>
        </>
    )
}

GoogleSignInWidget.propTypes = {
    signInCallback: PropTypes.func.isRequired,
}
