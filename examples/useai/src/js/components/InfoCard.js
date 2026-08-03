import React from "react";

export default function InfoCard({ title, body, type }) {
    let borderClass = "border-blue-500 bg-blue-500/5";
    if (type === "warning") {
        borderClass = "border-yellow-500 bg-yellow-500/5";
    } else if (type === "success") {
        borderClass = "border-green-500 bg-green-500/5";
    }
    return (
        <div className={`border-l-4 p-4 rounded-r-xl ${borderClass} my-2 font-sans`}>
            <div className="font-bold text-white text-[13px]">{title}</div>
            <div className="text-[12px] text-neutral-300 mt-1 leading-relaxed">{body}</div>
        </div>
    );
}
