import React, { useState } from "react";

export default function LocalModel() {
    const [ch05Source, setCh05Source] = useState("cloud");
    const isCloud = ch05Source === "cloud";

    const ch05Sources = ["cloud", "local"];

    const cloudBorder = isCloud ? "border-indigo-500/40" : "border-red-500/20";
    const cloudStatus = isCloud ? "streaming" : "network lost";
    const cloudStatusColor = isCloud ? "text-indigo-400" : "text-red-400";
    const cloudTtft = isCloud ? "580ms" : "failed";
    const cloudTtftColor = isCloud ? "text-indigo-300" : "text-red-400";
    const cloudNote = isCloud 
        ? "Round-trips to the inference endpoint. Fast — but it owns your data and your uptime."
        : "Request dropped the moment the connection cut. Nothing to recover from on the server side.";

    const localBorder = isCloud ? "border-white/5" : "border-teal-500/40";
    const localTtft = isCloud ? "idle" : "94ms";
    const localNote = isCloud 
        ? "Not warmed up. Flip the switch to load the model into the browser."
        : "Already resident in the browser. The network cut never touched it — the stream never paused.";

    const explainerText = isCloud
        ? "Default path. Lowest cold-start, but every token round-trips to the server and depends on the network."
        : "First run downloads 287MB and warms up (~3s). After that, inference is fully on-device and offline-proof.";

    return (
        <div className="max-w-[1040px] mx-auto px-10 py-12 animate-[fadeIn_0.4s_ease-out]">
            {/* Header row */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
                <div>
                    <div className="font-mono text-[13px] text-indigo-400 mb-2">
                        05 / Local Model
                    </div>
                    <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">
                        Your data never leaves.
                    </h1>
                    <p className="text-neutral-400 max-w-[54ch] leading-relaxed text-sm">
                        Same prompt, same output. Flip to local and inference runs in the browser — then cut the network and watch which one survives.
                    </p>
                </div>

                {/* Cloud/Local selector */}
                <div className="flex gap-1 bg-neutral-900 border border-white/5 rounded-xl p-1 shrink-0 select-none">
                    {ch05Sources.map((k) => {
                        const active = ch05Source === k;
                        return (
                            <button
                                key={k}
                                onClick={() => setCh05Source(k)}
                                className={`cursor-pointer font-mono text-[12px] font-semibold px-5 py-2.5 rounded-lg border-0 transition uppercase ${
                                    active
                                        ? "bg-indigo-50 text-white shadow-md"
                                        : "bg-transparent text-neutral-400 hover:text-white"
                                }`}
                            >
                                {k}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Benchmark Columns Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                
                {/* Cloud card */}
                <div className={`bg-[#10131D] border rounded-2xl p-5.5 shadow-2xl transition duration-300 ${cloudBorder}`}>
                    <div className="flex justify-between items-center mb-4.5">
                        <span className="text-[13.5px] font-semibold text-white/90 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                            Cloud
                        </span>
                        <span className={`font-mono text-[11px] font-semibold ${cloudStatusColor}`}>
                            {cloudStatus}
                        </span>
                    </div>
                    <div className={`font-mono text-3xl font-semibold leading-none mb-3 ${cloudTtftColor}`}>
                        {cloudTtft}
                    </div>
                    <div className="h-[1px] bg-white/5 my-4" />
                    <p className="text-[12.5px] leading-relaxed text-neutral-400">
                        {cloudNote}
                    </p>
                </div>

                {/* Local card */}
                <div className={`bg-[#10131D] border rounded-2xl p-5.5 shadow-2xl transition duration-300 ${localBorder}`}>
                    <div className="flex justify-between items-center mb-4.5">
                        <span className="text-[13.5px] font-semibold text-white/90 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                            Local | in-browser
                        </span>
                        <span className="font-mono text-[11.5px] font-semibold text-teal-400 uppercase tracking-wider">
                            🔒 on device
                        </span>
                    </div>
                    <div className="font-mono text-3xl font-semibold leading-none text-teal-400 mb-3">
                        {localTtft}
                    </div>
                    <div className="h-[1px] bg-white/5 my-4" />
                    <p className="text-[12.5px] leading-relaxed text-neutral-400">
                        {localNote}
                    </p>
                </div>
            </div>

            {/* Explainer / Progress panel */}
            <div className="bg-[#10131D] border border-white/5 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
                <div className="flex-1">
                    <div className="font-mono text-[11px] text-neutral-500 uppercase tracking-wider font-semibold mb-1">
                        {isCloud ? "Cloud inference | live" : "Local model | ready"}
                    </div>
                    <p className="text-[13px] text-neutral-400 leading-relaxed max-w-[64ch]">
                        {explainerText}
                    </p>
                </div>
                
                {/* Stats / Progress meter */}
                <div className="flex flex-col items-start sm:items-end justify-center">
                    <div className="font-mono text-[13px] font-semibold text-white mb-1">
                        {isCloud ? "100%" : "287MB cached"}
                    </div>
                    <div className="w-36 h-1.5 bg-neutral-900 border border-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: "100%" }} />
                    </div>
                </div>
            </div>
        </div>
    );
}
