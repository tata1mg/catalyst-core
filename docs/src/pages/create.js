import React from 'react'
import Layout from '@theme/Layout'
import UploadCollection from '../components/UploadCollection/UploadCollection'

const create = () => {
    return (
        <Layout
            title="Upload Collection"
            description="Upload your postman collection here"
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    fontSize: '20px',
                }}
            >
                <UploadCollection />
            </div>
        </Layout>
    )
}

export default create
