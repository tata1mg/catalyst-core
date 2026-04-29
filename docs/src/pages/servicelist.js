import React from 'react'
import Layout from '@theme/Layout'
import styles from './servicelist.module.css'
import Service from '../components/Service'

const Servicelist = () => {
    return (
        <Layout
            title="Service List Page"
            description="This is the page to list all the services and their API endpoints."
        >
            <h2 style={{ textAlign: 'center', margin: '30px 0' }}>
                Available API{' '}
            </h2>
            <div className={styles['service-list']}>
                <Service />
            </div>
        </Layout>
    )
}

export default Servicelist
