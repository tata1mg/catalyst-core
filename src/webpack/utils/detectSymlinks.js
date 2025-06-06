import fs from 'fs'
import path from 'path'

/**
 * Detects symlinked packages in node_modules
 * @param {string} nodeModulesPath - Path to node_modules directory
 * @returns {string[]} Array of package names that are symlinked
 */
export const detectSymlinkedPackages = (nodeModulesPath) => {
    try {
        const packages = fs.readdirSync(nodeModulesPath)
        return packages.filter(pkg => {
            try {
                const pkgPath = path.join(nodeModulesPath, pkg)
                const stats = fs.lstatSync(pkgPath)
                return stats.isSymbolicLink()
            } catch (err) {
                return false
            }
        })
    } catch (err) {
        console.warn('Error detecting symlinked packages:', err)
        return []
    }
}

/**
 * Generates webpack watchOptions for symlinked packages
 * @param {string} nodeModulesPath - Path to node_modules directory
 * @returns {Object} Webpack watchOptions configuration
 */
export const generateWatchOptions = (nodeModulesPath) => {
    const symlinkedPackages = detectSymlinkedPackages(nodeModulesPath)
    
    if (symlinkedPackages.length === 0) {
        return {
            followSymlinks: true,
            ignored: /node_modules/
        }
    }

    // Create regex pattern to ignore all node_modules except symlinked packages
    const ignorePattern = new RegExp(`node_modules\\/(?!${symlinkedPackages.join('|')})`)
    
    return {
        followSymlinks: true,
        ignored: ignorePattern
    }
} 