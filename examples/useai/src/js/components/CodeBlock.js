import React from "react";

export default function CodeBlock({ code, language }) {
    return (
        <div className="relative my-2 rounded-xl bg-neutral-900 border border-[var(--border)] overflow-hidden font-mono text-[12px]">
            {language && (
                <div className="absolute top-2 right-3 text-[10px] text-neutral-400 uppercase tracking-wider select-none bg-neutral-800 px-1.5 py-0.5 rounded font-sans">
                    {language}
                </div>
            )}
            <pre className="p-4 whitespace-pre overflow-x-auto text-neutral-200">
                <code>{code}</code>
            </pre>
        </div>
    );
}
