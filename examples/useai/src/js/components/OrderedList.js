import React from "react";

export default function OrderedList({ body = "" }) {
    const items = (body || "")
        .split("\n")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    return (
        <ol className="list-decimal list-inside text-[12px] text-neutral-300 my-2 font-sans">
            {items.map((item, idx) => (
                <li key={idx} className="py-0.5">
                    {item}
                </li>
            ))}
        </ol>
    );
}
