import React, { useEffect, useRef, useState, useMemo } from "react";
import { useAI } from "catalyst-core/hooks";
import { truncateFilename, formatBytes, formatSeconds, formatTps, formatTokens, renderOutput } from "../../utils/ai";

export default function Panel({ mode, label, icon, provider, accentColor, borderColor, prompt, run, model, genConfig, systemPrompt, sessionMode = "stateless", onResetSession }) {
    const [selectedProvider, setSelectedProvider] = useState(provider === "gemini" ? "gemini" : "openai");
    const [isStreaming, setIsStreaming] = useState(true);

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
    const { output, streaming, loading, error, isLocal, modelReady, downloadProgress, nativeDownloadProgress, nativeLogs, metrics, generate, cancel, reset, clearError } =
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
            {(isLocal || isNative) && hasStarted && (
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
                        <span className="text-white font-medium">{formatTps(metrics?.tokensPerSec)}</span>
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
                </div>
            )}

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
