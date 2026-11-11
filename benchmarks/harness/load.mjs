import http from 'node:http'
const [url,n,c,procs]=[process.argv[2],+process.argv[3],+process.argv[4],+(process.argv[5]||1)]
const {Worker,isMainThread,workerData,parentPort}=await import('node:worker_threads')
if(isMainThread){
  const run=()=>Promise.all(Array.from({length:procs},()=>new Promise(r=>{const w=new Worker(new URL(import.meta.url),{workerData:{url,n:Math.ceil(n/procs),c:Math.ceil(c/procs)},argv:[url,n,c]});w.on('message',r)})))
  await run() // warmup
  const out=[];for(let i=0;i<3;i++){const t=performance.now();const res=await run();const wall=(performance.now()-t)/1000;const lat=res.flat().sort((a,b)=>a-b);out.push({rps:lat.length/wall,mean:lat.reduce((a,b)=>a+b,0)/lat.length,p99:lat[Math.floor(lat.length*.99)]})}
  console.log(url.padEnd(38),out.map(o=>`${o.rps.toFixed(0)}rps/${o.mean.toFixed(1)}ms/p99 ${o.p99.toFixed(1)}`).join('  |  '))
}else{
  const {url,n,c}=workerData;const agent=new http.Agent({keepAlive:true,maxSockets:c});let issued=0;const lat=[]
  const one=()=>new Promise(res=>{const t=performance.now();http.get(url,{agent,headers:{'accept-encoding':'gzip'}},r=>{let b=0;r.on('data',d=>b+=d.length);r.on('end',()=>{lat.push(performance.now()-t);res()})})})
  await Promise.all(Array.from({length:c},async()=>{while(issued<n){issued++;await one()}}))
  parentPort.postMessage(lat)
}
