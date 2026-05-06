
const setCookie = (cookieName, cookieValue, expiryInDays) => {
    const d = new Date()
    d.setTime(d.getTime() + expiryInDays * 24 * 60 * 60 * 1000)
    const expires = `expires=${d.toUTCString()}`
    document.cookie = `${cookieName}=${cookieValue};${expires};Path=/;`
}

function getCookie(name) {
    const nameEQ = `${name}=`
    const ca = document.cookie.split(";")
    for (let i = 0; i < ca.length; i += 1) {
        let c = ca[i]
        while (c.charAt(0) === " ") c = c.substring(1, c.length)
        if (c.indexOf(nameEQ) === 0) {
            const value = c.substring(nameEQ.length, c.length)
            try {
                return JSON.parse(decodeURIComponent(value))
            } catch (err) {
                return value
            }
        }
    }
    return null
}

const deleteSingleCookie = (name) => {
    document.cookie = `${name}=; Max-Age=-99999999; Path=/;`
}

const deleteAllCookies = () => {
    const cookies = document.cookie.split(";")
    for (let i = 0; i < cookies.length; i += 1) {
        const cookie = cookies[i]
        const eqPos = cookie.indexOf("=")
        const name = eqPos > -1 ? cookie.substring(0, eqPos) : cookie
        deleteSingleCookie(name)
    }
    window.location.href = serverUrl
}