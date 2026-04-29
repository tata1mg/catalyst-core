const { default: axios } = require('axios')
const config = require('../config.json')

const serverAxios = axios.create({
    baseURL: `${config.server.auth_api_url}/`,
    responseType: 'json',
})

const googleSignin = (data) =>
    serverAxios.request({
        url: 'v6/google_signin',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        data,
    })

module.exports = { googleSignin }
