import React, { useState, useEffect, useRef } from "react";
import ShimmerSkeleton from "../../components/ShimmerSkeleton";
import StreamingText from "../../components/StreamingText";

export default function Delta() {
    const [ch03Mode, setCh03Mode] = useState("delta");
    const [ch03Net, setCh03Net] = useState("online");
    const [streamProgress, setStreamProgress] = useState(0);
    const streamTimerRef = useRef(null);

    const isOffline = ch03Net === "offline";

    const ch03Modes = ["classic", "stream", "delta"];

    const textToStream = "Your fasting glucose of 112 mg/dL sits just above range, and paired with an HbA1c of 5.9% suggests an early metabolic shift worth watching. LDL at 142 mg/dL adds a cardiovascular dimension…";

    // Manage streaming preview animation when mode is 'stream'
    useEffect(() => {
        if (ch03Mode === "stream") {
            setStreamProgress(0);
            streamTimerRef.current = setInterval(() => {
                setStreamProgress((prev) => {
                    if (prev < textToStream.length) {
                        return prev + 2;
                    } else {
                        return 0; // Loop stream
                    }
                });
            }, 50);
        } else {
            if (streamTimerRef.current) clearInterval(streamTimerRef.current);
        }

        return () => {
            if (streamTimerRef.current) clearInterval(streamTimerRef.current);
        };
    }, [ch03Mode]);

    const ch03Caption = {
        classic: "classic — one blocking request, render on completion",
        stream: "stream — a single token stream fills one block",
        delta: isOffline 
            ? "delta — streaming from on-device model (network cut)" 
            : "delta — each card resolves on its own connection"
    }[ch03Mode];

    // Cards data for delta mode
    const deltaCards = [
        { name: "Vitamin D", value: "18", note: "Low — supplement", color: "text-amber-400", done: true },
        { name: "HbA1c", value: "5.9%", note: "Prediabetic range", color: "text-red-400", done: true },
        { name: "LDL", value: "142", note: "Above target", color: "text-red-400", done: true },
        { name: "TSH", value: "2.1", note: "In range", color: "text-emerald-400", done: true },
        { name: "Ferritin", value: "", note: "", color: "", done: false },
        { name: "Hemoglobin", value: "", note: "", color: "", done: false },
    ];

    return (
        <div className="max-w-[1080px] mx-auto px-10 py-12 animate-[fadeIn_0.4s_ease-out]">
            {/* Header row */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-7">
                <div>
                    <div className="font-mono text-[13px] text-indigo-400 mb-2">
                        03 / Delta as UI Primitive
                    </div>
                    <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">
                        Not faster. Different.
                    </h1>
                    <p className="text-neutral-400 max-w-[58ch] leading-relaxed text-sm">
                        Three render strategies, same data. Delta mode lets each insight resolve independently — the page builds itself.
                    </p>
                </div>
                
                {/* Controls */}
                <div className="flex flex-col gap-2.5 items-start md:items-end shrink-0">
                    {/* Render mode pills */}
                    <div className="flex gap-1 bg-neutral-900 border border-white/5 rounded-xl p-1 select-none">
                        {ch03Modes.map((k) => {
                            const active = ch03Mode === k;
                            return (
                                <button
                                    key={k}
                                    onClick={() => setCh03Mode(k)}
                                    className={`cursor-pointer font-mono text-[12px] font-semibold px-4 py-2 rounded-lg border-0 transition uppercase ${
                                        active
                                            ? "bg-indigo-500 text-white shadow-md"
                                            : "bg-transparent text-neutral-400 hover:text-white"
                                    }`}
                                >
                                    {k}
                                </button>
                            );
                        })}
                    </div>

                    {/* Network state toggle */}
                    <button
                        onClick={() => setCh03Net(prev => prev === "online" ? "offline" : "online")}
                        className={`cursor-pointer flex items-center gap-2 font-mono text-[11.5px] px-3 py-1.5 rounded-lg border transition ${
                            isOffline
                                ? "border-teal-500/20 bg-teal-500/10 text-teal-400 shadow-[0_0_15px_rgba(45,212,191,0.1)]"
                                : "border-white/5 bg-[#10131D] text-neutral-400 hover:bg-neutral-800"
                        }`}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${isOffline ? "bg-teal-400 animate-pulse" : "bg-neutral-400"}`} />
                        network: {ch03Net}
                    </button>
                </div>
            </div>

            {/* Offline Failover Alert */}
            {isOffline && (
                <div className="flex items-center gap-3 px-4.5 py-3 border border-teal-500/20 bg-teal-500/10 rounded-xl mb-[18px] animate-[fadeUp_0.35s_ease]">
                    <span className="font-mono text-[11px] text-teal-400 font-bold uppercase tracking-wider select-none shrink-0">
                        ● network cut mid-stream
                    </span>
                    <span className="text-[13px] text-neutral-300">
                        Source switched to the on-device model. No error, no flicker — the stream continued.
                    </span>
                </div>
            )}

            {/* Canvas Area */}
            <div className="bg-[#10131D] border border-white/5 rounded-2xl p-6.5 shadow-2xl min-h-[360px] flex flex-col justify-between">
                
                {/* Mode description caption */}
                <div className="font-mono text-[11.5px] text-neutral-500 select-none mb-6">
                    {ch03Caption}
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col justify-center">
                    {/* CLASSIC MODE */}
                    {ch03Mode === "classic" && (
                        <div className="flex flex-col items-center justify-center gap-4.5 h-[200px] animate-[fadeIn_0.3s_ease]">
                            <div className="w-8 h-8 border-2.5 border-white/10 border-t-indigo-500 rounded-full animate-spin" />
                            <div className="font-mono text-[13px] text-neutral-500">
                                waiting for full response…
                            </div>
                            <div className="font-mono text-[11px] text-neutral-600 select-none">
                                card renders only when 100% complete | ~2.4s blank
                            </div>
                        </div>
                    )}

                    {/* STREAM MODE */}
                    {ch03Mode === "stream" && (
                        <div className="max-w-[620px] mx-auto py-6 animate-[fadeIn_0.3s_ease]">
                            <p className="text-[15px] leading-relaxed text-white">
                                <StreamingText text={textToStream.slice(0, streamProgress)} active={true} />
                                <span className="text-neutral-600 select-none">
                                    {textToStream.slice(streamProgress)}
                                </span>
                            </p>
                            <div className="font-mono text-[11px] text-neutral-600 mt-8 select-none">
                                one stream | fills left -> right | structure arrives last
                            </div>
                        </div>
                    )}

                    {/* DELTA MODE */}
                    {ch03Mode === "delta" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 animate-[fadeIn_0.3s_ease]">
                            {deltaCards.map((c, idx) => {
                                const cardDot = c.done ? (isOffline ? "bg-teal-400" : "bg-indigo-400") : "bg-neutral-600";
                                return (
                                    <div
                                        key={idx}
                                        className="bg-[#161a28] border border-white/5 rounded-xl p-4 min-h-[118px] flex flex-col justify-between"
                                    >
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[12.5px] font-semibold text-white/95">
                                                {c.name}
                                            </span>
                                            <span className={`w-1.5 h-1.5 rounded-full ${cardDot}`} />
                                        </div>
                                        
                                        {c.done ? (
                                            <div className="flex-1 flex flex-col justify-end mt-2 animate-[fadeUp_0.3s_ease]">
                                                <div className={`font-mono text-xl font-bold ${c.color}`}>
                                                    {c.value}
                                                </div>
                                                <div className="text-[11px] text-neutral-500 mt-1 leading-snug">
                                                    {c.note}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex-1 flex flex-col justify-end mt-2">
                                                <ShimmerSkeleton rows={2} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Canvas Footer Label */}
                {ch03Mode === "delta" && (
                    <div className="font-mono text-[11px] text-neutral-600 mt-6 select-none">
                        each card resolves on its own delta | the slowest one never blocks the rest
                    </div>
                )}
            </div>
        </div>
    );
}
