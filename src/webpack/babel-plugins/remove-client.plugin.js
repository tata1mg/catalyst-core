/**
 * @description babel plugin used to remove unwanted code from the build.
 * @return babel plugin object
 */
export default function () {
    return {
        name: "ast-transform", // not required
        visitor: {
            ImportDefaultSpecifier(path) {
                path.parentPath.parent.body = path.parentPath.parent.body.map((astStructure) => {
                    if (astStructure.type === "VariableDeclaration") {
                        if (
                            astStructure.declarations[0]?.init?.type === "ArrowFunctionExpression" &&
                            astStructure.declarations[0]?.init?.body?.body?.length > 0
                        ) {
                            astStructure.declarations[0].init.body.body =
                                astStructure.declarations[0].init.body.body.filter(
                                    (node) =>
                                        !(
                                            node?.type === "ExpressionStatement" &&
                                            node?.expression?.callee?.name === "useEffect"
                                        )
                                )
                        }
                    }
                    if (
                        astStructure?.type === "FunctionDeclaration" &&
                        astStructure?.body?.body?.length > 0
                    ) {
                        astStructure.body.body = astStructure.body.body.filter(
                            (node) =>
                                !(
                                    node?.type === "ExpressionStatement" &&
                                    node?.expression?.callee?.name === "useEffect"
                                )
                        )
                    }
                    return astStructure
                })
            },
        },
    }
}
