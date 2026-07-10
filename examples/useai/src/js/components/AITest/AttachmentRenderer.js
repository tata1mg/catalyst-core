import React, { useState, useEffect } from "react";
import InfoCard from "../InfoCard";
import CodeBlock from "../CodeBlock";
import DataTable from "../DataTable";

const ATTACHMENT_COMPONENTS = { InfoCard, CodeBlock, DataTable };

export default function AttachmentRenderer({ url }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        setData(null);

        fetch(url)
            .then((res) => {
                if (!res.ok) throw new Error("Network error");
                return res.json();
            })
            .then((json) => {
                if (active) {
                    setData(json);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (active) {
                    setError(err);
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [url]);

    if (loading) {
        return (
            <div className="w-full h-[80px] bg-neutral-800 animate-pulse rounded-xl my-2" />
        );
    }

    if (error) {
        return (
            <div className="text-red-500 text-[11px] my-1 font-sans">
                attachment unavailable
            </div>
        );
    }

    if (!data) return null;

    const { component, props } = data;
    const Comp = ATTACHMENT_COMPONENTS[component];

    if (!Comp) {
        return (
            <pre className="my-2 p-3 bg-neutral-900 border border-[var(--border)] rounded-xl font-mono text-[11px] overflow-x-auto text-neutral-300">
                {JSON.stringify(props, null, 2)}
            </pre>
        );
    }

    return <Comp {...props} />;
}
