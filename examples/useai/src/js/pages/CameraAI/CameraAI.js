import React from "react";
import PhoneFrame from "../../components/PhoneFrame";

export default function CameraAI() {
    return (
        <div className="max-w-[1180px] mx-auto px-10 py-12 animate-[fadeIn_0.4s_ease-out]">
            {/* Page Header */}
            <div className="mb-10">
                <div className="font-mono text-[13px] text-indigo-400 mb-2">
                    02 / Camera + AI
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">
                    Native primitives that think.
                </h1>
                <p className="text-neutral-400 max-w-[62ch] leading-relaxed text-sm">
                    Point the camera at a lab report. Structured values extract on-device the instant capture happens — no upload, no base64, no spinner. The data never leaves the phone.
                </p>
            </div>

            {/* Layout Grid: Callouts + Phone Mockup */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-10">
                
                {/* Left Callouts */}
                <div className="flex flex-col gap-4.5 md:items-end text-left md:text-right">
                    <div className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-lg max-w-[260px]">
                        <div className="font-mono text-[10.5px] text-teal-400 font-semibold mb-2 uppercase tracking-wide">
                            on-device extraction
                        </div>
                        <div className="text-[13px] text-neutral-400 leading-relaxed">
                            Capture fires <code className="font-mono text-white bg-white/5 px-1 py-0.5 rounded text-[0.9em]">useAI(&#123; task:'vision.extract' &#125;)</code> against the frame buffer directly.
                        </div>
                    </div>
                    
                    <div className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-lg max-w-[260px]">
                        <div className="font-mono text-[10.5px] text-indigo-400 font-semibold mb-2 uppercase tracking-wide">
                            haptic.fire('success')
                        </div>
                        <div className="text-[13px] text-neutral-400 leading-relaxed">
                            The same hook can ring the device's haptic engine when extraction completes.
                        </div>
                    </div>
                </div>

                {/* Phone Mockup Frame */}
                <PhoneFrame showHapticRing={true}>
                    {/* Viewport Content */}
                    <div className="absolute inset-0 bg-gradient-to-b from-[#1a1d27] to-[#0a0c12]">
                        {/* Protected Badge */}
                        <div className="absolute top-[52px] right-3.5 z-10 flex items-center gap-1.5 bg-teal-500/10 border border-teal-500/30 text-teal-400 font-mono text-[9.5px] font-semibold px-2.5 py-1 rounded-md shadow-md select-none">
                            🔒 SCREEN PROTECTED
                        </div>

                        {/* Simulated Document inside Viewfinder */}
                        <div className="absolute top-[124px] left-[46px] right-[46px] h-[300px] bg-gradient-to-b from-[#f4f1ea] to-[#e6e2d8] rounded-lg rotate-[-2.5deg] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)] p-5 font-mono select-none">
                            <div className="text-[8.5px] font-bold text-neutral-800 tracking-wider text-center border-b border-neutral-400/60 pb-2 mb-3">
                                METRO DIAGNOSTICS | LIPID PANEL
                            </div>
                            <div className="flex flex-col gap-2 text-neutral-700 text-[8.5px]">
                                <div className="flex justify-between">
                                    <span>GLUCOSE, FASTING</span>
                                    <span className="font-bold text-neutral-900">112 mg/dL</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>CHOLESTEROL, TOTAL</span>
                                    <span className="font-bold text-neutral-900">186 mg/dL</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>HDL CHOLESTEROL</span>
                                    <span className="font-bold text-neutral-900">41 mg/dL</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>TRIGLYCERIDES</span>
                                    <span className="font-bold text-neutral-900">168 mg/dL</span>
                                </div>
                                <div className="flex justify-between text-neutral-400">
                                    <span>CREATININE</span>
                                    <span>0.9 mg/dL</span>
                                </div>
                            </div>
                        </div>

                        {/* Camera Viewfinder Focus brackets */}
                        <div className="absolute top-[110px] left-[34px] w-6 h-6 border-l-2 border-t-2 border-indigo-500 rounded-tl-sm" />
                        <div className="absolute top-[110px] right-[34px] w-6 h-6 border-r-2 border-t-2 border-indigo-500 rounded-tr-sm" />
                        <div className="absolute top-[408px] left-[34px] w-6 h-6 border-l-2 border-b-2 border-indigo-500 rounded-bl-sm" />
                        <div className="absolute top-[408px] right-[34px] w-6 h-6 border-r-2 border-b-2 border-indigo-500 rounded-br-sm" />

                        {/* Scanning lasers / line animation */}
                        <div className="absolute top-[260px] left-[34px] right-[34px] h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent shadow-[0_0_12px_#6E8BFF] animate-pulse" />

                        {/* Results Drawer Card Overlay */}
                        <div className="absolute left-3.5 right-3.5 bottom-4 bg-[#0A0C13]/90 border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-md">
                            <div className="flex items-center justify-between mb-3">
                                <span className="font-mono text-[10px] text-teal-400 font-semibold tracking-wider">
                                    ● EXTRACTED | on-device
                                </span>
                                <span className="font-mono text-[9px] text-neutral-500 font-medium">38ms</span>
                            </div>
                            
                            <div className="flex items-start justify-between mb-2.5">
                                <div>
                                    <div className="text-[13.5px] font-semibold text-white">
                                        Glucose, Fasting
                                    </div>
                                    <div className="font-mono text-[10px] text-neutral-500 mt-0.5">
                                        ref 70–99 mg/dL
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-mono text-xl font-semibold text-amber-400 leading-none">
                                        112
                                    </div>
                                    <span className="inline-block font-mono text-[8.5px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-sm border border-amber-500/20 mt-1 uppercase">
                                        HIGH
                                    </span>
                                </div>
                            </div>
                            
                            <div className="h-[1px] bg-white/5 my-2.5" />
                            
                            <p className="text-[11.5px] text-neutral-400 leading-relaxed">
                                Slightly above fasting range. Suggest re-test and review with the metabolic trend.
                            </p>
                        </div>
                    </div>
                </PhoneFrame>

                {/* Right Callouts */}
                <div className="flex flex-col gap-4.5 text-left">
                    <div className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-lg max-w-[260px]">
                        <div className="font-mono text-[10.5px] text-teal-400 font-semibold mb-2 uppercase tracking-wide">
                            screen lock | automatic
                        </div>
                        <div className="text-[13px] text-neutral-400 leading-relaxed">
                            The framework locks screenshots the moment health data renders — no extra code.
                        </div>
                    </div>
                    
                    <div className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-lg max-w-[260px]">
                        <div className="font-mono text-[10.5px] text-indigo-400 font-semibold mb-2 uppercase tracking-wide">
                            no upload | 0 bytes out
                        </div>
                        <div className="text-[13px] text-neutral-400 leading-relaxed">
                            Inference runs on the frame buffer. The image is never serialized or sent anywhere.
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
