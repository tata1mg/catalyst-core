import React, { useEffect } from 'react'
import { useState } from 'react'
import styles from './styles.module.css'
import AppConfig from '../../../config.json'
import { notification } from 'antd'
import { useColorMode } from '@docusaurus/theme-common'

const UploadCollection = () => {
    const [collection, setCollection] = useState({
        apiName: '',
        data: '',
        uploadFile: 'postmanCode',
        file: null,
    })
    const { colorMode } = useColorMode()

    const submitHandler = async (e) => {
        e.preventDefault()
        if (
            collection.uploadFile === 'postmanCode' ||
            collection.uploadFile === 'openApiCode'
        ) {
            const url =
                collection.uploadFile === 'postmanCode'
                    ? `${AppConfig.docs.server_url}/collection/add_collection`
                    : `${AppConfig.docs.server_url}/collection/add_openapi_collection_user`
            const body = {
                service_name: collection.apiName.trim(),
                data: collection.data.trim(),
            }
            const res = await postData(url, body)
        } else {
            const fileUrl =
                collection.uploadFile === 'postmanFile'
                    ? `${AppConfig.docs.server_url}/collection/add_file`
                    : `${AppConfig.docs.server_url}/collection/add_openapi_file_user`
            const formData = new FormData()
            formData.append('service_name', collection.apiName.trim())
            formData.append('file', collection.file)
            const res = await postFile(fileUrl, formData)
        }
    }

    const openNotificationWithIcon = (type, notificationObject) => {
        notification[type]({
            message: notificationObject.message,
            description: notificationObject.description,
        })
    }

    const postData = async (url, data = {}) => {
        try {
            const jsonResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            })
            const response = await jsonResponse.json()
            if (response.is_success) {
                openNotificationWithIcon('success', {
                    message: 'Success !',
                    description: 'Your request has been sent successfully',
                })
                setCollection({
                    apiName: '',
                    data: '',
                    uploadFile: 'postmanCode',
                    file: null,
                })
                return response
            } else {
                openNotificationWithIcon('error', {
                    message: 'Error !',
                    description: response.error,
                })
            }
        } catch (error) {
            openNotificationWithIcon('error', {
                message: 'Error !',
                description: 'Request failed',
            })
        }
    }

    const postFile = async (url, formData) => {
        try {
            const jsonResponse = await fetch(url, {
                method: 'POST',
                body: formData,
            })
            const response = await jsonResponse.json()
            if (response.is_success) {
                openNotificationWithIcon('success', {
                    message: 'Success !',
                    description: 'Your request has been sent successfully',
                })
                setCollection({
                    apiName: '',
                    data: '',
                    uploadFile: 'postmanCode',
                    file: null,
                })
                return response
            } else {
                openNotificationWithIcon('error', {
                    message: 'Error !',
                    description: response.error,
                })
            }
        } catch (error) {
            openNotificationWithIcon('error', {
                message: 'Error !',
                description: 'Request failed',
            })
        }
    }

    const radioChangeHandler = (e) => {
        setCollection({ ...collection, uploadFile: e.target.value })
    }

    return (
        <div
            className={
                colorMode === 'dark'
                    ? styles['upload-wrapper-dark']
                    : styles['upload-wrapper']
            }
            style={{ margin: '50px 0' }}
        >
            <form onSubmit={submitHandler}>
                <h3 style={{ textAlign: 'center' }}>Onboard API</h3>
                <div className={styles['upload-title']}>
                    <label>Service Name</label>
                </div>
                <div className={styles['width-full']}>
                    <input
                        type="text"
                        value={collection.apiName}
                        onChange={(e) => {
                            setCollection({
                                ...collection,
                                apiName: e.target.value,
                            })
                        }}
                    />
                </div>
                <div className={`${styles['width-full']} ${styles['d-flex']}`}>
                    <div className={styles['column']}>
                        <input
                            className={styles['radio custom-radio']}
                            type="radio"
                            name="uploadFile"
                            id="postmanCode"
                            value={'postmanCode'}
                            checked={collection.uploadFile === 'postmanCode'}
                            onChange={radioChangeHandler}
                        />
                        <label htmlFor="postmanCode">Postman JSON Code</label>
                    </div>
                    <div className={styles['column']}>
                        <input
                            className={styles['radio custom-radio']}
                            type="radio"
                            name="uploadFile"
                            id="postmanFile"
                            value={'postmanFile'}
                            checked={collection.uploadFile === 'postmanFile'}
                            onChange={radioChangeHandler}
                        />
                        <label htmlFor="postmanFile">Postman JSON File</label>
                    </div>
                    <div className={styles['column']}>
                        <input
                            className={styles['radio custom-radio']}
                            type="radio"
                            name="uploadFile"
                            id="openApiCode"
                            value={'openApiCode'}
                            checked={collection.uploadFile === 'openApiCode'}
                            onChange={radioChangeHandler}
                        />
                        <label htmlFor="openApiCode">OpenAPI JSON Code</label>
                    </div>
                    <div className={styles['column']}>
                        <input
                            className={styles['radio custom-radio']}
                            type="radio"
                            name="uploadFile"
                            id="openApiFile"
                            value={'openApiFile'}
                            checked={collection.uploadFile === 'openApiFile'}
                            onChange={radioChangeHandler}
                        />
                        <label htmlFor="openApiFile">OpenAPI JSON File</label>
                    </div>
                </div>
                <br />
                {collection.uploadFile === 'postmanFile' ||
                collection.uploadFile === 'openApiFile' ? (
                    <div>
                        <div style={{ margin: '15px 0' }}>
                            <label style={{ marginRight: '10px' }}>
                                Select File:
                            </label>
                            <input
                                type="file"
                                style={{
                                    padding: '8px',
                                    borderRadius: '5px',
                                    border: '1px solid #ccc',
                                }}
                                onChange={(e) =>
                                    setCollection({
                                        ...collection,
                                        file: e.target.files[0],
                                    })
                                }
                            />
                        </div>
                    </div>
                ) : (
                    <div className={styles['upload-title']}>
                        <label>JSON</label>
                        <textarea
                            rows={10}
                            cols={100}
                            value={collection.data}
                            onChange={(e) => {
                                setCollection({
                                    ...collection,
                                    data: e.target.value,
                                })
                            }}
                        ></textarea>
                    </div>
                )}
                <div>
                    <button className={styles['btn']} type="submit">
                        Upload
                    </button>
                </div>
            </form>
        </div>
    )
}

export default UploadCollection
