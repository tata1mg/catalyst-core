import React, { Component } from 'react'
import styles from './styles.module.css'
import * as jose from 'jose'

class JwtGenerator extends Component {
    constructor() {
        super()
        this.state = {
            inputrsaKey: '',
            bearerToken: '',
        }
    }

    handleInputChange = (e) => {
        const { name, value } = e.target
        this.setState({ inputrsaKey: value })
    }

    handleSubmit = (e) => {
        e.preventDefault()
        const { username, password } = this.state
        // Add your login logic here
        alert(`Merchant trying to login ? ${username}`)
        console.log('Username:', username)
        console.log('Password:', password)
    }

    generateJwt = async () => {
        try {
            const pkcs8 = this.state.inputrsaKey
            const alg = 'RS256'
            const privateKey = await jose.importPKCS8(pkcs8, alg)

            const payload = {
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours
            }

            const token = await new jose.SignJWT(payload)
                .setProtectedHeader({
                    alg: 'RS256',
                })
                .setIssuedAt()
                .setExpirationTime(payload.exp)
                .sign(privateKey)

            if (token) {
                this.setState({ bearerToken: token })
            }
        } catch (error) {
            alert('Invald Payload')
        }
    }

    render() {
        return (
            <div className={styles['login-container']}>
                <h2>Jwt Generator</h2>
                <div className={styles['jwt-wrapper']}>
                    <div className={styles['column-1']}>
                        <textarea
                            placeholder="Enter your RSA key here"
                            value={this.state.inputrsaKey}
                            onChange={this.handleInputChange}
                        ></textarea>
                    </div>
                    <div className={styles['column-1']}>
                        <textarea value={this.state.bearerToken}></textarea>
                        <button onClick={this.generateJwt}>Generate JWT</button>
                    </div>
                </div>
            </div>
        )
    }
}

export default JwtGenerator
