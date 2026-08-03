import React from "react";

export default function FlowPipeline({ active = true, className = "" }) {
    return (
        <div className={`relative h-16 my-2 w-full ${className}`}>
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes flowDash {
                    to {
                        stroke-dashoffset: -240;
                    }
                }
            `}} />
            <svg viewBox="0 0 1000 64" preserveAspectRatio="none" className="w-full h-full block">
                {/* Background base path */}
                <path
                    d="M120 32 H 880"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="1.5"
                    fill="none"
                />
                
                {/* Animated data flow stream */}
                {active && (
                    <path
                        d="M120 32 H 880"
                        stroke="#6E8BFF"
                        strokeWidth="2"
                        fill="none"
                        strokeDasharray="6 14"
                        style={{
                            animation: "flowDash 1.4s linear infinite",
                            opacity: 0.85
                        }}
                    />
                )}

                {/* Node points */}
                <circle cx="280" cy="32" r="3" fill="#6E8BFF" className="shadow-lg shadow-indigo-500/50" />
                <circle cx="470" cy="32" r="3" fill="#6E8BFF" />
                <circle cx="660" cy="32" r="3" fill="#2DD4BF" className="shadow-lg shadow-teal-500/50" />
                <circle cx="820" cy="32" r="3" fill="#2DD4BF" />
            </svg>
        </div>
    );
}
