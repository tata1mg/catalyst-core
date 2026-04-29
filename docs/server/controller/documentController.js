const router = require('express').Router()
const path = require('node:path')
const fs = require('node:fs')
const {
    handleNestedDirsForFormData,
    pushContentDocsToBitbucketAndCreatePR,
    replaceStringInDirectoryForContent,
    deleteTempDir,
    createContentTempDir,
} = require('../utils/script')
const { exec } = require('node:child_process')
const validateRequest = require('../middleware/reqValidator.js')
const {
    apiAuthChecker,
    checkCreateNewDocPermission,
} = require('../middleware/authCheker.js')
const config = require('../config.json')
const {
    S3Client,
    GetObjectCommand,
    ListObjectsV2Command,
} = require('@aws-sdk/client-s3')
const StreamZip = require('node-stream-zip')
const multer = require('multer')

const client = new S3Client({
    credentials: {
        accessKeyId: config.server.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.server.AWS_SECRET_ACCESS_KEY,
    },
    region: config.server.S3_REGION,
})

const storage = multer.diskStorage({
    destination: path.resolve(__dirname, '../collection-files'),
    filename: (req, file, cb) => {
        cb(null, file.originalname)
    },
})

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5000000,
    },
    fileFilter: (req, file, cb) => {
        if (!file) {
            cb(new Error('Document Zip file is missing'))
        } else if (
            file.mimetype.startsWith('application/zip') ||
            file.mimetype.startsWith('application/x-zip-compressed')
        ) {
            cb(null, true)
        } else {
            cb(new Error('Only ZIP files are allowed'))
        }
    },
})

// TODO: Add Auth Check
router.post('/sync-from-s3', async (req, res) => {
    const EXTRACTION_DIR_CONST = 'extracted/content'
    const { file_name } = req.body

    try {
        const tempFolderPath = createContentTempDir('temp')

        const command = new GetObjectCommand({
            Bucket: config.server.S3_BUCKET,
            Key: file_name,
        })
        const response = await client.send(command)
        const fileLocation = `${tempFolderPath}/${file_name}`
        const fileStream = fs.createWriteStream(fileLocation)

        await new Promise((resolve, reject) => {
            response.Body.pipe(fileStream)
                .on('finish', resolve)
                .on('error', reject)
        })

        console.log('File From S3 Bucket Download', file_name)

        const zip = new StreamZip.async({
            file: fileLocation,
            storeEntries: true,
        })

        const entriesCount = await zip.entriesCount
        const count = await zip.extract(null, `../temp/${EXTRACTION_DIR_CONST}`)
        console.log(`Extracted ${entriesCount} entries`)
        await zip.close()

        const oldFileNameList = []

        replaceStringInDirectoryForContent(
            path.resolve(__dirname, '../../temp/extracted'),
            '<br>',
            '<br/>'
        )

        handleNestedDirsForFormData(
            path.resolve(__dirname, `../../content/${file_name}`),
            oldFileNameList
        )

        await pushContentDocsToBitbucketAndCreatePR(
            file_name,
            'extracted',
            'extracted/content',
            oldFileNameList
        )

        deleteTempDir()
        return res.status(200).json({
            is_success: true,
            status_code: 200,
            message: `Extracted and Pushed ${file_name}`,
        })
    } catch (error) {
        deleteTempDir()
        console.log(error)
        return res
            .status(500)
            .json({ is_success: false, status_code: 500, error: error })
    }
})

// TODO: Add Auth Check
router.get('/get-s3-objects', async (req, res) => {
    try {
        const command = new ListObjectsV2Command({
            Bucket: config.server.S3_BUCKET,
            Delimiter: '/',
        })
        const response = await client.send(command)

        const keys = response.Contents.map((item) => item.Key)

        return res.status(200).json({
            is_success: true,
            status_coee: 200,
            message: keys,
        })
    } catch (error) {
        return res
            .status(500)
            .json({ is_success: false, status_code: 500, error: error })
    }
})

router.post(
    '/add-documents-zip',
    apiAuthChecker,
    checkCreateNewDocPermission,
    upload.single('file'),
    async (req, res) => {
        if (!req.body.document_folder_name) {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'document_folder_name is missing in req body',
            })
        }
        if (typeof req.body.document_folder_name !== 'string') {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'document_folder_name should be string',
            })
        }
        const testPattern = /[!@#$%^&*(),.?":{}|<>\s]/
        if (testPattern.test(req?.body?.document_folder_name)) {
            return res.status(400).json({
                is_success: false,
                status_code: 400,
                error: 'document_folder_name should not contain any special character or spaces',
            })
        }
        const EXTRACTION_DIR_CONST = 'extracted/content'
        const file_name = req?.file?.filename
        const document_folder_name = req?.body?.document_folder_name

        try {
            createContentTempDir('temp')
            const collectionFolderPath = path.resolve(
                __dirname,
                '../collection-files'
            )
            const fileLocation = `${collectionFolderPath}/${file_name}`

            const zip = new StreamZip.async({
                file: fileLocation,
                storeEntries: true,
            })

            const entriesCount = await zip.entriesCount
            const count = await zip.extract(
                null,
                `../temp/${EXTRACTION_DIR_CONST}`
            )
            console.log(`Extracted ${entriesCount} entries`)
            await zip.close()

            const existingFilePathList = []
            replaceStringInDirectoryForContent(
                path.resolve(__dirname, '../../temp/extracted'),
                '<br>',
                '<br/>'
            )

            handleNestedDirsForFormData(
                path.resolve(
                    __dirname,
                    `../../content/${document_folder_name}`
                ),
                existingFilePathList
            )
            await pushContentDocsToBitbucketAndCreatePR(
                document_folder_name,
                'extracted',
                'extracted/content',
                existingFilePathList
            )
            deleteTempDir()
            return res.status(200).json({
                is_success: true,
                status_code: 200,
                message: `Extracted and Pushed ${file_name}`,
            })
        } catch (error) {
            deleteTempDir()
            console.log(error)
            return res
                .status(500)
                .json({ is_success: false, status_code: 500, error: error })
        }
    }
)

module.exports = router
