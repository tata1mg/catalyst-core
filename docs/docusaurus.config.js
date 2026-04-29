const docType = process.env.DOC_TYPE

module.exports = function configCreator() {
    if (docType === 'private') {
        return require('./privateDocs.config.js')
    }
    if (docType === 'public') {
        return require('./publicDocs.config.js')
    }
}
