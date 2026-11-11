import lighthouse from "lighthouse"; import * as cl from "chrome-launcher"
const url=process.argv[2]
const ch=await cl.launch({chromePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",chromeFlags:["--headless=new","--no-sandbox"]})
const r=await lighthouse(url,{port:ch.port,output:"json",onlyCategories:["performance"],logLevel:"error"});const a=r.lhr.audits
console.log("LCP",a["largest-contentful-paint"].numericValue|0,"FCP",a["first-contentful-paint"].numericValue|0)
const rb=a["render-blocking-resources"];console.log("render-blocking:",rb.details?.items?.map(i=>`${i.url.split("/").slice(-2).join("/")} ${i.totalBytes}B wasted ${i.wastedMs|0}ms`)||"none")
console.log("network:");for(const i of a["network-requests"].details.items.slice(0,12))console.log(" ",i.resourceType.padEnd(10),String(i.transferSize).padStart(7)+"B",String(Math.round(i.networkEndTime-i.networkRequestTime)).padStart(5)+"ms",i.url.split("/").slice(-2).join("/").slice(0,50))
const lcp=a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node;console.log("LCP element:",lcp?.snippet?.slice(0,90))
await ch.kill()
