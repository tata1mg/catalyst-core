import parser from "ua-parser-js"

const googleBots = {
    "APIs-Google": "APIs-Google",
    AdSense: "Mediapartners-Google",
    "AdsBot Mobile Web Android": "AdsBot-Google-Mobile",
    "AdsBot Mobile Web": "AdsBot-Google-Mobile",
    AdsBot: "AdsBot-Google",
    "Mobile AdSense": "Mediapartners-Google",
    "Mobile Apps Android": "AdsBot-Google-Mobile-Apps",
    Feedfetcher: "FeedFetcher-Google",
    "Google Read Aloud": "Google-Read-Aloud",
    "Duplex on the Web": "DuplexWeb-Google",
    "Google Favicon": "Google Favicon",
    "Web Light": "googleweblight",
    "Amp crawler": "Google-AMPHTM",
    Googlebot: "Googlebot",
    "Google Inspection Tool": "Google-InspectionTool",
}

// AI Crawler bots - for improved SEO with AI search engines
const aiCrawlerBots = {
    // OpenAI/ChatGPT bots
    GPTBot: "GPTBot",
    "ChatGPT-User": "ChatGPT-User",
    "OAI-SearchBot": "OAI-SearchBot",

    // Anthropic/Claude bots
    ClaudeBot: "ClaudeBot",
    "Claude-User": "Claude-User",
    "Claude-SearchBot": "Claude-SearchBot",

    // Perplexity bots
    PerplexityBot: "PerplexityBot",
    "Perplexity-User": "Perplexity-User",

    // Microsoft Bing bot (also powers Bing Chat/Copilot)
    Bingbot: "bingbot",
}

/**
 * check if user agent contains bot data
 * @param {string} ua - user agent
 * @return {string|null}
 */
const getGoogleBot = (ua) => {
    for (let key in googleBots) {
        if (ua.includes(googleBots[key])) return key
    }
    return null
}

const getAICrawlerBot = (ua) => {
    for (let key in aiCrawlerBots) {
        if (ua.includes(aiCrawlerBots[key])) return key
    }
    return null
}

/**
 * returns object which contains google bot and user-agent info
 * @param {string} ua - user agent
 * @return {object} - returns user agent
 */
export const getUserAgentDetails = (ua) => {
    const agentDetails = parser(ua)
    const googleBot = getGoogleBot(ua)
    const aiBot = getAICrawlerBot(ua)

    return { ...agentDetails, googleBot, aiBot }
}
