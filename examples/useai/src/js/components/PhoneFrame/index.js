import React from "react";

export default function PhoneFrame({ children, showHapticRing = false, className = "" }) {
    return (
        <div className={`relative justify-self-center ${className}`}>
            {/* Simulated haptic feedback ripple rings */}
            {showHapticRing && (
                <>
                    <div className="absolute inset-[-26px] rounded-[64px] border-[1.5px] border-indigo-500/40 animate-ping duration-1000" />
                    <div className="absolute inset-[-13px] rounded-[58px] border-[1.5px] border-indigo-500/70" />
                </>
            )}

            {/* Main Phone Device Shell */}
            <div className="relative w-[348px] h-[712px] bg-[#05060a] border border-white/10 rounded-[52px] p-[11px] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.8)]">
                <div className="relative w-full h-full rounded-[42px] overflow-hidden bg-[#0a0c12] flex flex-col">
                    
                    {/* Status Bar */}
                    <div className="absolute top-0 left-0 right-0 h-[46px] z-10 flex items-center justify-between px-6 pt-3.5 font-mono text-[11px] text-white/90 select-none pointer-events-none">
                        <span>9:41</span>
                        <div className="flex gap-1.5 items-center">
                            <span className="w-2.5 h-2.5 rounded-full bg-white/20 border border-white/40" />
                            <span>5G</span>
                            <span className="w-5 h-2.5 border border-white/50 rounded-sm p-[1px] flex items-center">
                                <span className="h-full w-4 bg-white rounded-2xs" />
                            </span>
                        </div>
                    </div>

                    {/* Camera Notch */}
                    <div className="absolute top-[12px] left-1/2 transform -translate-x-1/2 w-[108px] h-[28px] bg-black border border-white/5 rounded-[16px] z-20" />

                    {/* Viewport Children Content */}
                    <div className="flex-1 w-full h-full relative">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}
