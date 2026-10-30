import path from "path"
import { artifactBaseName, releaseFolderName } from "../releaseOutput.js"

/**
 * Where a release puts its files: build-output/android/<version>-<build>/
 * in the app, or <android.outputPath>/<version>-<build>/ when the config
 * sets an output path. One folder per build, so nothing is overwritten.
 *
 * @param {object} options
 * @param {string} [options.appRoot]
 * @param {{ outputPath?: string }} [options.androidConfig]
 * @param {{ versionName?: string, buildNumber: number | string }} options.version - resolveNativeConfig().version
 * @returns {string}
 */
function releaseOutputDir({ appRoot = process.cwd(), androidConfig = {}, version }) {
    const root = androidConfig.outputPath
        ? path.resolve(appRoot, androidConfig.outputPath)
        : path.join(appRoot, "build-output", "android")
    return path.join(root, releaseFolderName(version))
}

/**
 * The release files in that folder: the bundle for Play and the upload
 * certificate (PEM) that identifies the key that signed it.
 *
 * @param {string} dir - releaseOutputDir()
 * @param {string} name - the app's name; made file-name safe here
 */
function releaseArtifactPaths(dir, name) {
    return {
        aab: path.join(dir, `${artifactBaseName(name)}.aab`),
        certificate: path.join(dir, "upload_certificate.pem"),
    }
}

export { releaseOutputDir, releaseArtifactPaths }
