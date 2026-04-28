import React from 'react'
import Layout from '@theme/Layout'
import UploadZip from '../components/UploadZip'

const CreateDocPage = () => {
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
                <UploadZip />
            </div>
        </Layout>
    )
}

export default CreateDocPage
