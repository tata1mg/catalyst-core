import React from "react";
import { Link } from "@tata1mg/router";

export default function Overview({ onNext, theme = "dark" }) {
    const palette = [
        { name: "Base", val: "#08090D", role: "--bg", bg: "bg-[#08090D]" },
        { name: "Surface", val: "#10131D", role: "--surface", bg: "bg-[#10131D]" },
        { name: "Iris — AI / cloud", val: "#6E8BFF", role: "--accent", bg: "bg-[#6E8BFF]" },
        { name: "Teal — on-device", val: "#2DD4BF", role: "--teal", bg: "bg-[#2DD4BF]" },
        { name: "Amber — warning", val: "#F5B544", role: "--amber", bg: "bg-[#F5B544]" },
    ];

    return (
        <div className="max-w-[1080px] mx-auto px-10 py-16 animate-[fadeIn_0.5s_ease-out]">
            {/* Design System Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-neutral-800 bg-neutral-900/60 font-mono text-[11.5px] text-neutral-400 mb-6 select-none">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_10px_#6E8BFF]" />
                design system v0.1 | dark + light
            </div>

            {/* Slogan & Intro */}
            <h1 className="text-5xl md:text-[52px] leading-[1.04] tracking-tight font-semibold text-white mb-5 max-w-[16ch]">
                AI as a first-class framework primitive.
            </h1>
            <p className="text-lg md:text-[18.5px] leading-relaxed text-neutral-400 max-w-[62ch] mb-3.5">
                Catalyst lets one React codebase run native on web, iOS and Android. Its core primitive is{" "}
                <code className="font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md text-[0.86em] border border-indigo-500/15">
                    useAI
                </code>{" "}
                — one hook for every kind of inference: cloud, on-device, in-browser.
            </p>
            <p className="text-lg md:text-[18.5px] leading-relaxed text-neutral-400 max-w-[62ch] mb-10">
                This isn't a product tour. Each chapter is one argument about what changes when AI stops being infrastructure you wire up, and starts being something you simply <em className="text-white not-italic font-medium">call</em>.
            </p>

            {/* System Reference grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
                {/* Palette */}
                <div className="bg-[#10131D] border border-white/5 rounded-2xl p-6 shadow-2xl">
                    <div className="text-[11px] tracking-wider uppercase text-neutral-500 font-semibold mb-4">
                        Palette
                    </div>
                    <div className="flex flex-col gap-3">
                        {palette.map((c, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <span className={`w-7.5 h-7.5 rounded-lg border border-white/10 ${c.bg} shrink-0`} />
                                <span className="text-[13px] font-medium text-white/90 flex-1">{c.name}</span>
                                <span className="font-mono text-[11.5px] text-neutral-500">{c.role}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Typography */}
                <div className="bg-[#10131D] border border-white/5 rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
                    <div>
                        <div className="text-[11px] tracking-wider uppercase text-neutral-500 font-semibold mb-4">
                            Type
                        </div>
                        <div className="text-3xl tracking-tight font-semibold text-white mb-1">
                            Geist
                        </div>
                        <div className="text-[12.5px] text-neutral-500 mb-[18px]">
                            Prose - 300–700
                        </div>
                    </div>
                    <div className="mt-auto">
                        <div className="font-mono text-[16px] text-indigo-300 bg-neutral-950/60 border border-white/5 rounded-lg p-3">
                            const &#123; data &#125; = useAI()
                        </div>
                        <div className="text-[12.5px] text-neutral-500 mt-2">
                            Geist Mono | code, metrics, labels
                        </div>
                    </div>
                </div>
            </div>

            {/* Interactive AI Demos */}
            <div className="mb-10">
                <div className="text-[11px] tracking-wider uppercase text-neutral-500 font-semibold mb-4">
                    Interactive AI Demos
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Link
                        to="/chess"
                        className="group flex flex-col justify-between p-6 rounded-2xl bg-[#10131D] border border-white/5 hover:border-indigo-500/30 hover:bg-indigo-950/10 transition shadow-2xl no-underline"
                    >
                        <div>
                            <div className="flex items-center gap-2.5 mb-2">
                                <span className="text-2xl">👑</span>
                                <h3 className="text-lg font-semibold text-white group-hover:text-indigo-400 transition">AI Chess</h3>
                            </div>
                            <p className="text-[13px] text-neutral-400 leading-relaxed">
                                Play chess against an AI opponent powered by local/cloud model inferences.
                            </p>
                        </div>
                        <div className="mt-5 font-mono text-[11.5px] text-indigo-400 flex items-center gap-1">
                            Play Game <span className="transition-transform group-hover:translate-x-1">→</span>
                        </div>
                    </Link>

                    <Link
                        to="/tic-tac-toe"
                        className="group flex flex-col justify-between p-6 rounded-2xl bg-[#10131D] border border-white/5 hover:border-teal-500/30 hover:bg-teal-950/10 transition shadow-2xl no-underline"
                    >
                        <div>
                            <div className="flex items-center gap-2.5 mb-2">
                                <span className="text-2xl">⭕</span>
                                <h3 className="text-lg font-semibold text-white group-hover:text-teal-400 transition">AI Tic-Tac-Toe</h3>
                            </div>
                            <p className="text-[13px] text-neutral-400 leading-relaxed">
                                Challenge the AI in a fast-paced game of Tic-Tac-Toe with on-device capabilities.
                            </p>
                        </div>
                        <div className="mt-5 font-mono text-[11.5px] text-teal-400 flex items-center gap-1">
                            Play Game <span className="transition-transform group-hover:translate-x-1">→</span>
                        </div>
                    </Link>
                </div>
            </div>

            {/* Start Button */}
            <button
                onClick={onNext}
                className="inline-flex items-center gap-2 cursor-pointer border-0 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-[14.5px] px-5 py-3 rounded-xl shadow-[0_10px_30px_-10px_rgba(110,139,255,0.5)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-12px_rgba(110,139,255,0.7)]"
            >
                Begin | Chapter 01 <span className="font-mono">→</span>
            </button>
        </div>
    );
}
