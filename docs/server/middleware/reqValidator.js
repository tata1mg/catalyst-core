const validateRequest = (req, res, next) => {
    const testPattern = /[!@#$%^&*(),.?":{}|<>-]/
    if (!req.body) {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'Invalid req body',
        })
    } else if (!req.body.service_name) {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'service_name is missing in req body',
        })
    } else if (!req.body.data) {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'JSON is missing in req body',
        })
    } else if (typeof req.body.service_name !== 'string') {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'service_name should be string',
        })
    } else if (testPattern.test(req?.body?.service_name)) {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'service_name should not contain any special character',
        })
    } else if (!isJson(req?.body?.data)) {
        return res.status(400).json({
            is_success: false,
            status_code: 400,
            error: 'invalid JSON',
        })
    }
    next()
}

const isJson = (item) => {
    let value = typeof item !== 'string' ? JSON.stringify(item) : item
    try {
        value = JSON.parse(value)
    } catch (e) {
        return false
    }

    return typeof value === 'object' && value !== null
}

module.exports = validateRequest
