import React, { useState, useEffect } from "react";
import { Link } from "@tata1mg/router";
import { PROMPTS, LOCAL_MODELS } from "../../constants/ai";
import Panel from "../../components/AITest/Panel";
import PresetsBottomSheet from "../../components/AITest/PresetsBottomSheet";
import InferenceSettingsBottomSheet from "../../components/AITest/InferenceSettingsBottomSheet";
import GenerationSettingsModal from "../../components/AITest/GenerationSettingsModal";
import SystemPromptSheet from "../../components/AITest/SystemPromptSheet";

export default function AITest() {
    const [prompt, setPrompt] = useState(PROMPTS[0]);
    const [isNativeAvailable, setIsNativeAvailable] = useState(false);
    useEffect(() => {
        setIsNativeAvailable(!!window.NativeBridge);
    }, []);
    const [useCloud, setUseCloud] = useState(true);
    const [useLocal, setUseLocal] = useState(false);
    const [useNative, setUseNative] = useState(false);
    const [cloudRun, setCloudRun] = useState(0);
    const [localRun, setLocalRun] = useState(0);
    const [nativeRun, setNativeRun] = useState(0);
    const [activePrompt, setActivePrompt] = useState(PROMPTS[0]);

    // Redesigned local inference states
    const [selectedLocalModel, setSelectedLocalModel] = useState("onnx-community/Qwen2.5-0.5B-Instruct");
    const [isPresetsOpen, setIsPresetsOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Generation settings states
    const [genConfig, setGenConfig] = useState({
        temperature: 0.3,
        maxTokens: 512,
        topP: 0.95,
        repetitionPenalty: 1.3,
        noRepeatNgramSize: 3,
    });
    const [isGenSettingsOpen, setIsGenSettingsOpen] = useState(false);

    const [systemPrompt, setSystemPrompt] = useState(
        "You are a helpful assistant. Structure your response clearly."
    );
    const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);

    const [cloudSessionMode, setCloudSessionMode] = useState("stateless");
    const [nativeSessionMode, setNativeSessionMode] = useState("stateless");
    const [localSessionMode, setLocalSessionMode] = useState("stateless");

    const noneSelected = !useCloud && !useLocal && !useNative;

    const handleRun = (e) => {
        e.preventDefault();
        if (!prompt.trim() || noneSelected) return;
        setActivePrompt(prompt);
        if (useCloud) setCloudRun((n) => n + 1);
        if (useLocal) setLocalRun((n) => n + 1);
        if (useNative) setNativeRun((n) => n + 1);
    };

    const activePanelsCount = (useCloud ? 1 : 0) + (useLocal ? 1 : 0) + (useNative ? 1 : 0);
    const showMultiple = activePanelsCount > 1;
    const showCompare = activePanelsCount > 1;

    return (
        <div className="max-w-[1200px] mx-auto px-6 py-12 animate-[fadeIn_0.5s_ease-out]">
            {/* badge */}
            <div className="flex items-center justify-between mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] font-mono text-[11px] text-[var(--text-2)] select-none shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                    <span>useAI</span>
                    <span className="text-[var(--text-3)]">|</span>
                    <span className="text-white font-semibold">Stream Validation</span>
                </div>
                <Link
                    to="/"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-white font-mono text-[10.5px] font-bold uppercase tracking-wider transition no-underline"
                >
                    ← Back to Showcase
                </Link>
            </div>

            <h1 className="text-4xl font-semibold text-white tracking-tight mb-3">AI Test Dashboard</h1>
            <p className="text-[15px] leading-relaxed text-[var(--text-2)] mb-8">
                Select a model, pick a prompt, and run. Compare cloud and local inference side by side.
            </p>

            {/* prompt input */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-xl mb-6">
                <form onSubmit={handleRun}>
                    {/* Provider Selection Tabs */}
                    <div className="flex flex-wrap items-center gap-2 mb-5 pb-5 border-b border-[var(--border)]">
                        <span className="text-[11px] tracking-wider uppercase text-[var(--text-2)] font-semibold mr-2">
                            Active Panels
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                setUseCloud(true);
                                setUseLocal(false);
                                setUseNative(false);
                            }}
                            className={`px-3 py-1.5 rounded-lg border font-semibold text-[12px] transition cursor-pointer select-none ${
                                useCloud && !useLocal && !useNative
                                    ? "bg-indigo-500 border-indigo-500 text-white shadow-sm"
                                    : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-white"
                            }`}
                        >
                            ☁️ Cloud
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setUseCloud(false);
                                setUseLocal(true);
                                setUseNative(false);
                            }}
                            className={`px-3 py-1.5 rounded-lg border font-semibold text-[12px] transition cursor-pointer select-none ${
                                !useCloud && useLocal && !useNative
                                    ? "bg-teal-500 border-teal-500 text-white shadow-sm"
                                    : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-white"
                            }`}
                        >
                            🧠 Local
                        </button>
                        <button
                            type="button"
                            disabled={!isNativeAvailable}
                            onClick={() => {
                                setUseCloud(false);
                                setUseLocal(false);
                                setUseNative(true);
                            }}
                            className={`px-3 py-1.5 rounded-lg border font-semibold text-[12px] transition cursor-pointer select-none ${
                                useNative
                                    ? "bg-purple-500 border-purple-500 text-white shadow-sm"
                                    : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-white"
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            📱 {isNativeAvailable ? "Native" : "Native (Android only)"}
                        </button>
                        
                        <div className="w-px h-4 bg-[var(--border)] mx-2" />
                        
                        <button
                            type="button"
                            onClick={() => {
                                setUseCloud(true);
                                setUseLocal(true);
                                setUseNative(false);
                            }}
                            className={`px-3 py-1.5 rounded-lg border font-semibold text-[12px] transition cursor-pointer select-none ${
                                useCloud && useLocal && !useNative
                                    ? "bg-gradient-to-r from-indigo-500 to-teal-500 border-indigo-500 text-white shadow-sm"
                                    : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-white"
                            }`}
                        >
                            ⚖️ Compare (Cloud + Local)
                        </button>
                    </div>

                    {/* Settings Toolbar */}
                    <div className="flex flex-wrap items-center gap-3 mb-5">
                        <button
                            type="button"
                            onClick={() => setIsSettingsOpen(true)}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-white text-[13px] font-semibold transition cursor-pointer select-none"
                        >
                            <span>⚙️</span>
                            <span>Inference Settings</span>
                            <span className="text-[var(--text-3)]">|</span>
                            <span className="text-[11px] font-mono text-[var(--text-2)]">
                                {useCloud && useLocal && useNative ? "Cloud + Local + Native" :
                                 useCloud && useLocal ? "Cloud + Local" :
                                 useCloud && useNative ? "Cloud + Native" :
                                 useLocal && useNative ? "Local + Native" :
                                 useCloud ? "Cloud Only" :
                                 useLocal ? `Local (${LOCAL_MODELS.find(m => m.id === selectedLocalModel)?.label})` :
                                 useNative ? "Native Only" :
                                 "None Selected"}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsGenSettingsOpen(true)}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-white text-[13px] font-semibold transition cursor-pointer select-none"
                        >
                            <span>⚙️</span>
                            <span>Generation Settings</span>
                            <span className="text-[var(--text-3)]">|</span>
                            <span className="text-[11px] font-mono text-[var(--text-2)]">
                                Temp: {genConfig.temperature.toFixed(1)} · Max: {genConfig.maxTokens !== undefined && genConfig.maxTokens !== null ? genConfig.maxTokens : "None"}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsSystemPromptOpen(true)}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-white text-[13px] font-semibold transition cursor-pointer select-none"
                        >
                            <span>📝</span>
                            <span>System Prompt</span>
                            <span className="text-[var(--text-3)]">|</span>
                            <span className="text-[11px] font-mono text-[var(--text-2)] max-w-[150px] truncate">
                                {systemPrompt}
                            </span>
                        </button>

                        {useCloud && (
                            <button
                                type="button"
                                onClick={() => setCloudSessionMode(m => m === "stateless" ? "stateful" : "stateless")}
                                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[13px] font-semibold transition cursor-pointer select-none ${
                                    cloudSessionMode === "stateful"
                                        ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                                        : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-white hover:bg-[var(--surface-3)]"
                                }`}
                                title="Stateful: OpenAI maintains conversation context across prompts. Stateless: each prompt is independent."
                            >
                                <span>{cloudSessionMode === "stateful" ? "🔗" : "⬜"}</span>
                                <span>Session</span>
                                <span className="text-[11px] font-mono opacity-70">{cloudSessionMode}</span>
                            </button>
                        )}
                        {useNative && (
                            <button
                                type="button"
                                onClick={() => setNativeSessionMode(m => m === "stateless" ? "stateful" : "stateless")}
                                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[13px] font-semibold transition cursor-pointer select-none ${
                                    nativeSessionMode === "stateful"
                                        ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                                        : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-white hover:bg-[var(--surface-3)]"
                                }`}
                                title="Stateful: LiteRT-LM Conversation object persists across prompts. Stateless: each prompt is independent."
                            >
                                <span>{nativeSessionMode === "stateful" ? "🔗" : "⬜"}</span>
                                <span>Native Session</span>
                                <span className="text-[11px] font-mono opacity-70">{nativeSessionMode}</span>
                            </button>
                        )}
                        {useLocal && (
                            <button
                                type="button"
                                onClick={() => setLocalSessionMode(m => m === "stateless" ? "stateful" : "stateless")}
                                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[13px] font-semibold transition cursor-pointer select-none ${
                                    localSessionMode === "stateful"
                                        ? "bg-teal-500/20 border-teal-500/40 text-teal-300"
                                        : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-white hover:bg-[var(--surface-3)]"
                                }`}
                                title="Stateful: prior turns are replayed into each prompt client-side. Stateless: each prompt is independent."
                            >
                                <span>{localSessionMode === "stateful" ? "🔗" : "⬜"}</span>
                                <span>Local Session</span>
                                <span className="text-[11px] font-mono opacity-70">{localSessionMode}</span>
                            </button>
                        )}
                    </div>

                    <div className="w-full h-px bg-[var(--border)] my-5" />

                    {/* prompt selector */}
                    <div className="flex justify-between items-center mb-3">
                        <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-semibold">
                            Prompt
                        </label>
                        <button
                            type="button"
                            onClick={() => setIsPresetsOpen(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-[11px] font-medium rounded-full text-white/95 transition cursor-pointer select-none"
                        >
                            <span>💡 Preset Prompts</span>
                        </button>
                    </div>

                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Ask anything about Antigravity / Catalyst…"
                        className="w-full min-h-[80px] bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--accent-line)] focus:outline-none rounded-xl p-4 text-[14px] text-white leading-relaxed placeholder-[var(--text-3)] resize-y transition duration-200"
                    />

                    {/* run button */}
                    <div className="flex flex-wrap items-center gap-3 mt-5">
                        <button
                            type="submit"
                            disabled={!prompt.trim() || noneSelected}
                            className="ml-auto inline-flex items-center gap-2 cursor-pointer border-0 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-950 disabled:text-neutral-500 disabled:cursor-not-allowed text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl shadow-[0_4px_12px_rgba(110,139,255,0.25)] transition duration-150"
                        >
                            {showCompare ? "Compare Selected →" : "Generate →"}
                        </button>
                    </div>

                    {noneSelected && (
                        <p className="mt-3 text-[12px] text-yellow-400/80">Select at least one provider to run.</p>
                    )}
                </form>
            </div>

            {/* output panels */}
            <div className={`flex flex-col ${showMultiple ? "lg:flex-row" : ""} gap-4`}>
                {useCloud && (
                    <Panel
                        key="cloud"
                        label="Cloud · OpenAI"
                        icon="☁️"
                        provider="openai"
                        accentColor="text-indigo-400"
                        borderColor="border-indigo-500/20"
                        prompt={activePrompt}
                        run={cloudRun}
                        genConfig={genConfig}
                        systemPrompt={systemPrompt}
                        sessionMode={cloudSessionMode}
                    />
                )}
                {useLocal && (
                    <Panel
                        key="local"
                        label="Local · Transformers.js (experimental)"
                        icon="🧠"
                        provider="transformers"
                        model={selectedLocalModel}
                        accentColor="text-teal-400"
                        borderColor="border-teal-500/20"
                        prompt={activePrompt}
                        run={localRun}
                        genConfig={genConfig}
                        systemPrompt={systemPrompt}
                        sessionMode={localSessionMode}
                        onResetSession={() => setLocalSessionMode(m => m)}
                    />
                )}
                {useNative && (
                    <Panel
                        key="native"
                        label="Native · Ktor SSE"
                        icon="📱"
                        provider="native"
                        accentColor="text-purple-400"
                        borderColor="border-purple-500/20"
                        prompt={activePrompt}
                        run={nativeRun}
                        genConfig={genConfig}
                        systemPrompt={systemPrompt}
                        sessionMode={nativeSessionMode}
                        onResetSession={() => setNativeSessionMode(m => { return m })}
                    />
                )}
                {!useCloud && !useLocal && !useNative && (
                    <div className="border border-dashed border-[var(--border)] rounded-2xl p-10 text-center text-[var(--text-3)] text-[13px] w-full">
                        Check a model above to see output here.
                    </div>
                )}
            </div>

            {/* Presets Bottom Sheet */}
            <PresetsBottomSheet
                isOpen={isPresetsOpen}
                onClose={() => setIsPresetsOpen(false)}
                onSelectPreset={(selectedPreset) => {
                    setPrompt(selectedPreset);
                    setIsPresetsOpen(false);
                }}
            />

            {/* Settings Bottom Sheet */}
            <InferenceSettingsBottomSheet
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                useCloud={useCloud}
                setUseCloud={setUseCloud}
                useLocal={useLocal}
                setUseLocal={setUseLocal}
                useNative={useNative}
                setUseNative={setUseNative}
                selectedLocalModel={selectedLocalModel}
                setSelectedLocalModel={setSelectedLocalModel}
                isNativeAvailable={isNativeAvailable}
            />

            {/* Generation Settings Modal */}
            <GenerationSettingsModal
                isOpen={isGenSettingsOpen}
                onClose={() => setIsGenSettingsOpen(false)}
                genConfig={genConfig}
                setGenConfig={setGenConfig}
            />

            {/* System Prompt Bottom Sheet */}
            <SystemPromptSheet
                open={isSystemPromptOpen}
                onClose={() => setIsSystemPromptOpen(false)}
                value={systemPrompt}
                onChange={setSystemPrompt}
            />
        </div>
    );
}
