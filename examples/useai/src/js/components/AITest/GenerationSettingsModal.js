import React from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function GenerationSettingsModal({
    isOpen,
    onClose,
    genConfig,
    setGenConfig
}) {
    const handleReset = () => {
        setGenConfig({
            temperature: 0.3,
            maxTokens: 512,
            topP: 0.95,
            repetitionPenalty: 1.3,
            noRepeatNgramSize: 3,
        });
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm cursor-pointer"
                    />

                    {/* Modal Container */}
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
                        {/* Modal Card */}
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            transition={{ type: "spring", damping: 25, stiffness: 350 }}
                            className="w-full max-w-lg bg-[#16161a] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col"
                        >
                            {/* Header */}
                            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between select-none">
                                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <span>⚙️</span> Generation Settings
                                </h2>
                                <button
                                    onClick={onClose}
                                    className="p-1 rounded-full text-[var(--text-3)] hover:text-white transition cursor-pointer"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Body */}
                            <div className="p-6 flex flex-col gap-6">
                                {/* Temperature Slider */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-center text-[12px] font-medium text-[var(--text-2)]">
                                        <span>Temperature</span>
                                        <span className="font-mono text-indigo-400 font-semibold">{genConfig.temperature.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.0"
                                        max="1.0"
                                        step="0.05"
                                        value={genConfig.temperature}
                                        onChange={(e) => setGenConfig(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                                        className="w-full h-1 bg-[var(--surface-3)] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                    />
                                    <div className="flex justify-between text-[9px] text-[var(--text-3)] font-mono">
                                        <span>Focused (0.0)</span>
                                        <span>Creative (1.0)</span>
                                    </div>
                                </div>

                                {/* Top P Slider */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-center text-[12px] font-medium text-[var(--text-2)]">
                                        <span>Top P</span>
                                        <span className="font-mono text-indigo-400 font-semibold">{genConfig.topP.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.0"
                                        max="1.0"
                                        step="0.05"
                                        value={genConfig.topP}
                                        onChange={(e) => setGenConfig(prev => ({ ...prev, topP: parseFloat(e.target.value) }))}
                                        className="w-full h-1 bg-[var(--surface-3)] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                    />
                                    <div className="flex justify-between text-[9px] text-[var(--text-3)] font-mono">
                                        <span>Deterministic (0.0)</span>
                                        <span>Diverse (1.0)</span>
                                    </div>
                                </div>

                                {/* Repetition Penalty Slider */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-center text-[12px] font-medium text-[var(--text-2)]">
                                        <span>Repetition Penalty</span>
                                        <span className="font-mono text-indigo-400 font-semibold">{genConfig.repetitionPenalty.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="1.0"
                                        max="1.5"
                                        step="0.05"
                                        value={genConfig.repetitionPenalty}
                                        onChange={(e) => setGenConfig(prev => ({ ...prev, repetitionPenalty: parseFloat(e.target.value) }))}
                                        className="w-full h-1 bg-[var(--surface-3)] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                    />
                                    <div className="flex justify-between text-[9px] text-[var(--text-3)] font-mono">
                                        <span>Default (1.0)</span>
                                        <span>High (1.5)</span>
                                    </div>
                                </div>

                                {/* Max Tokens Number Input */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-center text-[12px] font-medium text-[var(--text-2)]">
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={genConfig.maxTokens !== undefined && genConfig.maxTokens !== null}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setGenConfig(prev => ({ ...prev, maxTokens: 512 }));
                                                    } else {
                                                        setGenConfig(prev => {
                                                            const newConfig = { ...prev };
                                                            delete newConfig.maxTokens;
                                                            return newConfig;
                                                        });
                                                    }
                                                }}
                                                className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--surface-3)] text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                                            />
                                            <span>Max Tokens</span>
                                        </label>
                                        <span className="font-mono text-indigo-400 font-semibold">
                                            {genConfig.maxTokens !== undefined && genConfig.maxTokens !== null ? genConfig.maxTokens : "Unlimited"}
                                        </span>
                                    </div>
                                    <input
                                        type="number"
                                        min="64"
                                        max="2048"
                                        step="64"
                                        disabled={genConfig.maxTokens === undefined || genConfig.maxTokens === null}
                                        value={genConfig.maxTokens !== undefined && genConfig.maxTokens !== null ? genConfig.maxTokens : ""}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value, 10);
                                            if (!isNaN(val)) {
                                                setGenConfig(prev => ({ ...prev, maxTokens: val }));
                                            } else {
                                                setGenConfig(prev => ({ ...prev, maxTokens: null }));
                                            }
                                        }}
                                        placeholder="Unlimited"
                                        className="w-full bg-[var(--surface-3)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-1.5 text-[13px] text-white font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <div className="flex justify-between text-[9px] text-[var(--text-3)] font-mono">
                                        <span>Min: 64</span>
                                        <span>Max: 2048</span>
                                    </div>
                                </div>

                                {/* No-repeat N-gram Number Input */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-center text-[12px] font-medium text-[var(--text-2)]">
                                        <span>No-repeat N-gram</span>
                                        <span className="font-mono text-indigo-400 font-semibold">{genConfig.noRepeatNgramSize}</span>
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        max="5"
                                        step="1"
                                        value={genConfig.noRepeatNgramSize}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value, 10);
                                            if (!isNaN(val)) setGenConfig(prev => ({ ...prev, noRepeatNgramSize: val }));
                                        }}
                                        className="w-full bg-[var(--surface-3)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-1.5 text-[13px] text-white font-mono"
                                    />
                                    <div className="flex justify-between text-[9px] text-[var(--text-3)] font-mono">
                                        <span>Min: 0</span>
                                        <span>Max: 5</span>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    className="text-[12px] font-medium text-[var(--text-3)] hover:text-white cursor-pointer transition"
                                >
                                    Reset to Defaults
                                </button>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-[13px] rounded-xl transition cursor-pointer select-none"
                                >
                                    Done
                                </button>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}
