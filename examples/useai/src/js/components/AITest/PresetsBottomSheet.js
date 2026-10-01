import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PROMPTS } from "../../constants/ai";

export default function PresetsBottomSheet({ isOpen, onClose, onSelectPreset }) {
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
                        className="fixed bottom-0 left-0 right-0 z-50 bg-[#16161a] border-t border-[var(--border)] rounded-t-3xl shadow-2xl max-h-[80vh] flex flex-col pointer-events-auto"
                    >
                        {/* Drag Handle & Header */}
                        <div className="flex flex-col items-center pt-3 pb-4 px-6 border-b border-[var(--border)] select-none shrink-0">
                            <div className="w-12 h-1.5 bg-[var(--text-3)]/40 rounded-full mb-4 cursor-grab active:cursor-grabbing" />
                            <div className="w-full flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <span>💡</span> Suggested Presets
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

                        {/* Presets List */}
                        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
                            {PROMPTS.map((preset, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => onSelectPreset(preset)}
                                    className="w-full text-left p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] hover:border-indigo-500/30 text-[13px] text-white/95 leading-relaxed font-sans transition cursor-pointer"
                                >
                                    {preset}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
