import React, { useState, useRef, useEffect } from "react";
import ShimmerSkeleton from "../../components/ShimmerSkeleton";

export default function HealthRecords() {
    const [ch01State, setCh01State] = useState("complete");
    const [dividerPct, setDividerPct] = useState(42);
    const containerRef = useRef(null);
    const dragBarRef = useRef(null);

    const handleMouseDown = (e) => {
        e.preventDefault();
        const move = (ev) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            let pct = ((ev.clientX - rect.left) / rect.width) * 100;
            pct = Math.max(18, Math.min(78, pct));
            setDividerPct(pct);
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    const ch01States = ["loading", "streaming", "complete", "error"];
    
    const ch01Meta = {
        loading: { text: "connecting…", color: "text-neutral-500", dotBg: "bg-neutral-500" },
        streaming: { text: "streaming | delta", color: "text-indigo-400", dotBg: "bg-indigo-400" },
        complete: { text: "complete | 6 cards", color: "text-teal-400", dotBg: "bg-teal-400" },
        error: { text: "fallback engaged", color: "text-amber-400", dotBg: "bg-amber-400" },
    }[ch01State];

    const labs = [
        { name: "Vitamin D (25-OH)", value: "18", unit: "ng/mL", flag: "LOW", ref: "30–100", note: "Below sufficiency. Consider 2000 IU daily; recheck in 8 weeks." },
        { name: "HbA1c", value: "5.9", unit: "%", flag: "HIGH", ref: "<5.7", note: "Prediabetic range. Lifestyle review recommended before next panel." },
        { name: "LDL Cholesterol", value: "142", unit: "mg/dL", flag: "HIGH", ref: "<100", note: "Elevated cardiovascular marker. Pairs with the HbA1c trend." },
        { name: "TSH", value: "2.1", unit: "mIU/L", flag: "NORMAL", ref: "0.4–4.0", note: "Thyroid function within range. No action needed." },
        { name: "Hemoglobin", value: "13.8", unit: "g/dL", flag: "NORMAL", ref: "13–17", note: "Healthy oxygen-carrying capacity." },
        { name: "Ferritin", value: "22", unit: "ng/mL", flag: "LOW", ref: "30–400", note: "Low iron stores despite normal hemoglobin. Monitor." },
    ];

    const flagColors = {
        HIGH: "text-red-400 border-red-500/20 bg-red-500/10",
        LOW: "text-amber-400 border-amber-500/20 bg-amber-500/10",
        NORMAL: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
    };

    const codeOld = `// actions.js
export const fetchInsights =
  (records) => async (dispatch) => {
    dispatch({ type: FETCH_START })
    const streams = records.map((r) =>
      openSSE(\`/api/insights/\${r.id}\`))
    streams.forEach((s, i) => {
      s.onmessage = (e) => dispatch({
        type: 'chunk', i, data: e.data })
      s.onerror = () =>
        retryWithBackoff(s, i)
    })
    pollUntilComplete(streams, dispatch)
  }

// reducer.js — 28 more cases
function insights(state = init, a) {
  switch (a.type) {
    case 'chunk':
      return mergeChunk(state, a)
    /* …error, retry, offline,
       partial, dedupe, gc… */
  }
}
// + middleware + selectors
// + 6 SSE managers + backoff`;

    const codeNew = `function LabInsights({ records }) {
  const { data, status } = useAI({
    task: 'health.insights',
    input: records,
    stream: 'delta',     // cards fill
    fallback: 'on-device' // works offline
  })

  return (
    <InsightGrid status={status}>
      {data.cards.map((c) => (
        <InsightCard key={c.id} {...c} />
      ))}
    </InsightGrid>
  )
}`;

    return (
        <div className="max-w-[1240px] mx-auto px-10 py-12 animate-[fadeIn_0.4s_ease-out]">
            {/* Header row */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
                <div>
                    <div className="font-mono text-[13px] text-indigo-400 mb-2">
                        01 / Health Records Rebuilt
                    </div>
                    <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">
                        Same UI. A fraction of the code.
                    </h1>
                    <p className="text-neutral-400 max-w-[60ch] leading-relaxed text-sm">
                        Drag the divider. Both implementations render the exact same insight cards below — one is 60+ lines of Redux, streaming and polling; the other is the hook.
                    </p>
                </div>
                
                {/* State selector buttons */}
                <div className="flex gap-2 flex-wrap">
                    {ch01States.map((k) => {
                        const active = ch01State === k;
                        return (
                            <button
                                key={k}
                                onClick={() => setCh01State(k)}
                                className={`cursor-pointer font-mono text-[11px] font-medium px-3.5 py-1.5 rounded-lg border transition ${
                                    active
                                        ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                                        : "bg-[#10131D] border-white/5 text-neutral-400 hover:bg-neutral-800"
                                }`}
                            >
                                {k}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Split panel code comparison */}
            <div
                ref={containerRef}
                className="relative border border-white/5 rounded-2xl overflow-hidden bg-[#0A0C13] shadow-2xl mb-8"
            >
                <div className="flex items-stretch min-h-[420px] select-none">
                    {/* BEFORE Panel */}
                    <div
                        className="shrink-0 overflow-hidden border-r border-white/5"
                        style={{ width: `${dividerPct}%` }}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-red-500/[0.04]">
                            <span className="font-mono text-[11px] text-red-400 font-semibold uppercase tracking-wider">
                                BEFORE | redux + sse + polling
                            </span>
                            <span className="font-mono text-[11px] text-neutral-500">64 lines</span>
                        </div>
                        <pre className="m-0 p-4.5 font-mono text-[11.5px] leading-relaxed text-neutral-500 overflow-hidden whitespace-pre">
                            {codeOld}
                        </pre>
                    </div>

                    {/* Draggable Divider */}
                    <div
                        ref={dragBarRef}
                        onMouseDown={handleMouseDown}
                        className="w-3.5 shrink-0 mx-[-7px] cursor-col-resize z-10 flex items-center justify-center relative group"
                    >
                        <div className="w-[1.5px] h-full bg-indigo-500/40 group-hover:bg-indigo-400 transition" />
                        <div className="absolute w-6 h-10 border border-white/10 rounded-lg bg-indigo-500 flex items-center justify-center shadow-lg pointer-events-none hover:scale-105 active:scale-95 transition">
                            <span className="text-white text-xs select-none tracking-[-1.5px]">‹›</span>
                        </div>
                    </div>

                    {/* AFTER Panel */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-indigo-500/10">
                            <span className="font-mono text-[11px] text-indigo-300 font-semibold uppercase tracking-wider">
                                AFTER | useAI
                            </span>
                            <span className="font-mono text-[11px] text-neutral-500">15 lines</span>
                        </div>
                        <pre className="m-0 p-4.5 font-mono text-[12.5px] leading-relaxed text-neutral-300 overflow-hidden whitespace-pre">
                            {codeNew}
                        </pre>
                    </div>
                </div>
            </div>

            {/* Live Preview Header */}
            <div className="flex items-center justify-between mb-4.5">
                <div className="text-sm text-neutral-400 font-medium">
                    Live preview — both panels produce this
                </div>
                <div className={`font-mono text-[11.5px] flex items-center gap-2 ${ch01Meta.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${ch01Meta.dotBg}`} />
                    {ch01Meta.text}
                </div>
            </div>

            {/* Error Fallback Banner */}
            {ch01State === "error" && (
                <div className="flex items-start md:items-center gap-3.5 p-4.5 border border-red-500/20 bg-red-500/[0.04] rounded-xl mb-5 animate-[fadeUp_0.35s_ease]">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 text-[16px] shrink-0">
                        ⚠
                    </div>
                    <div className="flex-1">
                        <div className="font-semibold text-[13.5px] text-white mb-0.5">
                            Cloud inference failed — recovered on device
                        </div>
                        <div className="text-xs text-neutral-400">
                            Network dropped mid-stream.{" "}
                            <span className="text-teal-400 font-medium">fallback: 'on-device'</span> picked it up with no error surfaced to the user.
                        </div>
                    </div>
                    <span className="font-mono text-[10px] text-teal-400 border border-teal-500/20 bg-teal-500/10 px-2.5 py-1 rounded-md shrink-0 select-none">
                        retry → local
                    </span>
                </div>
            )}

            {/* Insight cards grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {labs.map((card, i) => {
                    const showSkeleton = ch01State === "loading" || (ch01State === "streaming" && i >= 4);
                    const showText = ch01State === "complete" || (ch01State === "streaming" && i < 4) || (ch01State === "error" && i < 5);
                    const showCaret = ch01State === "streaming" && i === 3;
                    const isLocal = ch01State === "error" && i >= 4;
                    const src = isLocal ? "on-device" : "cloud";
                    const srcColor = isLocal ? "bg-teal-400" : "bg-indigo-400";
                    const flagStyle = flagColors[card.flag];

                    return (
                        <div
                            key={i}
                            className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-md flex flex-col relative overflow-hidden"
                        >
                            {/* Card Top Row */}
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[13.5px] font-semibold text-white/90 tracking-tight">
                                    {card.name}
                                </span>
                                <span className={`font-mono text-[9px] font-semibold px-2 py-0.5 border rounded-md ${flagStyle}`}>
                                    {card.flag}
                                </span>
                            </div>

                            {/* Card Value Row */}
                            <div className="flex items-baseline gap-1.5 mb-3.5">
                                <span className={`text-[26px] font-semibold tracking-tight font-mono ${
                                    card.flag === "HIGH" ? "text-red-400" : card.flag === "LOW" ? "text-amber-400" : "text-emerald-400"
                                }`}>
                                    {showSkeleton ? "—" : card.value}
                                </span>
                                <span className="text-xs text-neutral-500 font-medium">
                                    {card.unit}
                                </span>
                            </div>

                            {/* Note / Skeleton Content */}
                            <div className="flex-1">
                                {showText && (
                                    <p className="text-[12.5px] leading-relaxed text-neutral-400">
                                        {card.note}
                                        {showCaret && (
                                            <span className="inline-block w-1.5 h-3 bg-indigo-500 ml-0.5 align-baseline animate-pulse" />
                                        )}
                                    </p>
                                )}
                                {showSkeleton && <ShimmerSkeleton rows={2} />}
                            </div>

                            {/* Card Footer */}
                            <div className="font-mono text-[10px] text-neutral-500 mt-4 pt-3 border-t border-white/5 flex items-center gap-1.5 select-none">
                                <span className={`w-1 h-1 rounded-full ${srcColor}`} />
                                {src} | ref {card.ref}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
