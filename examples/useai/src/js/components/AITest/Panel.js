import React, { useEffect, useRef, useState, useMemo } from "react";
import { useAI } from "catalyst-core/hooks";
import { motion, AnimatePresence } from "framer-motion";
import { truncateFilename, formatBytes, formatSeconds, formatTps, formatTokens, renderOutput } from "../../utils/ai";

const formatCost = (cost) => {
    if (cost === null || cost === undefined) return "$0.00000";
    if (cost === 0) return "$0.00";
    if (cost < 0.00001) return `$${cost.toFixed(6)}`;
    return `$${cost.toFixed(5)}`;
};

export default function Panel({ mode, label, icon, provider, accentColor, borderColor, prompt, run, model, genConfig, systemPrompt, sessionMode = "stateless", onResetSession }) {
    const [selectedProvider, setSelectedProvider] = useState(provider === "gemini" ? "gemini" : "openai");
    const [isStreaming, setIsStreaming] = useState(true);
    const [showStatsModal, setShowStatsModal] = useState(false);

    const isCloud = provider === "openai" || provider === "gemini";
    const activeProvider = isCloud ? selectedProvider : provider;

    const mergedGenConfig = useMemo(() => ({
        ...genConfig,
        stream: isStreaming
    }), [genConfig, isStreaming]);

    const useAIResult = useAI({
        mode,
        provider: activeProvider,
        model,
        genConfig: mergedGenConfig,
        systemPrompt,
        sessionMode,
        attachmentComponents: {
            Header: {
                attrs: { level: "1|2|3" },
                hint: "section title, body is the heading text",
            },
            InfoCard: {
                attrs: { title: "string", type: "info|warning|success" },
                hint: "1 sentence callout only",
            },
            OrderedList: {
                hint: "steps or lists, one item per line in body",
            },
            DataTable: {
                hint: "structured data, body is a markdown table",
            },
            CodeBlock: {
                attrs: { language: "string" , updateMove : {  pawe : "king/quern" , to : " up/down"}},
                hint: "code or commands, body is raw code",
            },
        }
    });
    const { output, streaming, loading, error, isLocal, modelReady, downloadProgress, nativeDownloadProgress, nativeLogs, metrics, generate, cancel, reset, clearError, getSessionMetrics, resetSessionMetrics } =
        useAIResult;

    const isNative = activeProvider === "native" || useAIResult.isNative;

    const lastRunRef = useRef(0);
    const outputContainerRef = useRef(null);

    useEffect(() => {
        if (run === 0 || run === lastRunRef.current) return;
        lastRunRef.current = run;
        generate({ messages: [{ role: "user", content: prompt }], genConfig: mergedGenConfig });
    }, [run, prompt, generate, mergedGenConfig]);

    useEffect(() => {
        if (outputContainerRef.current) {
            outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;
        }
    }, [output]);

    const status = streaming ? "Streaming" : loading
        ? downloadProgress
            ? `Downloading ${downloadProgress.percent}%`
            : isLocal && !modelReady ? "Warming model…" : "Connecting…"
        : isNative && nativeDownloadProgress && !modelReady
            ? nativeDownloadProgress.phase === "engine_init"
                ? "Loading engine…"
                : `Fetching model ${nativeDownloadProgress.percent > 0 ? nativeDownloadProgress.percent + "%" : ""}`
            : "Idle";

    const displayStatus = streaming
        ? "streaming"
        : (loading && !isStreaming)
            ? "thinking..."
            : status === "Connecting…"
                ? "connecting..."
                : status.toLowerCase();

    const statusLabel = `${activeProvider} • ${displayStatus}`;

    const endpointLabel = isLocal
        ? "Transformers.js · in-browser"
        : isNative
            ? "Ktor SSE · localhost"
            : `POST /ai/${activeProvider}/${isStreaming ? "stream" : "generate"} · ${activeProvider === "openai" ? "OpenAI" : "Gemini"}`;

    const hasStarted = loading || streaming || output;
    const firstTokenArrived = metrics?.ttftMs !== null && metrics?.ttftMs !== undefined;

    const stats = getSessionMetrics ? getSessionMetrics() : null;
    const hasStats = stats !== null && stats !== undefined && stats.generationCount > 0;

    return (
        <div className={`flex flex-col flex-1 min-w-0 bg-[var(--surface)] border ${borderColor} rounded-2xl overflow-hidden shadow-xl`}>
            {/* header */}
            <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-3.5 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                    <span className="text-base">{icon}</span>
                    <div>
                        <div className="text-[13px] font-semibold text-white">{label}</div>
                        <div className={`font-mono text-[10px] ${accentColor}`}>
                            {endpointLabel}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isLocal && modelReady && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md">
                            model ready
                        </span>
                    )}
                    {sessionMode === "stateful" && useAIResult.conversationId && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-md font-mono" title={useAIResult.conversationId}>
                            session active
                        </span>
                    )}
                    {sessionMode === "stateful" && (
                        <button
                            type="button"
                            onClick={() => { reset(); onResetSession?.(); }}
                            className="px-2 py-0.5 text-[10px] font-semibold bg-[var(--surface-3)] hover:bg-red-500/20 text-[var(--text-2)] hover:text-red-400 border border-[var(--border)] hover:border-red-500/30 rounded-md transition cursor-pointer"
                            title="Clear output and start a new conversation"
                        >
                            reset session
                        </button>
                    )}
                    <span className={`font-mono text-[11px] ${streaming ? "text-[var(--teal)]" : loading ? "text-yellow-400" : "text-[var(--text-3)]"}`}>
                        {statusLabel}
                    </span>
                </div>
            </div>

            {/* controls row */}
            {isCloud && (
                <div className="shrink-0 bg-[var(--surface-3)] border-b border-[var(--border)] px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 select-none">
                    <div className="flex items-center gap-1 bg-[var(--surface-2)] p-0.5 rounded-lg border border-[var(--border)]">
                        <button
                            type="button"
                            onClick={() => setSelectedProvider("openai")}
                            className={`px-3 py-1 text-[11px] font-semibold rounded-md transition cursor-pointer ${
                                selectedProvider === "openai"
                                    ? "bg-indigo-500 text-white shadow-sm"
                                    : "text-[var(--text-3)] hover:text-white hover:bg-white/5"
                            }`}
                        >
                            OpenAI
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelectedProvider("gemini")}
                            className={`px-3 py-1 text-[11px] font-semibold rounded-md transition cursor-pointer ${
                                selectedProvider === "gemini"
                                    ? "bg-indigo-500 text-white shadow-sm"
                                    : "text-[var(--text-3)] hover:text-white hover:bg-white/5"
                            }`}
                        >
                            Gemini
                        </button>
                    </div>

                    <label className="flex items-center gap-2 text-[11px] text-[var(--text-2)] font-medium cursor-pointer hover:text-white transition">
                        <input
                            type="checkbox"
                            checked={isStreaming}
                            onChange={(e) => setIsStreaming(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--surface-2)] text-indigo-500 focus:ring-indigo-500 focus:ring-offset-[var(--surface-3)] transition cursor-pointer"
                        />
                        <span>Streaming</span>
                    </label>
                </div>
            )}
            {/* download progress bar */}
            {downloadProgress && (
                <div className="shrink-0 px-5 py-2 bg-[var(--surface-2)] border-b border-[var(--border)]">
                    <div className="flex justify-between text-[10px] font-mono text-[var(--text-3)] mb-1">
                        <span className="truncate max-w-[60%]">{truncateFilename(downloadProgress.file)}</span>
                        <span>{downloadProgress.percent}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                        <div
                            className="h-full bg-teal-500 rounded-full transition-all duration-200"
                            style={{ width: `${downloadProgress.percent}%` }}
                        />
                    </div>
                </div>
            )}

            {/* native model download / engine init progress */}
            {isNative && nativeDownloadProgress && !modelReady && (
                <div className="shrink-0 px-5 py-2 bg-[var(--surface-2)] border-b border-[var(--border)]">
                    <div className="flex justify-between text-[10px] font-mono text-[var(--text-3)] mb-1">
                        <span className="truncate max-w-[60%]">
                            {nativeDownloadProgress.phase === "engine_init" ? "Engine init" : nativeDownloadProgress.phase}
                            {nativeDownloadProgress.detail ? ` · ${nativeDownloadProgress.detail}` : ""}
                        </span>
                        <span>{nativeDownloadProgress.percent > 0 ? `${nativeDownloadProgress.percent}%` : "…"}</span>
                    </div>
                    {nativeDownloadProgress.percent > 0 && (
                        <div className="w-full h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                            <div
                                className="h-full bg-orange-400 rounded-full transition-all duration-200"
                                style={{ width: `${nativeDownloadProgress.percent}%` }}
                            />
                        </div>
                    )}
                    {nativeLogs.length > 0 && (
                        <div className="mt-1.5 text-[9px] font-mono text-[var(--text-3)] truncate opacity-70">
                            {nativeLogs[nativeLogs.length - 1]}
                        </div>
                    )}
                </div>
            )}

            {/* output */}
            <div ref={outputContainerRef} className="flex-1 p-5 h-[380px] bg-[var(--code-bg)] font-mono text-[13px] leading-relaxed text-white/90 overflow-y-auto">
                {error ? (
                    <div className="flex flex-col gap-1.5">
                        <div className="text-red-400 font-sans text-[12px] font-semibold">⚠ Error</div>
                        <div className="text-red-300/80 text-[11px] break-words">{error.message || String(error)}</div>
                        <button onClick={clearError} className="self-start mt-1 text-[11px] text-[var(--text-3)] hover:text-white cursor-pointer transition">
                            Dismiss
                        </button>
                    </div>
                ) : loading && !isStreaming ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[140px] text-center gap-3">
                        <svg className="animate-spin h-6 w-6 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p className="text-[11px] text-[var(--text-2)] font-sans">
                            Thinking...
                        </p>
                    </div>
                ) : output ? (
                    <div className="select-text break-words">
                        {renderOutput(output, streaming)}
                        {streaming && <span className="inline-block w-1.5 h-4 bg-[var(--teal)] ml-1 animate-[caret_1s_infinite] align-middle" />}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full min-h-[140px] text-center gap-2">
                        <span className="text-xl text-[var(--text-3)]">📥</span>
                        <p className="text-[11px] text-[var(--text-2)] font-sans">
                            {loading
                                ? isLocal && !modelReady
                                    ? "Downloading model + warming pipeline…"
                                    : "Establishing connection…"
                                : "Waiting for prompt"}
                        </p>
                    </div>
                )}
            </div>

            {/* Metrics Bar */}
            {(isLocal || isNative || isCloud) && hasStarted && (
                <div className={`transition-opacity duration-300 ${firstTokenArrived ? "opacity-100" : "opacity-0"} shrink-0 px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between select-none font-mono text-[11px]`}>
                    {isLocal && (
                        <>
                            <div className="flex-grow flex flex-col items-center">
                                <span className="text-[var(--text-3)] mb-0.5">Download</span>
                                <span className="text-white font-medium">{formatBytes(metrics?.downloadBytes)}</span>
                            </div>
                            <div className="h-6 w-px bg-[var(--border)]" />
                            
                            <div className="flex-grow flex flex-col items-center">
                                <span className="text-[var(--text-3)] mb-0.5">Load time</span>
                                <span className="text-white font-medium">{formatSeconds(metrics?.loadMs)}</span>
                            </div>
                            <div className="h-6 w-px bg-[var(--border)]" />
                        </>
                    )}
                    {isNative && (
                        <>
                            <div className="flex-grow flex flex-col items-center">
                                <span className="text-[var(--text-3)] mb-0.5">Device</span>
                                <span className="text-white font-medium">{metrics?.device || "native"}</span>
                            </div>
                            <div className="h-6 w-px bg-[var(--border)]" />
                        </>
                    )}
                    
                    <div className="flex-grow flex flex-col items-center">
                        <span className="text-[var(--text-3)] mb-0.5">TTFT</span>
                        <span className="text-white font-medium">{formatSeconds(metrics?.ttftMs)}</span>
                    </div>
                    <div className="h-6 w-px bg-[var(--border)]" />
                    
                    <div className="flex-grow flex flex-col items-center">
                        <span className="text-[var(--text-3)] mb-0.5">tok/s</span>
                        <span className="text-white font-medium">{formatTps(metrics?.tps)}</span>
                    </div>
                    {isLocal && (
                        <>
                            <div className="h-6 w-px bg-[var(--border)]" />
                            <div className="flex-grow flex flex-col items-center">
                                <span className="text-[var(--text-3)] mb-0.5">Tokens</span>
                                <span className="text-white font-medium">{formatTokens(metrics?.totalTokens)}</span>
                            </div>
                        </>
                    )}
                    <div className="h-6 w-px bg-[var(--border)]" />
                    <div className="flex-grow flex flex-col items-center justify-center">
                        <button
                            type="button"
                            onClick={() => setShowStatsModal(true)}
                            disabled={!hasStats}
                            title={hasStats ? "View session metrics" : "No generations yet"}
                            className={`px-2.5 py-1 text-[10px] font-semibold rounded-md border transition cursor-pointer select-none font-sans ${
                                hasStats
                                    ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/25 hover:border-indigo-500/40"
                                    : "bg-neutral-800/50 text-neutral-500 border-neutral-700/30 cursor-not-allowed"
                            }`}
                        >
                            📊 Session Stats
                        </button>
                    </div>
                </div>
            )}

            <AnimatePresence>
                {showStatsModal && stats && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowStatsModal(false)}
                            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm cursor-pointer"
                        />

                        {/* Modal Container */}
                        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
                            {/* Modal Card */}
                            <motion.div
                                initial={{ scale: 0.95, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.95, opacity: 0 }}
                                transition={{ type: "spring", damping: 25, stiffness: 350 }}
                                className="w-full max-w-md bg-[#16161a] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col font-sans"
                            >
                                {/* Header */}
                                <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between select-none">
                                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                        <span>📊</span> Session Metrics
                                    </h2>
                                    <button
                                        onClick={() => setShowStatsModal(false)}
                                        className="p-1 rounded-full text-[var(--text-3)] hover:text-white transition cursor-pointer"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>

                                {/* Body */}
                                {isLocal ? (
                                    <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Generations</span>
                                                <span className="text-lg font-bold text-white font-mono">{stats.generationCount}</span>
                                            </div>
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Total Tokens</span>
                                                <span className="text-lg font-bold text-white font-mono">{formatTokens(stats.totalTokens)}</span>
                                            </div>
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Total Gen Time</span>
                                                <span className="text-lg font-bold text-white font-mono">{formatSeconds(stats.totalGenMs)}</span>
                                            </div>
                                        </div>

                                        <div className="bg-[var(--surface-3)] p-3.5 rounded-xl border border-[var(--border)] flex flex-col gap-2 mt-1">
                                            <div className="text-[10px] text-[var(--text-3)] border-b border-[var(--border)] pb-1.5 mb-0.5 uppercase tracking-wider font-semibold">
                                                Performance Metrics
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Avg TTFT</span>
                                                    <span className="text-white font-mono font-medium">{formatSeconds(stats.avgTtftMs)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Avg Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.avgTps)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Min Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.minTps)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Max Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.maxTps)}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {(stats.device || stats.dtype) && (
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex items-center justify-between">
                                                <span className="text-[10px] text-[var(--text-3)] uppercase tracking-wider font-semibold">Engine</span>
                                                <span className="text-[12px] text-white font-mono font-medium">
                                                    {[stats.device, stats.dtype].filter(Boolean).join(" · ")}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ) : isNative ? (
                                    <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Generations</span>
                                                <span className="text-lg font-bold text-white font-mono">{stats.generationCount}</span>
                                            </div>
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Total Tokens</span>
                                                <span className="text-lg font-bold text-white font-mono">{formatTokens(stats.totalTokens)}</span>
                                            </div>
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Total Gen Time</span>
                                                <span className="text-lg font-bold text-white font-mono">{formatSeconds(stats.totalGenMs)}</span>
                                            </div>
                                        </div>

                                        <div className="bg-[var(--surface-3)] p-3.5 rounded-xl border border-[var(--border)] flex flex-col gap-2 mt-1">
                                            <div className="text-[10px] text-[var(--text-3)] border-b border-[var(--border)] pb-1.5 mb-0.5 uppercase tracking-wider font-semibold">
                                                Performance Metrics
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Avg TTFT</span>
                                                    <span className="text-white font-mono font-medium">{formatSeconds(stats.avgTtftMs)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Avg Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.avgTps)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Min Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.minTps)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Max Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.maxTps)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Generations</span>
                                                <span className="text-lg font-bold text-white font-mono">{stats.generationCount}</span>
                                            </div>
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Total Cost</span>
                                                <span className="text-lg font-bold text-emerald-400 font-mono">{formatCost(stats.totalCost)}</span>
                                            </div>
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Total Tokens</span>
                                                <span className="text-lg font-bold text-white font-mono">{formatTokens(stats.totalTokens)}</span>
                                                {stats.totalCachedTokens > 0 && (
                                                    <span className="text-[9px] text-[var(--text-3)] mt-0.5 font-mono">
                                                        ({formatTokens(stats.totalCachedTokens)} cached)
                                                    </span>
                                                )}
                                            </div>
                                            <div className="bg-[var(--surface-3)] p-3 rounded-xl border border-[var(--border)] flex flex-col">
                                                <span className="text-[10px] text-[var(--text-3)] mb-0.5 uppercase tracking-wider font-semibold">Cache Savings</span>
                                                <span className="text-lg font-bold text-emerald-400 font-mono">{formatCost(stats.totalCacheSavings)}</span>
                                            </div>
                                        </div>

                                        <div className="bg-[var(--surface-3)] p-3.5 rounded-xl border border-[var(--border)] flex flex-col gap-2 mt-1">
                                            <div className="text-[10px] text-[var(--text-3)] border-b border-[var(--border)] pb-1.5 mb-0.5 uppercase tracking-wider font-semibold">
                                                Performance Metrics
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Avg TTFT</span>
                                                    <span className="text-white font-mono font-medium">{formatSeconds(stats.avgTtftMs)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Avg Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.avgTps)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Min Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.minTps)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-2)]">Max Speed</span>
                                                    <span className="text-white font-mono font-medium">{formatTps(stats.maxTps)}</span>
                                                </div>
                                                <div className="flex justify-between col-span-2 border-t border-[var(--border)] pt-2 mt-1">
                                                    <span className="text-[var(--text-2)]">Avg Cost/Gen</span>
                                                    <span className="text-emerald-400 font-mono font-medium">{formatCost(stats.avgCostPerGeneration)}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {stats.byProvider && Object.keys(stats.byProvider).length > 1 && (
                                            <div className="flex flex-col gap-2 mt-1">
                                                <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider font-semibold">Breakdown by Provider</div>
                                                <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                                                    <table className="w-full text-left font-mono text-[11px] border-collapse">
                                                        <thead>
                                                            <tr className="bg-[var(--surface-3)] text-[var(--text-3)] border-b border-[var(--border)]">
                                                                <th className="p-2 border-r border-[var(--border)]">Provider</th>
                                                                <th className="p-2 border-r border-[var(--border)] text-right">Gens</th>
                                                                <th className="p-2 border-r border-[var(--border)] text-right">Tokens</th>
                                                                <th className="p-2 text-right">Cost</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {Object.entries(stats.byProvider).map(([prov, pStats]) => (
                                                                <tr key={prov} className="border-b border-[var(--border)] last:border-b-0 hover:bg-white/5">
                                                                    <td className="p-2 border-r border-[var(--border)] text-white font-sans capitalize">{prov}</td>
                                                                    <td className="p-2 border-r border-[var(--border)] text-right text-white">{pStats.generationCount}</td>
                                                                    <td className="p-2 border-r border-[var(--border)] text-right text-white">{formatTokens(pStats.totalTokens)}</td>
                                                                    <td className="p-2 text-right text-emerald-400">{formatCost(pStats.totalCost)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Footer */}
                                <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            resetSessionMetrics?.();
                                            setShowStatsModal(false);
                                        }}
                                        className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-semibold text-[11px] border border-red-500/20 rounded-xl transition cursor-pointer select-none"
                                    >
                                        Reset Session
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowStatsModal(false)}
                                        className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-750 text-white font-semibold text-[11px] border border-neutral-700 rounded-xl transition cursor-pointer select-none"
                                    >
                                        Close
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    </>
                )}
            </AnimatePresence>

            {/* footer */}
            <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-2)] px-5 py-3 flex items-center gap-2">
                {streaming && (
                    <button onClick={cancel} className="inline-flex items-center gap-1.5 cursor-pointer border border-[var(--red)] bg-red-500/10 hover:bg-red-500/20 text-[var(--red)] font-semibold text-[13px] px-3 py-1.5 rounded-xl transition">
                        Stop
                    </button>
                )}
                {(output || error) && !streaming && (
                    <button onClick={reset} className="text-[12px] font-medium text-[var(--text-2)] hover:text-white px-3 py-1.5 cursor-pointer transition">
                        Reset
                    </button>
                )}
                {output && !streaming && (
                    <span className="ml-auto font-mono text-[10px] text-[var(--text-3)]">{output.length} chars</span>
                )}
            </div>
        </div>
    );
}
