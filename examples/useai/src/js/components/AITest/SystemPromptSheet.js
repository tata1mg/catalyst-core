import React from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function SystemPromptSheet({ open, onClose, value, onChange }) {
    return (
        <AnimatePresence>
            {open && (
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
                        className="fixed bottom-0 left-0 right-0 z-50 bg-neutral-900 border-t border-[var(--border)] rounded-t-3xl shadow-2xl max-h-[80vh] flex flex-col pointer-events-auto text-white"
                    >
                        {/* Drag Handle & Header */}
                        <div className="flex flex-col items-center pt-3 pb-4 px-6 border-b border-[var(--border)] select-none shrink-0">
                            <div className="w-12 h-1.5 bg-[var(--text-3)]/40 rounded-full mb-4 cursor-grab active:cursor-grabbing" />
                            <div className="w-full flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <span>📝</span> System Prompt
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
                        <div className="flex-1 p-6 flex flex-col gap-4 overflow-y-auto">
                            <p className="text-[12px] text-[var(--text-2)] leading-relaxed">
                                Tweak the system instructions below to change the AI's behavior, formatting preferences, or persona at runtime.
                            </p>
                            <textarea
                                value={value}
                                onChange={(e) => onChange(e.target.value)}
                                placeholder="Enter system prompt instructions..."
                                className="w-full min-h-[160px] bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl p-4 text-[13px] text-white leading-relaxed placeholder-[var(--text-3)] resize-y transition duration-200 font-mono"
                            />
                            
                            <div className="flex justify-end mt-2">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-5 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-[13px] rounded-xl transition cursor-pointer"
                                >
                                    Apply & Close
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
