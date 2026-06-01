import React from 'react'
import styles from './styles.module.css'
import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'

const Service = () => {
    const context = useDocusaurusContext()
    let serviceNameList = []
    if (context.siteConfig.baseUrl.includes('private_docs')) {
        const serviceList = context.siteConfig?.customFields?.private
        const serviceArray = Object.entries(serviceList)
        serviceArray.forEach((item) => {
            serviceNameList.push({
                serviceName: item[0],
                versions: item[1]?.info?.map((item) => item.version),
            })
        })
    } else {
        const serviceList = context.siteConfig?.customFields?.public
        const serviceArray = Object.entries(serviceList)
        serviceArray.forEach((item) => {
            serviceNameList.push({ serviceName: item[0], versions: item[1] })
        })
    }

    return (
        <>
            {serviceNameList.map((item) => {
                const serviceName = item?.serviceName?.split('_').join(' ')
                const formattedServiceName =
                    serviceName?.charAt(0)?.toUpperCase() +
                    serviceName?.slice(1)
                return (
                    <div
                        key={item?.serviceName}
                        className={styles.linkContainer}
                    >
                        <Link
                            to={`docs/${item?.serviceName?.split('_').join('-')}/${item?.versions[item?.versions?.length - 1]}`}
                            className={styles.link}
                        >
                            {formattedServiceName}
                        </Link>
                    </div>
                )
            })}
        </>
    )
}

export default Service
