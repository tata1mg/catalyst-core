import React from 'react'
import { useColorMode } from '@docusaurus/theme-common'
import { Collapse, ConfigProvider, theme } from 'antd'

const AccessManagement = ({ collapseItems }) => {
    const { colorMode } = useColorMode()

    return (
        <>
            <ConfigProvider
                theme={
                    colorMode?.toLowerCase() === 'dark' && {
                        algorithm: theme.darkAlgorithm,
                    }
                }
            >
                <Collapse items={collapseItems} />
            </ConfigProvider>
        </>
    )
}

export default AccessManagement
