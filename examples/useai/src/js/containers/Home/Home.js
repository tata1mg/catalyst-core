import React, { useState, useEffect } from "react";
import Overview from "../../pages/Overview/Overview";
import HealthRecords from "../../pages/HealthRecords/HealthRecords";
import CameraAI from "../../pages/CameraAI/CameraAI";
import Delta from "../../pages/Delta/Delta";
import Pipeline from "../../pages/Pipeline/Pipeline";
import LocalModel from "../../pages/LocalModel/LocalModel";
import Observable from "../../pages/Observable/Observable";

import PhoneFrame from "../../components/PhoneFrame";
import ShimmerSkeleton from "../../components/ShimmerSkeleton";

import { useParams, Link } from "@tata1mg/router";
import { useNativeTransition } from "catalyst-core/hooks";

export default function Home() {
    const params = useParams();
    const chapter = params.chapter || "overview";
    
    const { navigate } = useNativeTransition({
        type: "slide",
        direction: "up",
        duration: 400,
    });

    const setChapter = (newChapter) => {
        if (newChapter === "overview") {
            navigate("/");
        } else {
            navigate(`/${newChapter}`);
        }
    };

    const [theme, setTheme] = useState("dark");
    const [view, setView] = useState("desktop");
    const [isMobileScreen, setIsMobileScreen] = useState(false);

    // Chapter 01 mobile state
    const [ch01StateMobile, setCh01StateMobile] = useState("complete");
    // Chapter 03 mobile state
    const [ch03ModeMobile, setCh03ModeMobile] = useState("delta");
    // Chapter 05 mobile state
    const [ch05SourceMobile, setCh05SourceMobile] = useState("cloud");

    const isDesk = view === "desktop";

    // Automatically detect viewport size on mount and window resize
    useEffect(() => {
        const handleResize = () => {
            const isMobile = window.innerWidth <= 768 || (typeof window !== "undefined" && (!!window.NativeBridge || !!window.webkit?.messageHandlers?.NativeBridge));
            setIsMobileScreen(isMobile);
            if (isMobile) {
                setView("mobile");
            }
        };

        handleResize(); // run on mount

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // Synchronize HTML data-theme attribute for global CSS variables
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
    }, [theme]);

    const chapters = [
        { id: "01", title: "Health Records Rebuilt", tag: "Same UI. A fraction of the code." },
        { id: "02", title: "Camera + AI", tag: "Native primitives that think." },
        { id: "03", title: "Delta as UI Primitive", tag: "Not faster. Different." },
        { id: "04", title: "Multi-model Pipeline", tag: "Pay for what you need." },
        { id: "05", title: "Local Model", tag: "Your data never leaves." },
        { id: "06", title: "Observable by Default", tag: "Every inference, measured." },
    ];

    const ch03Modes = ["classic", "stream", "delta"];
    const ch05Sources = ["cloud", "local"];

    const cur = chapters.find((c) => c.id === chapter);
    const crumbNum = chapter === "overview" ? "00" : cur ? cur.id : "00";
    const crumbTitle = chapter === "overview" ? "Overview" : cur ? cur.title : "Overview";

    const startCh1 = () => setChapter("01");

    // Chapter 1 helper labs for mobile view
    const labsMobile = [
        { name: "Vitamin D (25-OH)", value: "18", unit: "ng/mL", flag: "LOW", flagBg: "bg-amber-500/10 border-amber-500/20", flagColor: "text-amber-400" },
        { name: "HbA1c", value: "5.9", unit: "%", flag: "HIGH", flagBg: "bg-red-500/10 border-red-500/20", flagColor: "text-red-400" },
        { name: "LDL Cholesterol", value: "142", unit: "mg/dL", flag: "HIGH", flagBg: "bg-red-500/10 border-red-500/20", flagColor: "text-red-400" },
    ];

    // Chapter 3 helper cards for mobile view
    const deltaCardsMobile = [
        { name: "Vitamin D", value: "18", note: "Low — supplement", color: "text-amber-400", done: true },
        { name: "HbA1c", value: "5.9%", note: "Prediabetic range", color: "text-red-400", done: true },
        { name: "LDL", value: "142", note: "Above target", color: "text-red-400", done: true },
        { name: "TSH", value: "2.1", note: "In range", color: "text-emerald-400", done: true },
    ].map(c => ({ ...c, dot: c.done ? (ch05SourceMobile === "local" ? "bg-teal-400" : "bg-indigo-400") : "bg-neutral-600" }));

    // Chapter 6 helper TTFT bars for mobile view
    const ttftBarsMobile = [
        { label: "80", h: "34%", color: "bg-teal-400" },
        { label: "90", h: "52%", color: "bg-teal-400" },
        { label: "300", h: "88%", color: "bg-[#6E8BFF]" },
        { label: "400", h: "70%", color: "bg-[#6E8BFF]" },
        { label: "500", h: "46%", color: "bg-[#6E8BFF]" },
    ];

    // Reusable mobile view subpage builder
    const renderMobileViewport = (isMockup = false) => {
        return (
            <div className={`flex flex-col flex-1 min-h-0 select-none ${
                isMockup ? "absolute inset-x-0 bottom-0 top-14 pt-0" : "pt-2"
            }`}>
                
                {/* Scrollable Viewport */}
                <div className="flex-1 overflow-y-auto px-[18px] pb-6 relative">
                    
                    {/* MOBILE OVERVIEW */}
                    {chapter === "overview" && (
                        <div className="py-2.5 animate-[fadeIn_0.3s_ease]">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 border border-[var(--border-2)] rounded-full font-mono text-[10.5px] text-neutral-400 mb-5.5">
                                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
                                useAI | showcase
                            </div>
                            <h1 className="text-3xl leading-[1.08] tracking-tight font-semibold text-white mb-4">
                                AI as a first-class primitive.
                            </h1>
                            <p className="text-[14px] leading-relaxed text-neutral-400 mb-6.5">
                                One React codebase, native on every platform. One hook for cloud, on-device and in-browser inference. Tap a chapter below.
                            </p>
                            <button
                                onClick={startCh1}
                                className="w-full cursor-pointer border-0 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-[14px] py-3 rounded-xl shadow-md transition mb-3.5"
                            >
                                Begin | Chapter 01 →
                            </button>
                            <Link
                                to="/ai-test"
                                className="w-full text-center block cursor-pointer border border-[var(--border-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-white font-semibold text-[14px] py-3 rounded-xl shadow-md transition no-underline"
                            >
                                Open AI Test Dashboard 🧪
                            </Link>
                            <div className="grid grid-cols-2 gap-3 mt-3">
                                <Link
                                    to="/chess"
                                    className="text-center block cursor-pointer border border-[var(--border-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-white font-semibold text-[13px] py-2.5 rounded-xl shadow-md transition no-underline"
                                >
                                    👑 AI Chess
                                </Link>
                                <Link
                                    to="/tic-tac-toe"
                                    className="text-center block cursor-pointer border border-[var(--border-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-white font-semibold text-[13px] py-2.5 rounded-xl shadow-md transition no-underline"
                                >
                                    ⭕ Tic-Tac-Toe
                                </Link>
                            </div>
                        </div>
                    )}

                    {/* MOBILE CH01: Health Records */}
                    {chapter === "01" && (
                        <div className="py-2 animate-[fadeIn_0.3s_ease]">
                            <div className="font-mono text-[11px] text-indigo-400 mb-1.5">
                                01 / Health Records
                            </div>
                            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white mb-4.5">
                                Same UI.<br />A fraction of the code.
                            </h1>
                            <div className="flex flex-col gap-2.5 mb-5 select-none">
                                <div className="bg-red-500/[0.07] border border-red-500/25 rounded-xl p-3.5">
                                    <div className="flex justify-between items-center">
                                        <span className="font-mono text-[10.5px] text-red-400 font-semibold tracking-wider uppercase">
                                            BEFORE | redux+sse
                                        </span>
                                        <span className="font-mono text-[17px] font-bold text-red-400">64</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-[var(--surface-3)] mt-2.5">
                                        <div className="h-full w-full rounded-full bg-red-500/60" />
                                    </div>
                                </div>
                                <div className="bg-[var(--accent-dim)] border border-[var(--accent-line)] rounded-xl p-3.5">
                                    <div className="flex justify-between items-center">
                                        <span className="font-mono text-[10.5px] text-indigo-300 font-semibold tracking-wider uppercase">
                                            AFTER | useAI
                                        </span>
                                        <span className="font-mono text-[17px] font-bold text-indigo-300">15</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-[var(--surface-3)] mt-2.5">
                                        <div className="h-full w-[23%] rounded-full bg-indigo-500" />
                                    </div>
                                </div>
                            </div>

                            <div className="text-[12px] text-neutral-500 font-semibold mb-3">
                                Live preview | streaming insights
                            </div>
                            <div className="flex flex-col gap-2.5">
                                {labsMobile.map((card, idx) => (
                                    <div
                                        key={idx}
                                        className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 shadow"
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[13px] font-semibold text-white/95">{card.name}</span>
                                            <span className={`font-mono text-[9px] font-semibold px-2 py-0.5 border rounded-md ${card.flagBg} ${card.flagColor}`}>
                                                {card.flag}
                                            </span>
                                        </div>
                                        <div className="flex items-baseline gap-1.5">
                                            <span className={`text-[21px] font-semibold font-mono ${card.flagColor}`}>{card.value}</span>
                                            <span className="text-[10px] text-neutral-500 font-medium">{card.unit}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* MOBILE CH02: Camera + AI (Full-bleed simulation) */}
                    {chapter === "02" && (
                        <div className={`absolute inset-0 flex flex-col bg-gradient-to-b from-[#1a1d27] to-[#07080c] select-none ${
                            isMockup ? "pt-0 pb-16" : "pt-0 pb-16"
                        }`}>
                            <div className="absolute top-2.5 left-4 z-10 font-mono text-[11px] text-indigo-400">
                                02 / Camera + AI
                            </div>
                            <div className="absolute top-2 z-10 right-3.5 flex items-center gap-1.5 bg-teal-500/10 border border-teal-500/30 text-teal-400 font-mono text-[9px] font-semibold px-2 py-0.5 rounded-md shadow-md">
                                🔒 PROTECTED
                            </div>

                            {/* viewfinder */}
                            <div className="flex-1 relative mx-4 mt-10 mb-3 bg-black/10 rounded-2xl overflow-hidden border border-white/5 flex items-center justify-center">
                                {/* report document */}
                                <div className="w-[82%] bg-gradient-to-b from-[#f4f1ea] to-[#e6e2d8] rounded-lg rotate-[-2deg] shadow-2xl p-4.5 font-mono text-[8px] text-neutral-700">
                                    <div className="font-bold text-neutral-800 tracking-wider text-center border-b border-neutral-400/60 pb-1.5 mb-2.5">
                                        METRO DIAGNOSTICS | LAB REPORT
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex justify-between">
                                            <span>GLUCOSE, FASTING</span>
                                            <span className="font-bold text-neutral-900">112 mg/dL</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>CHOLESTEROL</span>
                                            <span className="font-bold text-neutral-900">186 mg/dL</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>HDL</span>
                                            <span className="font-bold text-neutral-900">41 mg/dL</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>TRIGLYCERIDES</span>
                                            <span className="font-bold text-neutral-900">168 mg/dL</span>
                                        </div>
                                    </div>
                                </div>

                                {/* brackets */}
                                <div className="absolute top-[32px] left-[20px] w-5 h-5 border-l-2 border-t-2 border-indigo-500 rounded-tl-xs" />
                                <div className="absolute top-[32px] right-[20px] w-5 h-5 border-r-2 border-t-2 border-indigo-500 rounded-tr-xs" />
                                <div className="absolute bottom-[32px] left-[20px] w-5 h-5 border-l-2 border-b-2 border-indigo-500 rounded-bl-xs" />
                                <div className="absolute bottom-[32px] right-[20px] w-5 h-5 border-r-2 border-b-2 border-indigo-500 rounded-br-xs" />

                                {/* scanning line */}
                                <div className="absolute top-[130px] left-[20px] right-[20px] h-[1.5px] bg-indigo-500/80 shadow-[0_0_10px_#6E8BFF]" />
                            </div>

                            {/* result popup overlay */}
                            <div className="mx-4 mb-2 bg-[var(--bg-2)] border border-white/10 rounded-xl p-3 shadow-xl shrink-0">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-mono text-[9.5px] text-teal-400 font-semibold tracking-wider">
                                        ● EXTRACTED | on-device
                                    </span>
                                    <span className="font-mono text-[9px] text-neutral-500 font-medium">38ms</span>
                                </div>
                                
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="text-[13px] font-semibold text-white">Glucose, Fasting</div>
                                        <div className="font-mono text-[10px] text-neutral-500 mt-0.5">ref 70–99 mg/dL</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-mono text-lg font-semibold text-amber-400 leading-none">112</div>
                                        <span className="inline-block font-mono text-[8px] font-bold text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded-sm border border-amber-500/20 mt-1 uppercase">
                                            HIGH
                                        </span>
                                    </div>
                                </div>
                                <div className="text-[10px] text-neutral-500 leading-relaxed mt-2">
                                    No upload | the image never left the device.
                                </div>
                            </div>
                        </div>
                    )}

                    {/* MOBILE CH03: Delta */}
                    {chapter === "03" && (
                        <div className="py-2 animate-[fadeIn_0.3s_ease]">
                            <div className="font-mono text-[11px] text-indigo-400 mb-1.5">
                                03 / Delta
                            </div>
                            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white mb-4.5">
                                Not faster.<br />Different.
                            </h1>
                            <div className="flex gap-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-1 mb-4 select-none">
                                {ch03Modes.map((k) => {
                                    const active = ch03ModeMobile === k;
                                    return (
                                        <button
                                            key={k}
                                            onClick={() => setCh03ModeMobile(k)}
                                            className={`flex-1 cursor-pointer font-mono text-[11px] font-semibold py-2 rounded-lg border-0 transition capitalize ${
                                                active
                                                    ? "bg-indigo-50 text-white shadow-md"
                                                    : "bg-transparent text-neutral-400"
                                            }`}
                                        >
                                            {k}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                                {deltaCardsMobile.map((c, idx) => (
                                    <div
                                        key={idx}
                                        className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 min-h-[92px] flex flex-col justify-between"
                                    >
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[12px] font-semibold text-white/95">{c.name}</span>
                                            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                                        </div>
                                        {c.done ? (
                                            <div>
                                                <div className={`font-mono text-[17px] font-bold ${c.color}`}>{c.value}</div>
                                                <div className="text-[10px] text-neutral-500 mt-0.5 leading-snug">{c.note}</div>
                                            </div>
                                        ) : (
                                            <ShimmerSkeleton rows={2} />
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="font-mono text-[10.5px] text-neutral-500 mt-4 leading-normal select-none">
                                each card resolves on its own delta | the slowest never blocks the rest
                            </div>
                        </div>
                    )}

                    {/* MOBILE CH04: Pipeline */}
                    {chapter === "04" && (
                        <div className="py-2 animate-[fadeIn_0.3s_ease]">
                            <div className="font-mono text-[11px] text-indigo-400 mb-1.5">
                                04 / Multi-model Pipeline
                            </div>
                            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white mb-4.5">
                                Pay for<br />what you need.
                            </h1>
                            <div className="flex flex-col gap-0 items-center">
                                <div className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3.5 font-mono text-[9px] text-neutral-400 line-clamp-1">
                                    RAW REPORT | NA 138 K 4.1 GLU 112* … 342 tokens
                                </div>
                                <div className="w-[1.5px] h-4.5 bg-indigo-500" />
                                <div className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                        <span className="text-[13.5px] font-semibold text-white">Extract</span>
                                        <span className="ml-auto font-mono text-[9.5px] text-neutral-500 font-bold uppercase tracking-wider">fast</span>
                                    </div>
                                    <div className="flex gap-4">
                                        <span className="font-mono text-[14.5px] font-semibold text-indigo-300">~80ms</span>
                                        <span className="font-mono text-[14.5px] font-semibold text-neutral-400">$0.0002</span>
                                    </div>
                                </div>
                                <div className="w-[1.5px] h-4.5 bg-teal-400" />
                                <div className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                                        <span className="text-[13.5px] font-semibold text-white">Interpret</span>
                                        <span className="ml-auto font-mono text-[9.5px] text-neutral-500 font-bold uppercase tracking-wider">smart</span>
                                    </div>
                                    <div className="flex gap-4">
                                        <span className="font-mono text-[14.5px] font-semibold text-teal-400">~900ms</span>
                                        <span className="font-mono text-[14.5px] font-semibold text-neutral-400">$0.0040</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between mt-5 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow">
                                <div>
                                    <div className="font-mono text-[10px] text-neutral-500 font-bold uppercase tracking-wider">total</div>
                                    <div className="font-mono text-2xl font-bold text-teal-400">$0.0042</div>
                                </div>
                                <div className="bg-teal-500/10 border border-teal-500/30 text-teal-400 font-mono text-[12.5px] font-bold px-3 py-1.5 rounded-lg shadow-sm">
                                    −78%
                                </div>
                            </div>
                        </div>
                    )}

                    {/* MOBILE CH05: Local Model */}
                    {chapter === "05" && (
                        <div className="py-2 animate-[fadeIn_0.3s_ease]">
                            <div className="font-mono text-[11px] text-indigo-400 mb-1.5">
                                05 / Local Model
                            </div>
                            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white mb-4.5">
                                Your data<br />never leaves.
                            </h1>
                            
                            <div className="flex gap-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-1 mb-4 select-none">
                                {ch05Sources.map((k) => {
                                    const active = ch05SourceMobile === k;
                                    return (
                                        <button
                                            key={k}
                                            onClick={() => setCh05SourceMobile(k)}
                                            className={`flex-1 cursor-pointer font-mono text-[11px] font-semibold py-2 rounded-lg border-0 transition uppercase ${
                                                active
                                                    ? "bg-indigo-50 text-white shadow-md"
                                                    : "bg-transparent text-neutral-400"
                                            }`}
                                        >
                                            {k}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex flex-col gap-2.5">
                                <div className={`bg-[var(--surface)] border rounded-xl p-4 shadow transition ${
                                    ch05SourceMobile === "cloud" ? "border-indigo-500/30" : "border-red-500/15"
                                }`}>
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[12.5px] font-semibold text-white/90 flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
                                            Cloud
                                        </span>
                                        <span className={`font-mono text-[10px] font-semibold ${ch05SourceMobile === "cloud" ? "text-indigo-400" : "text-red-400"}`}>
                                            {ch05SourceMobile === "cloud" ? "streaming" : "network lost"}
                                        </span>
                                    </div>
                                    <div className={`font-mono text-2xl font-semibold leading-none ${ch05SourceMobile === "cloud" ? "text-indigo-300" : "text-red-400"}`}>
                                        {ch05SourceMobile === "cloud" ? "580ms" : "failed"}
                                    </div>
                                </div>

                                <div className={`bg-[var(--surface)] border rounded-xl p-4 shadow transition ${
                                    ch05SourceMobile === "local" ? "border-teal-500/30" : "border-[var(--border)]"
                                }`}>
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[12.5px] font-semibold text-white/90 flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 bg-teal-400 rounded-full" />
                                            Local
                                        </span>
                                        <span className="font-mono text-[10px] font-semibold text-teal-400 uppercase tracking-wider">🔒 device</span>
                                    </div>
                                    <div className="font-mono text-2xl font-semibold leading-none text-teal-400">
                                        {ch05SourceMobile === "cloud" ? "idle" : "94ms"}
                                    </div>
                                </div>
                            </div>
                            <div className="text-[12px] text-neutral-400 leading-relaxed mt-4">
                                {ch05SourceMobile === "cloud" 
                                    ? "Round-trips to the server. Fast, but depends on active network."
                                    : "Runs locally in browser. Network cuts will not affect generation."}
                            </div>
                        </div>
                    )}

                    {/* MOBILE CH06: Observable */}
                    {chapter === "06" && (
                        <div className="py-2 animate-[fadeIn_0.3s_ease]">
                            <div className="font-mono text-[11px] text-indigo-400 mb-1.5">
                                06 / Observable by Default
                            </div>
                            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white mb-4.5">
                                Every inference,<br />measured.
                            </h1>
                            
                            <div className="grid grid-cols-2 gap-2 mb-3 select-none">
                                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 shadow-sm">
                                    <div className="font-mono text-[17px] font-bold text-white">12</div>
                                    <div className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">inferences</div>
                                </div>
                                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 shadow-sm">
                                    <div className="font-mono text-[17px] font-bold text-white">$0.0031</div>
                                    <div className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">cost</div>
                                </div>
                                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 shadow-sm">
                                    <div className="font-mono text-[17px] font-bold text-teal-400">3</div>
                                    <div className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider font-mono">local</div>
                                </div>
                                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 shadow-sm">
                                    <div className="font-mono text-[17px] font-bold text-indigo-400">9</div>
                                    <div className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider font-mono">cloud</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 px-3 py-2 border border-amber-500/20 bg-amber-500/5 rounded-lg mb-4 select-none">
                                <span className="text-amber-400 text-sm">⚠</span>
                                <div className="text-[11px] text-neutral-300">
                                    <span className="font-semibold text-white">2 fallbacks</span>
                                    <span className="text-neutral-500 ml-1">— cloud recovered</span>
                                </div>
                            </div>

                            {/* Mini Chart */}
                            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 shadow">
                                <div className="font-mono text-[10px] text-neutral-400 font-semibold mb-4 select-none">
                                    TTFT | ms
                                </div>
                                <div className="flex items-end gap-2.5 h-[80px] pb-0.5 border-b border-white/5">
                                    {ttftBarsMobile.map((b, idx) => (
                                        <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                                            <div className={`w-full rounded-t-sm ${b.color}`} style={{ height: b.h }} />
                                            <span className="font-mono text-[8px] text-neutral-500">{b.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        );
    };

    // Mobile Viewport Bottom Nav Drawer Helper
    const renderMobileBottomNavBar = () => {
        return (
            <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none scroll-smooth">
                <button
                    onClick={() => setChapter("overview")}
                    className={`shrink-0 flex items-center justify-center font-semibold text-[15px] w-9 h-9 rounded-xl border transition cursor-pointer ${
                        chapter === "overview"
                            ? "bg-indigo-500 border-indigo-500 text-white shadow-md"
                            : "bg-[var(--surface-2)] border-[var(--border)] text-neutral-400 hover:text-white"
                    }`}
                >
                    ⌂
                </button>
                
                {chapters.map((n) => (
                    <button
                        key={n.id}
                        onClick={() => setChapter(n.id)}
                        className={`shrink-0 font-mono text-[11.5px] font-bold w-9 h-9 rounded-xl border transition cursor-pointer ${
                            chapter === n.id
                                ? "bg-indigo-500 border-indigo-500 text-white shadow-md"
                                : "bg-[var(--surface-2)] border-[var(--border)] text-neutral-400 hover:text-white"
                        }`}
                    >
                        {n.id}
                    </button>
                ))}
            </div>
        );
    };

    // If viewing on actual mobile screen sizes, output the pure mobile view directly
    if (isMobileScreen) {
        return (
            <div className="flex flex-col min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-250 font-sans relative">
                {/* Mobile View Header */}
                <header className="flex-none h-14 flex items-center justify-between px-4.5 border-b border-[var(--border)] bg-[var(--bg-2)]/45 backdrop-blur-md">
                    <span className="font-semibold text-sm text-white">useAI | Showcase</span>
                    <div className="flex items-center gap-3">
                        <Link
                            to="/ai-test"
                            className="text-[15.5px] hover:scale-110 transition cursor-pointer select-none no-underline"
                            title="Go to AI Test Dashboard"
                        >
                            🧪
                        </Link>
                        <div className="flex items-center gap-1.5 font-mono text-[10px] text-teal-400 font-semibold select-none">
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_10px_#2DD4BF] animate-pulse" />
                            live
                        </div>
                    </div>
                </header>

                {/* Mobile Scroll Area */}
                <div className="flex-grow min-h-0 relative flex flex-col">
                    {renderMobileViewport(false)}
                </div>

                {/* Mobile bottom tabs menu bar */}
                <div className="flex-none border-t border-[var(--border)] bg-[var(--bg-2)]/95 backdrop-blur-md px-3.5 py-3.5 pb-6">
                    {renderMobileBottomNavBar()}
                </div>
            </div>
        );
    }

    // Otherwise, render full screen Desktop view with Sidebar and layout switcher
    return (
        <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-250 select-none font-sans">
            
            {/* ================= SIDEBAR ================= */}
            <aside className="w-72 shrink-0 sticky top-0 self-start h-screen bg-[var(--bg-2)] border-r border-[var(--border)] flex flex-col p-6.5">
                {/* Logo & Header */}
                <div className="flex items-center gap-3 pb-5.5 border-b border-[var(--border)] mb-6">
                    <div className="w-7.5 h-7.5 rounded-lg bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center shadow-[0_6px_18px_-6px_#6E8BFF]">
                        <div className="w-2.5 h-2.5 rounded-[2px] bg-[var(--bg-2)]" />
                    </div>
                    <div>
                        <div className="font-semibold text-[15px] tracking-tight leading-none text-white">Catalyst</div>
                        <div className="text-[10.5px] text-neutral-500 font-mono tracking-wider mt-1 uppercase">useAI | showcase</div>
                    </div>
                </div>

                {/* Sidebar Navigation */}
                <div className="text-[10px] tracking-widest text-neutral-500 font-semibold mb-3 uppercase font-mono">
                    The Argument
                </div>
                <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
                    {/* Overview navigation link */}
                    <button
                        onClick={() => setChapter("overview")}
                        className={`w-full text-left cursor-pointer p-2 rounded-xl flex gap-3 items-center relative transition ${
                            chapter === "overview" 
                                ? "bg-neutral-900/40 text-white" 
                                : "text-neutral-400 hover:bg-neutral-900/20"
                        }`}
                    >
                        {chapter === "overview" && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.75 h-[60%] rounded-r bg-indigo-500 shadow-[0_0_12px_#6E8BFF]" />
                        )}
                        <span className="font-mono text-[11px] text-neutral-500 shrink-0 w-4.5 text-center">00</span>
                        <span className="text-[13.5px] font-medium leading-none">Overview</span>
                    </button>

                    {/* Chapters navigation list */}
                    {chapters.map((c) => {
                        const active = chapter === c.id;
                        return (
                            <button
                                key={c.id}
                                onClick={() => setChapter(c.id)}
                                className={`w-full text-left cursor-pointer p-2.5 rounded-xl flex gap-3 items-start relative transition ${
                                    active 
                                        ? "bg-neutral-900/40 text-white" 
                                        : "text-neutral-400 hover:bg-neutral-900/20"
                                }`}
                            >
                                {active && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.75 h-[60%] rounded-r bg-indigo-500 shadow-[0_0_12px_#6E8BFF]" />
                                )}
                                <span className={`font-mono text-[11px] pt-[1px] shrink-0 w-4.5 text-center ${active ? "text-indigo-400" : "text-neutral-500"}`}>
                                    {c.id}
                                </span>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[13.5px] font-medium tracking-tight leading-none">
                                        {c.title}
                                    </span>
                                    <span className="text-[11.5px] text-neutral-500 font-medium leading-snug">
                                        {c.tag}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </nav>

                {/* Developer Tools */}
                <div className="pt-3.5 border-t border-[var(--border)] mb-4">
                    <div className="text-[10px] tracking-widest text-neutral-500 font-semibold mb-2.5 uppercase font-mono select-none">
                        Developer Tools
                    </div>
                    <div className="flex flex-col gap-1">
                        <Link
                            to="/ai-test"
                            className="w-full text-left cursor-pointer p-2 rounded-xl flex gap-3 items-center text-neutral-400 hover:bg-neutral-900/20 hover:text-white transition no-underline"
                        >
                            <span className="font-mono text-[11.5px] text-neutral-500 shrink-0 w-4.5 text-center">🧪</span>
                            <span className="text-[13px] font-medium leading-none">AI Test Dashboard</span>
                        </Link>
                        <Link
                            to="/ai-playground"
                            className="w-full text-left cursor-pointer p-2 rounded-xl flex gap-3 items-center text-neutral-400 hover:bg-neutral-900/20 hover:text-white transition no-underline"
                        >
                            <span className="font-mono text-[11.5px] text-neutral-500 shrink-0 w-4.5 text-center">🛝</span>
                            <span className="text-[13px] font-medium leading-none">AI Playground</span>
                        </Link>
                        <Link
                            to="/tic-tac-toe"
                            className="w-full text-left cursor-pointer p-2 rounded-xl flex gap-3 items-center text-neutral-400 hover:bg-neutral-900/20 hover:text-white transition no-underline"
                        >
                            <span className="font-mono text-[11.5px] text-neutral-500 shrink-0 w-4.5 text-center">⭕</span>
                            <span className="text-[13px] font-medium leading-none">AI Tic-Tac-Toe</span>
                        </Link>
                        <Link
                            to="/chess"
                            className="w-full text-left cursor-pointer p-2 rounded-xl flex gap-3 items-center text-neutral-400 hover:bg-neutral-900/20 hover:text-white transition no-underline"
                        >
                            <span className="font-mono text-[11.5px] text-neutral-500 shrink-0 w-4.5 text-center">👑</span>
                            <span className="text-[13px] font-medium leading-none">AI Chess</span>
                        </Link>
                    </div>
                </div>

                {/* Appearance toggle at bottom */}
                <div className="mt-auto pt-3.5 border-t border-[var(--border)] flex items-center justify-between">
                    <span className="text-[11.5px] text-neutral-500 font-semibold uppercase tracking-wider font-mono">Appearance</span>
                    <button
                        onClick={() => setTheme(prev => prev === "dark" ? "light" : "dark")}
                        className="cursor-pointer border border-[var(--border-2)] bg-[var(--surface-2)] rounded-full flex p-[3px] gap-[2px]"
                    >
                        <span className={`text-[11px] font-semibold px-3 py-1 rounded-full transition ${
                            theme === "dark" ? "bg-indigo-500 text-white shadow-md" : "bg-transparent text-neutral-400"
                        }`}>
                            Dark
                        </span>
                        <span className={`text-[11px] font-semibold px-3 py-1 rounded-full transition ${
                            theme === "light" ? "bg-indigo-500 text-white shadow-md" : "bg-transparent text-neutral-400"
                        }`}>
                            Light
                        </span>
                    </button>
                </div>
            </aside>

            {/* ================= MAIN CONTENT ================= */}
            <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg)]">
                
                {/* Header bar */}
                <header className="sticky top-0 z-20 h-[60px] shrink-0 flex items-center justify-between px-7.5 bg-[var(--bg)]/80 backdrop-blur-md border-b border-[var(--border)]">
                    <div className="flex items-center gap-3 text-[13px] text-neutral-400 font-medium">
                        <span className="font-mono text-neutral-500">{crumbNum}</span>
                        <span className="text-neutral-700">/</span>
                        <span className="text-white font-semibold">{crumbTitle}</span>
                    </div>
                    
                    <div className="flex items-center gap-4.5">
                        {/* Live Session Status */}
                        <div className="flex items-center gap-2 text-[11.5px] text-neutral-400 font-mono uppercase tracking-wider font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_10px_#2DD4BF] animate-pulse" />
                            session live
                        </div>
                        <div className="w-[1px] h-5 bg-[var(--border)]" />

                        {/* Test Dashboard Link */}
                        <Link
                            to="/ai-test"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:text-white font-mono text-[10.5px] font-bold uppercase tracking-wider transition no-underline"
                        >
                            🧪 Test Dashboard
                        </Link>
                        <div className="w-[1px] h-5 bg-[var(--border)]" />
                        
                        {/* Desktop / Mobile Toggle */}
                        <button
                            onClick={() => setView(prev => prev === "desktop" ? "mobile" : "desktop")}
                            className="cursor-pointer border border-[var(--border-2)] bg-[var(--surface-2)] rounded-full flex p-[3px] gap-[2px] font-mono"
                        >
                            <span className={`text-[10px] font-bold px-3 py-1 rounded-full transition ${
                                isDesk ? "bg-indigo-500 text-white shadow-md" : "bg-transparent text-neutral-400"
                            }`}>
                                Desktop
                            </span>
                            <span className={`text-[10px] font-bold px-3 py-1 rounded-full transition ${
                                !isDesk ? "bg-indigo-500 text-white shadow-md" : "bg-transparent text-neutral-400"
                            }`}>
                                Mobile
                            </span>
                        </button>
                    </div>
                </header>

                {/* Canvas viewport wrapper */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {isDesk ? (
                        /* DESKTOP PAGES CANVAS */
                        <div>
                            {chapter === "overview" && <Overview onNext={startCh1} theme={theme} />}
                            {chapter === "01" && <HealthRecords />}
                            {chapter === "02" && <CameraAI />}
                            {chapter === "03" && <Delta />}
                            {chapter === "04" && <Pipeline />}
                            {chapter === "05" && <LocalModel />}
                            {chapter === "06" && <Observable />}
                        </div>
                    ) : (
                        /* ================= MOBILE VIEW MOCKUP ================= */
                        <div className="flex flex-col items-center py-10 px-5 bg-gradient-to-b from-[var(--surface)] to-[var(--bg)] min-h-full">
                            <div className="font-mono text-[11.5px] text-neutral-500 mb-5 select-none">
                                universal layout | iOS / Android / mobile web
                            </div>
                            
                            <PhoneFrame>
                                {/* Viewport Container inside iPhone mockup */}
                                <div className="absolute inset-0 bg-[var(--bg)] flex flex-col select-none">
                                    
                                    {/* Mobile Scroll Content View */}
                                    {renderMobileViewport(true)}

                                    {/* Mobile bottom nav tab bar */}
                                    <div className="flex-none border-t border-[var(--border)] bg-[var(--bg-2)]/90 backdrop-blur-md px-3.5 py-3.5 pb-6">
                                        {renderMobileBottomNavBar()}
                                    </div>

                                </div>
                            </PhoneFrame>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
