/**
 * Minimal Docusaurus-style admonition support: turns `:::note` / `:::tip` /
 * `:::info` / `:::warning` / `:::danger` / `:::caution` container directives
 * into styled divs the docs CSS targets.
 */
import { visit } from "unist-util-visit"

const TYPES = new Set(["note", "tip", "info", "warning", "danger", "caution"])

const TITLES = {
    note: "Note",
    tip: "Tip",
    info: "Info",
    warning: "Warning",
    danger: "Danger",
    caution: "Caution",
}

export default function remarkAdmonitions() {
    return (tree) => {
        visit(tree, "containerDirective", (node) => {
            if (!TYPES.has(node.name)) {
                return
            }

            const data = node.data || (node.data = {})
            data.hName = "div"
            data.hProperties = {
                className: ["admonition", `admonition-${node.name}`],
            }

            const labelChild = node.children.find((child) => child.data?.directiveLabel)
            const title = labelChild
                ? labelChild.children.map((child) => child.value || "").join("")
                : TITLES[node.name]
            if (labelChild) {
                node.children = node.children.filter((child) => child !== labelChild)
            }

            node.children.unshift({
                type: "paragraph",
                data: {
                    hName: "div",
                    hProperties: { className: ["admonition-title"] },
                },
                children: [{ type: "text", value: title }],
            })
        })
    }
}
