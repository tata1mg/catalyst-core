import { createGzip, createBrotliCompress } from "node:zlib"
import { CompressStream } from "zstd-napi"

const THRESHOLD = 1024

export function createCompression() {
    return function compression(req, res, next) {
        if (req.method === "HEAD") return next()

        const _write = res.write.bind(res)
        const _end = res.end.bind(res)
        const _flush = res.flush ? res.flush.bind(res) : null

        let stream = null
        let setup = false

        function getStream() {
            if (setup) return stream
            setup = true

            if (res.getHeader("Content-Encoding")) return null

            const cacheControl = res.getHeader("Cache-Control") || ""
            if (/no-transform/i.test(cacheControl)) return null

            const contentLength = res.getHeader("Content-Length")
            if (contentLength && parseInt(contentLength, 10) < THRESHOLD) return null

            const statusCode = res.statusCode
            if (statusCode === 204 || statusCode === 304) return null

            const acceptEncoding = req.headers["accept-encoding"] || ""

            let encoding
            if (/\bzstd\b/.test(acceptEncoding)) {
                stream = new CompressStream()
                encoding = "zstd"
            } else if (/\bbr\b/.test(acceptEncoding)) {
                stream = createBrotliCompress()
                encoding = "br"
            } else if (/\bgzip\b/.test(acceptEncoding)) {
                stream = createGzip()
                encoding = "gzip"
            } else {
                return null
            }

            res.setHeader("Content-Encoding", encoding)
            res.removeHeader("Content-Length")

            stream.on("data", (chunk) => _write(chunk))
            stream.on("end", () => _end())
            stream.on("error", (err) => {
                console.error(`[compression] ${encoding} stream error:`, err)
                _end()
            })

            return stream
        }

        res.write = function (chunk, encoding, callback) {
            const s = getStream()
            if (s) return s.write(chunk, encoding, callback)
            return _write(chunk, encoding, callback)
        }

        res.end = function (chunk, encoding, callback) {
            const s = getStream()
            if (s) {
                if (chunk != null) s.write(chunk)
                s.end()
                return res
            }
            return _end(chunk, encoding, callback)
        }

        res.flush = function () {
            if (stream && stream.flush) {
                stream.flush()
            } else if (_flush) {
                _flush()
            }
        }

        next()
    }
}
