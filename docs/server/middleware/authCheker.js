const jwt = require('jsonwebtoken')
const config = require('../config.json')
const { userRole } = require('../utils/constants')

const authChecker = (req, res, next) => {
    const token = req.cookies.authToken
    if (!token) {
        return res.redirect('/login')
    }
    jwt.verify(token, config.server.jwt_secret, (err, payload) => {
        if (err) {
            return res.redirect('/login')
        } else {
            req.user_email = payload.user_email
            req.roles = payload?.roles
        }
        next()
    })
}

const apiAuthChecker = (req, res, next) => {
    const token = req.cookies.authToken
    if (!token) {
        return res.status(403).json({
            is_success: false,
            status_code: 403,
            error: 'Access Denied',
        })
    }
    jwt.verify(token, config.server.jwt_secret, (err, payload) => {
        if (err) {
            return res.status(403).json({
                is_success: false,
                status_code: 403,
                error: 'Access Denied',
            })
        } else {
            req.user_email = payload.user_email
            req.roles = payload?.roles
        }
        next()
    })
}

const checkCreateNewDocPermission = (req, res, next) => {
    if (
        !(
            req?.roles?.includes(userRole.ROLE_SUPER_ADMIN) ||
            req?.roles?.includes(userRole.ROLE_CREATE_DOC)
        )
    ) {
        return res.status(403).json({
            is_success: false,
            status_code: 403,
            error: 'Access Denied',
        })
    }
    next()
}

const checkAccessControlPermission = (req, res, next) => {
    if (
        !(
            req?.roles?.includes(userRole.ROLE_SUPER_ADMIN) ||
            req?.roles?.includes(userRole.ROLE_ACCESS_CONTROL)
        )
    ) {
        return res.status(403).json({
            is_success: false,
            status_code: 403,
            error: 'Access Denied',
        })
    }
    next()
}

const checkPrivateDocsViewPermission = (req, res, next) => {
    if (
        !(
            req?.roles?.includes(userRole.ROLE_SUPER_ADMIN) ||
            req?.roles?.includes(userRole.ROLE_USER)
        )
    ) {
        return res.redirect('/public_docs')
    }
    next()
}

module.exports = {
    authChecker,
    apiAuthChecker,
    checkAccessControlPermission,
    checkCreateNewDocPermission,
    checkPrivateDocsViewPermission,
}
