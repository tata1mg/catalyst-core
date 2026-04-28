const { googleSignin } = require('../utils/request')
const jwt = require('jsonwebtoken')
const config = require('../config.json')
const { userRole } = require('../utils/constants')
const router = require('express').Router()

router.post('/google_signin', async (req, res) => {
    const googleData = {
        code: req.body.code,
        source: 'docusaurus_login',
    }

    try {
        const response = await googleSignin(googleData)
        const { data } = response.data
        const result = data
        //   Create User JWT Token
        const roles = result?.roles?.one_doc?.map((item) => userRole[item])
        if (!roles) {
            return res.status(401).json({
                is_success: false,
                status_code: 401,
                error: 'Unauthorized user',
            })
        }
        const userToken = {
            auth_token: result?.authentication_token,
            token_expiry: config.server.JWT_EXPIRE_TIME,
            roles: roles,
        }
        const token = jwt.sign(userToken, config.server.jwt_secret, {
            expiresIn: config.server.JWT_EXPIRE_TIME, // Token Times Out after 10h
        })
        res.cookie('authToken', token, {
            httpOnly: true,
            maxAge: 10 * 60 * 60 * 1000, // 10 hour
        })
        res.status(response.status)
        return res.send({
            token,
            roles: roles,
        })
    } catch (error) {
        res.status(error?.response?.data?.status_code || 500)
        return res.send(error?.response?.data || 'Internal Server Error')
    }
})

module.exports = router
