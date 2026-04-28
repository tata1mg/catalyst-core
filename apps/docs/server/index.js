const express = require('express')
const cors = require('cors')
const appConfig = require('./config.json')
const collection = require('./controller/collection')
const authController = require('./controller/authController')
const accessController = require('./controller/accessController')
const documentController = require('./controller/documentController')
const path = require('node:path')
const cookieParser = require('cookie-parser')
const {
    authChecker,
    checkPrivateDocsViewPermission,
} = require('./middleware/authCheker')

const app = express()
const { port } = appConfig.server
const privateDocsMountUrl = appConfig?.server?.private_docs_mount_url
    ? `/${appConfig?.server?.private_docs_mount_url}`
    : '/private_docs'
const publicDocsMountUrl = appConfig?.server?.public_docs_mount_url
    ? `/${appConfig?.server?.public_docs_mount_url}`
    : '/'

app.use(cookieParser())
app.use(express.json({ limit: '5mb' }))
app.use(cors())

if (publicDocsMountUrl !== '/') {
    app.get('/', (req, res) => {
        res.redirect(publicDocsMountUrl)
    })
}

app.get('/sitemap.xml', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../build/public-docs/sitemap.xml'))
})

app.get('/docs', (req, res) => {
    res.redirect('/public_docs')
})

app.use(
    '/login',
    express.static(path.resolve(__dirname, '../login-page/build'))
)
app.use(
    privateDocsMountUrl,
    authChecker,
    checkPrivateDocsViewPermission,
    express.static(path.resolve(__dirname, '../build/private-docs'))
)
app.use(
    publicDocsMountUrl,
    express.static(path.resolve(__dirname, '../build/public-docs'))
)

app.use('/collection', collection)
app.use('/auth', authController)
app.use('/access', accessController)
app.use('/document-api', documentController)

app.use('/assets', express.static(path.resolve(__dirname, './public')))

app.use((req, res, next) => {
    res.status(404).sendFile(path.resolve(__dirname, './404/index.html'))
})

app.listen(port, () => console.log(`App listening at http://localhost:${port}`))
