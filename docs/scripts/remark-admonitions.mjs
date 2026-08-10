/**
 * Minimal Docusaurus-style admonition support: turns `:::note` / `:::tip` /
 * `:::info` / `:::warning` / `:::danger` / `:::caution` container directives
 * into styled divs the docs CSS targets.
 */
import { visit } from 'unist-util-visit'

const TYPES = new Set(['note', 'tip', 'info', 'warning', 'danger', 'caution'])

// Docusaurus writes an admonition title as `:::warning Version scope`, but
// remark-directive only accepts the bracket form `:::warning[Version scope]`.
// It does not error on the space form — it just never produces a directive
// node, so the block silently renders as literal ":::" text. Rewrite the
// opening fence before the parser sees it, so content stays in the syntax the
// docs are written in.
const SPACE_TITLE_FENCE = new RegExp(
    `^(:{3,})(${[...TYPES].join('|')})[ \\t]+(\\S.*?)[ \\t]*$`,
    'gm'
)

export function normalizeAdmonitionTitles(source) {
    return source.replace(SPACE_TITLE_FENCE, (_match, colons, type, title) => {
        // Already-bracketed titles never reach here (no space before "["), and a
        // "]" in the title would close the label early, so escape it.
        return `${colons}${type}[${title.replace(/\]/g, '\\]')}]`
    })
}

const TITLES = {
    note: 'Note',
    tip: 'Tip',
    info: 'Info',
    warning: 'Warning',
    danger: 'Danger',
    caution: 'Caution',
}

export default function remarkAdmonitions() {
    return (tree) => {
        visit(tree, 'containerDirective', (node) => {
            if (!TYPES.has(node.name)) {
                return
            }

            const data = node.data || (node.data = {})
            data.hName = 'div'
            data.hProperties = {
                className: ['admonition', `admonition-${node.name}`],
            }

            const labelChild = node.children.find(
                (child) => child.data?.directiveLabel
            )
            const title = labelChild
                ? labelChild.children.map((child) => child.value || '').join('')
                : TITLES[node.name]
            if (labelChild) {
                node.children = node.children.filter(
                    (child) => child !== labelChild
                )
            }

            node.children.unshift({
                type: 'paragraph',
                data: {
                    hName: 'div',
                    hProperties: { className: ['admonition-title'] },
                },
                children: [{ type: 'text', value: title }],
            })
        })
    }
}
