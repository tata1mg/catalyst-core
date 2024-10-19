/**
 * @description babel plugin used to remove unwanted code from the build.
 * @return babel plugin object
 */
export default function () {
    return {
        name: "ast-transform", // not required
        visitor: {
            ImportDefaultSpecifier(path) {
                path.parentPath.parent.body = path.parentPath.parent.body.filter(
                    (val) =>
                        val?.expression?.left?.property?.name !== "serverSideFunction" &&
                        val?.expression?.left?.property?.name !== "serverFetcher"
                )
            },
        },
    }
}
