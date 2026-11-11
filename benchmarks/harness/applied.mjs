import lighthouse from "lighthouse"; import * as cl from "chrome-launcher"
const [url,n=5]=[process.argv[2],+(process.argv[3]||5)];const med=a=>a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];const R={lcp:[],fcp:[],tbt:[],perf:[],si:[]}
for(let i=0;i<n;i++){const ch=await cl.launch({chromePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",chromeFlags:["--headless=new","--no-sandbox"]})
 const r=await lighthouse(url,{port:ch.port,output:"json",onlyCategories:["performance"],logLevel:"error",throttlingMethod:"devtools"});const a=r.lhr.audits
 R.lcp.push(a["largest-contentful-paint"].numericValue);R.fcp.push(a["first-contentful-paint"].numericValue);R.tbt.push(a["total-blocking-time"].numericValue);R.si.push(a["speed-index"].numericValue);R.perf.push(r.lhr.categories.performance.score*100);await ch.kill()}
console.log(url.padEnd(28),Object.entries(R).map(([k,v])=>`${k} ${med(v).toFixed(0)}`).join("  "))
