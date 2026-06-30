import React from "react";

export default function StreamingText({ text = "", active = false, className = "" }) {
    return (
        <span className={`${className} inline-block`}>
            {text}
            {active && (
                <span 
                    className="inline-block w-[6px] h-[13px] bg-indigo-500 ml-1 align-baseline animate-[pulse_0.8s_infinite]"
                    style={{ verticalAlign: "-1px" }}
                />
            )}
        </span>
    );
}
