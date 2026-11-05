/**
 * Whether a file path is inside node_modules: a dependency the loader leaves to
 * Node, rather than app code it transforms.
 *
 * Either separator: this is an OS path. Checking for "/" alone missed every
 * dependency on Windows, so all of them went down the app-file path and
 * `catalyst build` ran out of memory before it printed a single line.
 */
export function isDependencyPath(filePath) {
    return /[\\/]node_modules[\\/]/.test(filePath)
}
