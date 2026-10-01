import React from "react";

export default function Observable() {
    const ttftBars = [
        { label: "80", h: "34%", color: "bg-teal-400" },
        { label: "90", h: "52%", color: "bg-teal-400" },
        { label: "300", h: "88%", color: "bg-[#6E8BFF]" },
        { label: "400", h: "70%", color: "bg-[#6E8BFF]" },
        { label: "500", h: "46%", color: "bg-[#6E8BFF]" },
        { label: "600", h: "30%", color: "bg-[#6E8BFF]" },
        { label: "700", h: "16%", color: "bg-[#6E8BFF]" },
    ];

    return (
        <div className="max-w-[1040px] mx-auto px-10 py-12 animate-[fadeIn_0.4s_ease-out]">
            {/* Page Header */}
            <div className="mb-8">
                <div className="font-mono text-[13px] text-indigo-400 mb-2">
                    06 / Observable by Default
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">
                    Every inference, measured.
                </h1>
                <p className="text-neutral-400 max-w-[58ch] leading-relaxed text-sm">
                    Catalyst automatically instruments every AI call. See at a glance what ran where, how much it cost, and what latency users are experiencing.
                </p>
            </div>

            {/* Layout Grid: Stats + Charts */}
            <div className="grid grid-cols-1 md:grid-cols-[348px_1fr] gap-6 items-start">
                
                {/* Left side: Stats */}
                <div className="flex flex-col gap-4">
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-3.5 select-none">
                        <div className="bg-[#10131D] border border-white/5 rounded-xl p-4 shadow-md">
                            <div className="font-mono text-2xl font-bold text-white mb-0.5">12</div>
                            <div className="text-[10.5px] text-neutral-500 font-medium uppercase tracking-wider">inferences</div>
                        </div>
                        <div className="bg-[#10131D] border border-white/5 rounded-xl p-4 shadow-md">
                            <div className="font-mono text-2xl font-bold text-white mb-0.5">$0.0031</div>
                            <div className="text-[10.5px] text-neutral-500 font-medium uppercase tracking-wider">session cost</div>
                        </div>
                        <div className="bg-[#10131D] border border-white/5 rounded-xl p-4 shadow-md">
                            <div className="font-mono text-2xl font-bold text-teal-400 mb-0.5">3</div>
                            <div className="text-[10.5px] text-neutral-500 font-medium uppercase tracking-wider">local</div>
                        </div>
                        <div className="bg-[#10131D] border border-white/5 rounded-xl p-4 shadow-md">
                            <div className="font-mono text-2xl font-bold text-indigo-400 mb-0.5">9</div>
                            <div className="text-[10.5px] text-neutral-500 font-medium uppercase tracking-wider">cloud</div>
                        </div>
                    </div>

                    {/* Alert banner */}
                    <div className="flex items-center gap-3 px-4.5 py-3.5 border border-amber-500/20 bg-amber-500/5 rounded-xl select-none animate-[fadeUp_0.35s_ease]">
                        <span className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 text-lg shrink-0">
                            ⚠
                        </span>
                        <div className="text-xs text-neutral-300">
                            <span className="font-semibold text-white">2 fallbacks</span>
                            <span className="text-neutral-400 ml-1.5">— recovered to cloud</span>
                        </div>
                    </div>
                </div>

                {/* Right side: Latency Chart */}
                <div className="bg-[#10131D] border border-white/5 rounded-2xl p-6 shadow-2xl">
                    <div className="font-mono text-[12px] text-neutral-400 font-medium mb-8 select-none">
                        Time to First Token | ms
                    </div>

                    {/* Chart columns container */}
                    <div className="flex items-end gap-3.5 h-[160px] pb-1 border-b border-white/5">
                        {ttftBars.map((b, idx) => (
                            <div key={idx} className="flex-1 flex flex-col items-center gap-3 h-full justify-end group">
                                {/* Bar column */}
                                <div
                                    className={`w-full rounded-t-sm transition duration-300 origin-bottom hover:scale-x-105 ${b.color}`}
                                    style={{ height: b.h }}
                                />
                                {/* Label text */}
                                <span className="font-mono text-[9px] text-neutral-500 select-none group-hover:text-white transition">
                                    {b.label}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-4.5 mt-5 font-mono text-[9.5px] text-neutral-500 select-none">
                        <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                            Local (NPU / GPU)
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#6E8BFF]" />
                            Cloud (Server roundtrip)
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
