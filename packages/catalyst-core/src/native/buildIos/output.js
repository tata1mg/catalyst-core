import path from "path"
import { artifactBaseName, releaseFolderName } from "../releaseOutput.js"

/**
 * Where a release writes its IPA and dSYMs: <app>/build-output/ios/<version>-<build>,
 * with the version from package.json and the build number from
 * nativeConfig.js resolveAppVersion (the same pair as CFBundleShortVersionString
 * and CFBundleVersion). Outside build/, which `catalyst build` deletes.
 *
 * @param {string} appRoot
 * @param {{ versionName?: string, buildNumber: number }} version
 */
function releaseOutputDir(appRoot, version) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - appRoot is the local app; the folder name is sanitised.
    return path.resolve(appRoot, "build-output", "ios", releaseFolderName(version))
}

export { artifactBaseName, releaseOutputDir }
