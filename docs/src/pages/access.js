import React, { useEffect, useState } from 'react'
import Layout from '@theme/Layout'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import ServiceCheckBox from '../components/ServiceCheckbox'
import config from '../../config.json'
import { Button, Collapse, notification, ConfigProvider } from 'antd'
import axios from 'axios'
import AccessManagement from '../components/AccessManagement'
import styles from './access.module.css'

const AccessPage = () => {
    const context = useDocusaurusContext()
    const [checkedApiList, setCheckedApiList] = useState({})

    const serviceList = context.siteConfig.customFields
    const serviceNameList = Object.keys(serviceList.private)

    const collapseItems = serviceNameList.map((service) => ({
        key: service,
        label: `${service.charAt(0).toUpperCase()}${service.split('_').join(' ').slice(1)}`,
        children: (
            <ServiceCheckBox
                key={service}
                options={serviceList.private[service].routes}
                serviceName={service}
                setCheckedApiList={setCheckedApiList}
                checkedApiList={checkedApiList}
                publicServiceList={serviceList.public[service]}
            />
        ),
    }))
    const openNotificationWithIcon = (type, notificationObject) => {
        notification[type]({
            message: notificationObject.message,
            description: notificationObject.description,
        })
    }

    const handleSubmit = async () => {
        try {
            const res = await axios.post(
                `${config.docs.server_url}/access/assign_access`,
                checkedApiList
            )
            if (res?.data?.is_success) {
                openNotificationWithIcon('success', {
                    message: 'Success !',
                    description: 'Your request has been sent successfully',
                })
            }
        } catch (error) {
            openNotificationWithIcon('error', {
                message: 'Error !',
                description: error?.response?.data?.error ?? 'Request failed',
            })
        }
    }

    useEffect(() => {
        if (serviceNameList.length > 0) {
            serviceNameList.map((service) => {
                const publicServiceList = serviceList.public[service] ?? []
                setCheckedApiList((prev) => ({
                    ...prev,
                    [service]: publicServiceList,
                }))
            })
        }
    }, [serviceNameList?.length])

    return (
        <Layout
            title="Access Page"
            description="This is the page to provide access to the services and their API endpoints."
        >
            <div style={{ padding: '20px', width: '80%', margin: '0 auto' }}>
                <h1
                    style={{
                        color: 'inherit',
                        marginBottom: '20px',
                        margin: '10px auto',
                        textAlign: 'center',
                    }}
                >
                    Access Management
                </h1>
                {collapseItems?.length > 0 ? (
                    <>
                        <div className={styles['access-wrapper']}>
                            <Button
                                onClick={handleSubmit}
                                className={styles['access-submit-btn']}
                            >
                                Update
                            </Button>
                        </div>

                        <AccessManagement collapseItems={collapseItems} />
                    </>
                ) : (
                    <p className={styles['no-api-message']}>
                        There are no API documents available.
                    </p>
                )}
            </div>
        </Layout>
    )
}

export default AccessPage
