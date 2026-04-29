import React from 'react'
import Layout from '@theme/Layout'
import JwtGenerator from '../components/JwtGenerator'

export default function JwtGenPage() {
    return (
        <Layout title="Hello" description="Hello React Page">
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '70vh',
                    fontSize: '20px',
                }}
            >
                <JwtGenerator />
            </div>
        </Layout>
    )
}
