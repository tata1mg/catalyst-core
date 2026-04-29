import React, { useEffect, useState } from 'react'
import { Checkbox } from 'antd'
const CheckboxGroup = Checkbox.Group
import styles from './styles.module.css'

const ServiceCheckBox = ({
    options,
    serviceName,
    setCheckedApiList,
    checkedApiList,
    publicServiceList,
}) => {
    const [publicList, setPublicList] = useState(
        publicServiceList ? publicServiceList : []
    )
    const privateApiList = options?.filter(
        (item) => !publicServiceList?.includes(item)
    )

    const [privateList, setPrivateList] = useState([])
    const checkAll = publicServiceList?.length === publicList.length
    const indeterminate =
        publicList.length > 0 && publicList.length < publicServiceList.length
    const checkAllPrivate = privateApiList?.length === privateList.length
    const indeterminatePrivate =
        privateList.length > 0 && privateList.length < privateApiList.length

    const onChange = (list) => {
        setPublicList(list)
        setCheckedApiList((prev) => ({
            ...prev,
            [serviceName]: [...privateList, ...list],
        }))
    }

    const onPrivateChange = (list) => {
        setPrivateList(list)
        setCheckedApiList((prev) => ({
            ...prev,
            [serviceName]: [...publicList, ...list],
        }))
    }

    const onCheckAllChange = (e) => {
        setPublicList(e.target.checked ? publicServiceList : [])
        setCheckedApiList((prev) => ({
            ...prev,
            [serviceName]: e.target.checked
                ? [...publicServiceList, ...privateList]
                : [],
        }))
    }

    const onCheckAllPrivateChange = (e) => {
        setPrivateList(e.target.checked ? privateApiList : [])
        setCheckedApiList((prev) => ({
            ...prev,
            [serviceName]: e.target.checked
                ? [...privateApiList, ...publicList]
                : [],
        }))
    }

    return (
        <>
            <div className={styles['row-wrapper']}>
                <h4>APIs visible to public -</h4>
                {publicServiceList?.length > 0 ? (
                    <>
                        <div className={styles['service-name']}>
                            <Checkbox
                                indeterminate={indeterminate}
                                onChange={onCheckAllChange}
                                checked={checkAll}
                            >
                                Select All
                            </Checkbox>
                        </div>
                        <div className={styles['check-box-group']}>
                            <CheckboxGroup
                                options={publicServiceList}
                                value={publicList}
                                onChange={onChange}
                            />
                        </div>
                    </>
                ) : (
                    <p>All APIs are hidden from public.</p>
                )}
            </div>
            <div className={styles['row-wrapper']}>
                <h4>APIs hidden from public -</h4>
                {privateApiList?.length > 0 ? (
                    <>
                        <div className={styles['service-name']}>
                            <Checkbox
                                indeterminate={indeterminatePrivate}
                                onChange={onCheckAllPrivateChange}
                                checked={checkAllPrivate}
                            >
                                Select All
                            </Checkbox>
                        </div>
                        <div className={styles['check-box-group']}>
                            <CheckboxGroup
                                options={privateApiList}
                                value={privateList}
                                onChange={onPrivateChange}
                            />
                        </div>
                    </>
                ) : (
                    <p>All APIs are visible to public</p>
                )}
            </div>
        </>
    )
}

export default ServiceCheckBox
