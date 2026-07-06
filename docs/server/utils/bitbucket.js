const { Bitbucket } = require('bitbucket')
// const config = require('../config/serverConfig');
const config = require('../config.json')

const clientOptions = {
    auth: {
        token: config.server.BITBUCKET_REPO_TOKEN,
    },
}

const bitbucket = new Bitbucket(clientOptions)

/**
 * Push files to Bitbucket Repository
 * https://bitbucketjs.netlify.app/#api-repositories-repositories_createSrcFileCommits
 * @param {string} [repoSlug=config.BITBUCKET_REPO] - The slug of the repository
 * @param {string} [workspace=config.BITBUCKET_WORKSPACE] - The workspace ID
 * @param {string} [files] - This files meta data field is redundant when used with body, read the docs above
 * @param {string} [_body=null] - FormData for files that need to be uploaded
 * @param {string} [author=null] - The author of the commit
 * @param {string} [branch=null] - The branch where the commit should be made
 * @param {string} [message=null] - The commit message
 * @param {string} [parents=null] - The parents of the commit
 * @returns {Promise<Object>} The data returned from the Bitbucket API
 */
const updateFilesToBitbucketRepo = async ({
    repoSlug = config.server.BITBUCKET_REPO,
    workspace = config.server.BITBUCKET_WORKSPACE,
    files = null,
    body = null,
    author = null,
    branch = null,
    message = null,
    parents = null,
}) => {
    try {
        const createFileCommitParams = {
            repo_slug: repoSlug,
            workspace,
            ...(body ? { _body: body } : {}),
            ...(author ? { author: author } : {}),
            ...(branch ? { branch: branch } : {}),
            ...(files ? { files: files } : {}),
            ...(message ? { message: message } : {}),
            ...(parents ? { parents: parents } : {}),
        }
        const res = await bitbucket.source.createFileCommit(
            createFileCommitParams
        )
        return res
    } catch (error) {
        console.error(`Failed to push files to repo: ${error.message}`)
        throw new Error(`Failed to push files to repo: ${error.message}`)
    }
}

/**
 * Create a pull request on Bitbucket
 * https://bitbucketjs.netlify.app/#api-repositories-pullRequests-create
 * @param {string} [source_branch] - The source branch of the pull request
 * @param {string} [destination_branch] - The destination branch of the pull request
 * @returns {Promise<Object>} The data returned from the Bitbucket API
 * @throws {Error} If the pull request creation fails
 **/
const createPullRequestOnBitbucket = async (
    source_branch,
    destination_branch
) => {
    try {
        const createPullRequestParams = {
            repo_slug: config.server.BITBUCKET_REPO,
            workspace: config.server.BITBUCKET_WORKSPACE,
            title: `COT-573: OneDoc Build Triggered On Branch ${source_branch}`,
            source: {
                branch: {
                    name: source_branch,
                },
            },
            destination: {
                branch: {
                    name: destination_branch,
                },
            },
            description: `OneDoc Build Triggered On Branch ${source_branch} against ${destination_branch}`,
        }

        const { data } = await bitbucket.pullrequests.create(
            createPullRequestParams
        )
        return data
    } catch (error) {
        console.error(`Failed to create pull request: ${error.message}`)
        throw new Error(`Failed to create pull request: ${error.message}`)
    }
}

module.exports = { updateFilesToBitbucketRepo, createPullRequestOnBitbucket }
