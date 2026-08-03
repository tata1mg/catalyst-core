import React from "react";
import FlowPipeline from "../../components/FlowPipeline";

export default function Pipeline() {
    const rawReport = `PATIENT 4471-B
NA 138 K 4.1 CL 102
GLU 112* CREA 0.9
ALT 31 AST 29
WBC 6.2 HGB 13.8
*flag: see notes
…342 more tokens`;

    return (
        <div className="max-w-[1120px] mx-auto px-10 py-12 animate-[fadeIn_0.4s_ease-out]">
            {/* Page Header */}
            <div className="mb-8">
                <div className="font-mono text-[13px] text-indigo-400 mb-2">
                    04 / Multi-model Pipeline
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">
                    Pay for what you need.
                </h1>
                <p className="text-neutral-400 max-w-[62ch] leading-relaxed text-sm">
                    Route the cheap, fast model at the noise; spend the smart model only on what matters. One <code className="font-mono text-white bg-white/5 px-1 py-0.5 rounded text-[0.9em]">useAI</code> pipeline, two stages, a fraction of the cost.
                </p>
            </div>

            {/* Split pipeline layout */}
            <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_1fr] border border-white/5 rounded-2xl overflow-hidden bg-[#10131D] shadow-2xl mb-1 select-none">
                
                {/* Raw Input Column */}
                <div className="p-[22px_18px] border-r border-white/5 bg-[#161a28]/60">
                    <div className="font-mono text-[10px] text-neutral-500 font-semibold mb-3 uppercase tracking-wider">
                        RAW REPORT IN
                    </div>
                    <pre className="font-mono text-[9.5px] leading-relaxed text-neutral-500 whitespace-pre-wrap">
                        {rawReport}
                    </pre>
                </div>

                {/* Stage 1: Extract */}
                <div className="p-6 border-r border-white/5 flex flex-col justify-between min-h-[220px]">
                    <div>
                        <div className="flex items-center gap-2 mb-3.5">
                            <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_#6E8BFF]" />
                            <span className="text-[14.5px] font-semibold text-white">Extract</span>
                            <span className="font-mono text-[9.5px] text-neutral-500 ml-auto uppercase font-bold tracking-wider">
                                fast model
                            </span>
                        </div>
                        <p className="text-[13px] text-neutral-400 leading-relaxed mb-6">
                            Pulls structured values out of the noise. No reasoning — just parsing.
                        </p>
                    </div>
                    
                    <div className="flex gap-6 mt-auto">
                        <div>
                            <div className="font-mono text-[9px] text-neutral-500 uppercase font-semibold mb-1">time</div>
                            <div className="font-mono text-[17px] font-semibold text-indigo-300">~80ms</div>
                        </div>
                        <div>
                            <div className="font-mono text-[9px] text-neutral-500 uppercase font-semibold mb-1">cost</div>
                            <div className="font-mono text-[17px] font-semibold text-neutral-300">$0.0002</div>
                        </div>
                    </div>
                </div>

                {/* Stage 2: Interpret */}
                <div className="p-6 flex flex-col justify-between min-h-[220px]">
                    <div>
                        <div className="flex items-center gap-2 mb-3.5">
                            <span className="w-2 h-2 rounded-full bg-teal-400 shadow-[0_0_10px_#2DD4BF]" />
                            <span className="text-[14.5px] font-semibold text-white">Interpret</span>
                            <span className="font-mono text-[9.5px] text-neutral-500 ml-auto uppercase font-bold tracking-wider">
                                smart model
                            </span>
                        </div>
                        <p className="text-[13px] text-neutral-400 leading-relaxed mb-6">
                            Explains clinical significance on the 6 values that were flagged. Reasoning only where it pays off.
                        </p>
                    </div>

                    <div className="flex gap-6 mt-auto">
                        <div>
                            <div className="font-mono text-[9px] text-neutral-500 uppercase font-semibold mb-1">time</div>
                            <div className="font-mono text-[17px] font-semibold text-teal-400">~900ms</div>
                        </div>
                        <div>
                            <div className="font-mono text-[9px] text-neutral-500 uppercase font-semibold mb-1">cost</div>
                            <div className="font-mono text-[17px] font-semibold text-neutral-300">$0.0040</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Pipeline SVG Stream */}
            <FlowPipeline active={true} />

            {/* Cost Ledger bottom panel */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 bg-[#10131D] border border-white/5 rounded-2xl p-5.5 shadow-2xl select-none">
                <div className="flex items-baseline gap-3.5">
                    <span className="font-mono text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">
                        pipeline total
                    </span>
                    <span className="font-mono text-3xl font-semibold text-teal-400 tracking-tight">
                        $0.0042
                    </span>
                </div>
                
                <div className="flex items-center gap-4.5">
                    <div className="text-left sm:text-right">
                        <div className="font-mono text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">
                            one smart model end-to-end
                        </div>
                        <div className="font-mono text-[17px] font-semibold text-neutral-600 line-through">
                            $0.0190
                        </div>
                    </div>
                    <div className="bg-teal-500/10 border border-teal-500/30 text-teal-400 font-mono text-[13px] font-bold px-3.5 py-2 rounded-xl">
                        −78%
                    </div>
                </div>
            </div>
        </div>
    );
}
