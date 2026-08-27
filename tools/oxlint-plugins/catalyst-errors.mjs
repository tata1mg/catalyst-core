/**
 * Custom oxlint plugin enforcing catalyst-core's error-handling convention:
 * production code under packages/catalyst-core/src (excluding the errors
 * module itself) must go through createError()/wrapError()/wrapForeignError()
 * rather than throwing a raw `new Error(...)`.
 *
 * oxlint has no equivalent to ESLint's `no-restricted-syntax`, so this rule
 * is implemented directly as a JS plugin. See:
 * https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html
 */

const noThrowNewError = {
    meta: {
        docs: {
            description:
                "Disallow `throw new Error(...)` (and other bare built-in Error subclasses) in favor of createError()/wrapError()/wrapForeignError() from src/errors.",
        },
    },
    create(context) {
        const BUILTIN_ERROR_NAMES = new Set([
            "Error",
            "TypeError",
            "RangeError",
            "SyntaxError",
            "ReferenceError",
            "EvalError",
            "URIError",
        ])

        return {
            ThrowStatement(node) {
                const arg = node.argument

                if (!arg || arg.type !== "NewExpression") {
                    return
                }

                const callee = arg.callee

                if (callee.type === "Identifier" && BUILTIN_ERROR_NAMES.has(callee.name)) {
                    context.report({
                        node,
                        message: `Use createError()/wrapError()/wrapForeignError() instead of \`throw new ${callee.name}(...)\`. See packages/catalyst-core/src/errors.`,
                    })
                }
            },
        }
    },
}

const plugin = {
    meta: {
        name: "catalyst-errors",
    },
    rules: {
        "no-throw-new-error": noThrowNewError,
    },
}

export default plugin
