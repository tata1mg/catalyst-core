import React from "react";
import InfoCard from "../components/InfoCard";
import CodeBlock from "../components/CodeBlock";
import DataTable from "../components/DataTable";
import Header from "../components/Header";
import OrderedList from "../components/OrderedList";

const ATTACHMENT_COMPONENTS = { InfoCard, CodeBlock, DataTable, Header, OrderedList };

export const truncateFilename = (filename) => {
    if (!filename) return "";
    return filename.length > 40 ? filename.slice(0, 37) + "..." : filename;
};

export const formatBytes = (bytes) => {
    if (bytes === null || bytes === undefined) return "—";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
};

export const formatSeconds = (ms) => {
    if (ms === null || ms === undefined) return "—";
    return `${(ms / 1000).toFixed(1)}s`;
};

export const formatTps = (tps) => {
    if (tps === null || tps === undefined) return "—";
    return `${tps} tok/s`;
};

export const formatTokens = (tokens) => {
    if (tokens === null || tokens === undefined) return "—";
    return String(tokens);
};

function parseMarkdownTable(md) {
    const lines = md.trim().split("\n").filter((l) => !/^\s*\|?\s*[-:]+[-| :]*\|?\s*$/.test(l));
    const parse = (line) => line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));
    const [header, ...body] = lines;
    return { headers: parse(header), rows: body.map(parse) };
}

function InlineAttachment({ json }) {
    try {
        const { component, attrs = {}, body = "" } = JSON.parse(json);
        const Comp = ATTACHMENT_COMPONENTS[component];
        if (!Comp) {
            return (
                <pre className="my-2 p-3 bg-neutral-900 border border-[var(--border)] rounded-xl font-mono text-[11px] overflow-x-auto text-neutral-300">
                    {body}
                </pre>
            );
        }
        let props;
        if (component === "DataTable") {
            props = parseMarkdownTable(body);
        } else if (component === "CodeBlock") {
            props = { ...attrs, code: body };
        } else if (component === "OrderedList") {
            props = { body };
        } else if (component === "Header") {
            props = { text: body, ...attrs };
        } else {
            props = { ...attrs, body };
        }
        return <Comp {...props} />;
    } catch (_) {
        return null;
    }
}

// Splits on \x00SATTACH:<json>\x00 sentinels written by useAI generateNative.
// Text segments render as whitespace-pre-wrap; sentinel segments render as inline components.
export function renderOutput(text, streaming) {
    if (!text) return null;
    const parts = text.split(/\x00SATTACH:([\s\S]*?)\x00/);

    return (
        <div className="flex flex-col gap-3">
            {parts.map((part, index) => {
                if (index % 2 === 0) {
                    if (!part) return null;
                    return (
                        <span key={index} className="whitespace-pre-wrap">
                            {part}
                        </span>
                    );
                } else {
                    return <InlineAttachment key={index} json={part} />;
                }
            })}
        </div>
    );
}
