import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LOCAL_MODELS } from "../../constants/ai";

export default function InferenceSettingsBottomSheet({
    isOpen,
    onClose,
    useCloud,
    setUseCloud,
    useLocal,
    setUseLocal,
    useNative,
    setUseNative,
    selectedLocalModel,
    setSelectedLocalModel,
    isNativeAvailable
}) {
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
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm cursor-pointer"
                    />

                    {/* Bottom Sheet */}
                    <motion.div
                        initial={{ translateY: "100%" }}
                        animate={{ translateY: 0 }}
                        exit={{ translateY: "100%" }}
                        transition={{ type: "spring", damping: 28, stiffness: 250 }}
                        drag="y"
                        dragConstraints={{ top: 0 }}
                        dragElastic={0.2}
                        onDragEnd={(e, info) => {
                            if (info.offset.y > 100) {
                                onClose();
                            }
                        }}
                        className="fixed bottom-0 left-0 right-0 z-50 bg-[#16161a] border-t border-[var(--border)] rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col pointer-events-auto"
                    >
                        {/* Drag Handle & Header */}
                        <div className="flex flex-col items-center pt-3 pb-4 px-6 border-b border-[var(--border)] select-none shrink-0">
                            <div className="w-12 h-1.5 bg-[var(--text-3)]/40 rounded-full mb-4 cursor-grab active:cursor-grabbing" />
                            <div className="w-full flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <span>⚙️</span> Inference Settings
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
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
                            {/* Cloud Settings Option */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                                    <div className="flex items-center gap-3">
                                        <span className="text-lg">☁️</span>
                                        <div>
                                            <span className="block text-[13px] font-semibold text-white">Cloud Inference</span>
                                            <span className="block text-[10px] text-indigo-400 font-mono">OpenAI · gpt-4o-mini</span>
                                        </div>
                                    </div>
                                    {/* Toggle Switch */}
                                    <label className="relative inline-flex items-center cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={useCloud}
                                            onChange={(e) => setUseCloud(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-[var(--surface-3)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                                    </label>
                                </div>
                            </div>

                            {/* Local Settings Option */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                                    <div className="flex items-center gap-3">
                                        <span className="text-lg">🧠</span>
                                        <div>
                                            <span className="block text-[13px] font-semibold text-white">Local Inference</span>
                                            <span className="block text-[10px] text-teal-400 font-mono">Transformers.js · in-browser</span>
                                        </div>
                                    </div>
                                    {/* Toggle Switch */}
                                    <label className="relative inline-flex items-center cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={useLocal}
                                            onChange={(e) => setUseLocal(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-[var(--surface-3)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-500"></div>
                                    </label>
                                </div>

                                {/* Local Models Selection List */}
                                <AnimatePresence initial={false}>
                                    {useLocal && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: "auto" }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ type: "spring", stiffness: 220, damping: 26 }}
                                            className="overflow-hidden flex flex-col gap-2.5 mt-2"
                                        >
                                            <span className="text-[10px] tracking-wider uppercase text-[var(--text-3)] font-bold mb-1">
                                                Select Browser Model
                                            </span>
                                            {LOCAL_MODELS.map((model) => {
                                                const isSelected = selectedLocalModel === model.id;
                                                return (
                                                    <div
                                                        key={model.id}
                                                        onClick={() => setSelectedLocalModel(model.id)}
                                                        className={`relative flex items-center justify-between p-3.5 rounded-xl border cursor-pointer select-none transition duration-150 ${
                                                            isSelected
                                                                ? "border-teal-500 bg-teal-500/10 text-white"
                                                                : "bg-[var(--surface-2)] border-[var(--border)] hover:border-teal-500/30 text-[var(--text-2)] hover:text-white"
                                                        }`}
                                                    >
                                                        <div className="flex flex-col pr-12">
                                                            <span className="text-[13px] font-semibold text-white">
                                                                {model.label}
                                                            </span>
                                                            <span className="text-[10px] font-mono text-teal-400 mt-0.5">
                                                                Transformers.js
                                                            </span>
                                                        </div>
                                                        <span className="font-mono text-[10px] text-[var(--text-3)]">
                                                            {model.size}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Native Settings Option */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                                    <div className="flex items-center gap-3">
                                        <span className="text-lg">📱</span>
                                        <div>
                                            <span className="block text-[13px] font-semibold text-white">
                                                {isNativeAvailable ? "Native Inference" : "Native (Android only)"}
                                            </span>
                                            <span className="block text-[10px] text-purple-400 font-mono">Ktor SSE · localhost</span>
                                        </div>
                                    </div>
                                    {/* Toggle Switch */}
                                    <label className={`relative inline-flex items-center cursor-pointer select-none ${!isNativeAvailable ? "opacity-40 cursor-not-allowed" : ""}`}>
                                        <input
                                            type="checkbox"
                                            disabled={!isNativeAvailable}
                                            checked={useNative}
                                            onChange={(e) => setUseNative(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-[var(--surface-3)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
