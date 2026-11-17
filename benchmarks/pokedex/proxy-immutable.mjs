// Puts a production-style cache policy in front of `exact serve` (:8765): files under /.exact/gen/<hash>/ get
// "public, max-age=31536000, immutable" (their path changes when the build does); documents are left as served.
import http from "node:http"
const UP = { host: "127.0.0.1", port: +(process.env.UPSTREAM || 8765) }
http.createServer((q, r) => {
  const u = http.request({ ...UP, path: q.url, method: q.method, headers: q.headers }, (ur) => {
    const h = { ...ur.headers }; if (q.url.startsWith("/.exact/gen/") && ur.statusCode === 200) h["cache-control"] = "public, max-age=31536000, immutable"
    r.writeHead(ur.statusCode, h); ur.pipe(r) })
  u.on("error", () => { r.writeHead(502); r.end() }); q.pipe(u)
}).listen(+(process.env.PORT || 8775))
