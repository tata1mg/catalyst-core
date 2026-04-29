import React, { useState } from 'react'
import styles from './styles.module.css'
import { useColorMode } from '@docusaurus/theme-common'
import axios from 'axios'
import { notification, Spin } from 'antd'
import config from '../../../config.json'

const UploadZip = () => {
    const { colorMode } = useColorMode()
    const [formValue, setFormValue] = useState({
        document_folder_name: '',
        file: '',
    })
    const [loading, setLoading] = useState(false)

    const openNotificationWithIcon = (type, notificationObject) => {
        notification[type]({
            message: notificationObject.message,
            description: notificationObject.description,
        })
    }

    const submitHandler = async (e) => {
        try {
            e.preventDefault()
            const data = new FormData()
            data.append(
                'document_folder_name',
                formValue?.document_folder_name?.trim()
            )
            data.append('file', formValue?.file)
            setLoading(true)
            const response = await axios.post(
                `${config.docs.server_url}/document-api/add-documents-zip`,
                data,
                {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    withCredentials: true,
                }
            )
            setLoading(false)
            if (response?.data?.is_success) {
                openNotificationWithIcon('success', {
                    message: 'Success !',
                    description: response?.data?.message,
                })
            }
        } catch (error) {
            setLoading(false)
            if (error?.response?.data?.error) {
                openNotificationWithIcon('error', {
                    message: 'Error !',
                    description: error?.response?.data?.error,
                })
            } else {
                openNotificationWithIcon('error', {
                    message: 'Error !',
                    description: 'Request failed',
                })
            }
        }
    }

    return (
        <div
            className={
                colorMode === 'dark'
                    ? styles['upload-wrapper-dark']
                    : styles['upload-wrapper']
            }
        >
            <div className={styles['heading']}>
                <h2>Add Document</h2>
            </div>
            <div className={styles['form-wrapper']}>
                <form onSubmit={submitHandler}>
                    <div className={styles['input-label']}>
                        <label>Document Folder Name</label>
                    </div>
                    <div>
                        <input
                            type="text"
                            name="document_folder_name"
                            placeholder="Enter document folder name"
                            value={formValue?.document_folder_name}
                            onChange={(e) => {
                                setFormValue({
                                    ...formValue,
                                    document_folder_name: e.target.value,
                                })
                            }}
                        />
                    </div>
                    <div className={styles['input-label']}>
                        <label>Upload Zip File</label>
                    </div>
                    <div className={styles['input-upload']}>
                        <input
                            type="file"
                            name="file"
                            placeholder="Upload zip file"
                            onChange={(e) =>
                                setFormValue({
                                    ...formValue,
                                    file: e.target.files[0],
                                })
                            }
                        />
                    </div>
                    <div>
                        <button
                            className={styles['btn']}
                            type="submit"
                            disabled={loading}
                        >
                            {loading ? <Spin /> : 'Submit'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default UploadZip
