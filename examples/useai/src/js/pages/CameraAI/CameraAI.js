import React, { useEffect, useRef, useState } from "react";
import { useCamera, useVision } from "catalyst-core/hooks";
import PhoneFrame from "../../components/PhoneFrame";

// A lab report, read on the device into typed data with useVision. The schema is the contract: the model is asked for
// exactly this shape, the reply is validated against it, and anything else is retried once and then reported.
const LAB_SCHEMA = {
    type: "object",
    required: ["title", "results"],
    properties: {
        title: { type: "string", description: "Name of the panel or report" },
        lab: { type: "string", nullable: true },
        results: {
            type: "array",
            items: {
                type: "object",
                required: ["name", "value", "unit"],
                properties: {
                    name: { type: "string" },
                    value: { type: "number" },
                    unit: { type: "string" },
                    referenceRange: { type: "string", nullable: true },
                    flag: { type: "string", nullable: true, enum: ["low", "normal", "high"] },
                },
            },
        },
    },
};
const INSTRUCTIONS = "Read this laboratory report. List every test with its numeric value and unit, the reference range if printed, and flag it low, normal or high against that range.";

// What the sample report below says, so a run can be checked rather than just looked at.
const SAMPLE_ROWS = [
    ["GLUCOSE, FASTING", 112, "mg/dL", "70-99"],
    ["CHOLESTEROL, TOTAL", 186, "mg/dL", "<200"],
    ["HDL CHOLESTEROL", 41, "mg/dL", ">40"],
    ["TRIGLYCERIDES", 168, "mg/dL", "<150"],
    ["CREATININE", 0.9, "mg/dL", "0.6-1.3"],
];

const drawSampleReport = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 560;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(0, 0, 720, 560);
    ctx.fillStyle = "#222";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("METRO DIAGNOSTICS | LIPID PANEL", 360, 60);
    ctx.fillRect(40, 80, 640, 2);
    ctx.textAlign = "left";
    ctx.font = "22px sans-serif";
    ctx.fillStyle = "#666";
    ctx.fillText("TEST", 40, 120);
    ctx.fillText("RESULT", 360, 120);
    ctx.fillText("REFERENCE", 540, 120);
    ctx.fillStyle = "#111";
    SAMPLE_ROWS.forEach(([name, value, unit, range], i) => {
        const y = 175 + i * 70;
        ctx.font = "26px sans-serif";
        ctx.fillText(name, 40, y);
        ctx.font = "bold 28px sans-serif";
        ctx.fillText(`${value} ${unit}`, 360, y);
        ctx.font = "24px sans-serif";
        ctx.fillText(range, 540, y);
    });
    return canvas.toDataURL("image/png");
};

const normalize = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const matchesSample = (results) =>
    SAMPLE_ROWS.filter(([name, value]) => results.some((r) => normalize(r.name).includes(normalize(name).slice(0, 6)) && Number(r.value) === value)).length;

const ENGINES = {
    auto: { label: "Auto (routing)", options: { provider: "auto" }, note: "Picks a model per call from AI_CONFIG.routing. A photo is never sent to a cloud model unless the policy allows it." },
    native: { label: "On-device (native)", options: { provider: "native" }, note: "Gemma 4 on this phone through the native module." },
    web: { label: "In-browser (WebGPU)", options: { provider: "transformers", model: "onnx-community/gemma-4-E2B-it-ONNX" }, note: "Gemma 4 E2B in this browser. About 3.4 GB on first use." },
    cloud: { label: "Cloud (Gemini)", options: { provider: "gemini" }, note: "Sends the photo to Gemini. Pick this only for a document you are happy to upload." },
};

const FLAG_STYLE = {
    high: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    low: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    normal: "text-teal-400 bg-teal-500/10 border-teal-500/20",
};

const buttonClass = "flex-1 font-mono text-[10px] font-semibold px-2 py-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-40";

export default function CameraAI() {
    const [engine, setEngine] = useState("auto");
    // Inside the native app the on-device model is the native one; the in-browser engine is for plain browsers only.
    const [inNativeApp, setInNativeApp] = useState(false);
    useEffect(() => {
        const native = !!(window.NativeBridge || window.webkit?.messageHandlers?.NativeBridge);
        setInNativeApp(native);
        if (native) setEngine((current) => (current === "web" ? "auto" : current));
    }, []);
    const [preview, setPreview] = useState(null);
    const [source, setSource] = useState(null);
    const [elapsedMs, setElapsedMs] = useState(null);
    const fileInput = useRef(null);
    const startedAt = useRef(0);

    const camera = useCamera();
    const vision = useVision({ schema: LAB_SCHEMA, instructions: INSTRUCTIONS, ...ENGINES[engine].options });
    const { scan, approve, clear, status, data, route, error, attempts, partial } = vision;

    const run = async (image, shown) => {
        setPreview(shown);
        setSource(image);
        setElapsedMs(null);
        startedAt.current = performance.now();
        const result = await scan(image);
        if (result) setElapsedMs(Math.round(performance.now() - startedAt.current));
    };

    // A photo arrives asynchronously from the native camera; scan it once per capture.
    const photoSrc = camera.data?.fileSrc ?? null;
    useEffect(() => {
        if (photoSrc) run(camera.data, photoSrc);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [photoSrc]);

    const onFile = (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) run(file, URL.createObjectURL(file));
    };
    const useSample = () => {
        const url = drawSampleReport();
        run(url, url);
    };
    const consent = async (grant) => {
        startedAt.current = performance.now();
        const result = await approve(grant);
        if (result) setElapsedMs(Math.round(performance.now() - startedAt.current));
    };
    const reset = () => {
        clear();
        camera.clear?.();
        setPreview(null);
        setSource(null);
        setElapsedMs(null);
    };

    const running = status === "running";
    const results = data?.results ?? [];
    const sampleMatches = source === preview && typeof preview === "string" && preview.startsWith("data:") ? matchesSample(results) : null;

    return (
        <div className="max-w-[1180px] mx-auto px-10 py-12 animate-[fadeIn_0.4s_ease-out]">
            {/* Page Header */}
            <div className="mb-10">
                <div className="font-mono text-[13px] text-indigo-400 mb-2">02 / Camera + AI</div>
                <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">Native primitives that think.</h1>
                <p className="text-neutral-400 max-w-[62ch] leading-relaxed text-sm">
                    Point the camera at a lab report and get typed values back. With the on-device engines the photo never leaves the phone; with auto routing it only does so when your policy says it may.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-10">
                {/* Left Callouts */}
                <div className="flex flex-col gap-4.5 md:items-end text-left md:text-right">
                    <div className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-lg max-w-[280px]">
                        <div className="font-mono text-[10.5px] text-teal-400 font-semibold mb-2 uppercase tracking-wide">useVision</div>
                        <div className="text-[13px] text-neutral-400 leading-relaxed">
                            <code className="font-mono text-white bg-white/5 px-1 py-0.5 rounded text-[0.9em]">const &#123; scan, data &#125; = useVision(&#123; schema &#125;)</code> then <code className="font-mono text-white bg-white/5 px-1 py-0.5 rounded text-[0.9em]">scan(photo)</code>. The reply is checked against the schema and retried once if it is not usable.
                        </div>
                    </div>
                    <div className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-lg max-w-[280px]">
                        <div className="font-mono text-[10.5px] text-indigo-400 font-semibold mb-2 uppercase tracking-wide">engine</div>
                        <select
                            value={engine}
                            onChange={(e) => { setEngine(e.target.value); reset(); }}
                            className="w-full bg-[#0A0C13] border border-white/10 rounded-lg text-white text-[12px] px-2 py-1.5 mb-2"
                            data-testid="engine"
                        >
                            {Object.entries(ENGINES)
                                .filter(([key]) => !(inNativeApp && key === "web"))
                                .map(([key, e]) => <option key={key} value={key}>{e.label}</option>)}
                        </select>
                        <div className="text-[12px] text-neutral-400 leading-relaxed">{ENGINES[engine].note}</div>
                    </div>
                </div>

                {/* Phone */}
                <PhoneFrame showHapticRing={status === "done"}>
                    <div className="absolute inset-0 bg-gradient-to-b from-[#1a1d27] to-[#0a0c12] overflow-y-auto">
                        <div className="pt-[56px] px-3.5 pb-4 flex flex-col gap-3">
                            {/* Viewfinder */}
                            <div className="relative h-[210px] rounded-xl border border-white/10 bg-black/40 overflow-hidden flex items-center justify-center">
                                {preview ? (
                                    <img src={preview} alt="report to scan" className="max-h-full max-w-full object-contain" />
                                ) : (
                                    <span className="font-mono text-[10.5px] text-neutral-500 px-6 text-center">Take a photo, choose an image or use the sample report</span>
                                )}
                                {running && <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent shadow-[0_0_12px_#6E8BFF] animate-pulse" />}
                            </div>

                            {/* Inputs */}
                            <div className="flex gap-2">
                                <button className={buttonClass} onClick={() => camera.takePhoto()} disabled={running} data-testid="take-photo">📷 Photo</button>
                                <button className={buttonClass} onClick={() => fileInput.current?.click()} disabled={running}>🖼 Choose</button>
                                <button className={buttonClass} onClick={useSample} disabled={running} data-testid="use-sample">📄 Sample</button>
                                <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />
                            </div>
                            {camera.error && <div className="font-mono text-[10px] text-rose-400">Camera: {String(camera.error.message || camera.error)}</div>}

                            {/* Status */}
                            <div className="bg-[#0A0C13]/90 border border-white/10 rounded-2xl p-3.5 shadow-xl" data-testid="result" data-status={status}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-mono text-[10px] font-semibold tracking-wider text-teal-400" data-testid="status">
                                        {status === "idle" && "● READY"}
                                        {running && "● READING…"}
                                        {status === "done" && `● EXTRACTED${route?.candidate ? ` | ${route.candidate.id}` : ""}`}
                                        {status === "needs-consent" && "● NEEDS YOUR OK"}
                                        {status === "denied" && "● NOT ALLOWED"}
                                        {status === "error" && "● COULD NOT READ"}
                                    </span>
                                    <span className="font-mono text-[9px] text-neutral-500">
                                        {elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : ""}{attempts > 1 ? ` · ${attempts} tries` : ""}
                                    </span>
                                </div>

                                {running && partial && <p className="font-mono text-[9.5px] text-neutral-500 break-all max-h-[60px] overflow-hidden">{partial.slice(-160)}</p>}

                                {status === "needs-consent" && route && (
                                    <div className="flex flex-col gap-2">
                                        <p className="text-[11.5px] text-neutral-300 leading-relaxed">
                                            {route.candidate?.mode === "cloud"
                                                ? `No on-device model can read this, so the only option is ${route.candidate.provider}. That uploads the photo.`
                                                : "The in-browser model has to be downloaded first (about 3.4 GB)."}
                                        </p>
                                        <button
                                            className={buttonClass}
                                            data-testid="approve"
                                            onClick={() => consent(route.candidate?.mode === "cloud" ? { cloud: true } : { download: true })}
                                        >
                                            {route.candidate?.mode === "cloud" ? "Send this photo once" : "Download and read"}
                                        </button>
                                    </div>
                                )}

                                {status === "denied" && route && (
                                    <div className="text-[11px] text-neutral-400 leading-relaxed">
                                        <p className="mb-1.5">{route.reason}. Nothing was sent anywhere.</p>
                                        {route.skipped.map((s) => <p key={s.id} className="font-mono text-[9.5px] text-neutral-500">{s.id}: {s.why}</p>)}
                                        <p className="mt-1.5 text-neutral-500">Add a model under AI_CONFIG.routing in config.json, or pick an engine above.</p>
                                    </div>
                                )}

                                {status === "error" && error && <p className="text-[11px] text-rose-400 leading-relaxed" data-testid="error">{error.message}</p>}

                                {status === "done" && (
                                    <div data-testid="rows">
                                        <div className="text-[13px] font-semibold text-white">{data.title}</div>
                                        {data.lab && <div className="font-mono text-[9.5px] text-neutral-500 mb-1">{data.lab}</div>}
                                        <div className="flex flex-col gap-1.5 mt-2">
                                            {results.map((r, i) => (
                                                <div key={i} className="flex items-center justify-between gap-2 text-[11.5px]" data-testid="row">
                                                    <div className="min-w-0">
                                                        <div className="text-neutral-200 truncate">{r.name}</div>
                                                        {r.referenceRange && <div className="font-mono text-[9px] text-neutral-500">ref {r.referenceRange}</div>}
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <span className="font-mono font-semibold text-white">{r.value}</span>
                                                        <span className="font-mono text-[9px] text-neutral-500 ml-1">{r.unit}</span>
                                                        {r.flag && <span className={`ml-1.5 font-mono text-[8px] font-bold px-1 py-0.5 rounded-sm border uppercase ${FLAG_STYLE[r.flag] || ""}`}>{r.flag}</span>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {sampleMatches !== null && (
                                            <div className="mt-2.5 font-mono text-[9.5px] text-neutral-500" data-testid="sample-check">
                                                sample check: {sampleMatches}/{SAMPLE_ROWS.length} values match
                                            </div>
                                        )}
                                    </div>
                                )}

                                {route?.estimate && status === "done" && (
                                    <div className="mt-2 font-mono text-[9px] text-neutral-600">
                                        {route.reason} · est. {Math.round(route.estimate.latencyMs / 1000)}s, {route.estimate.tps.toFixed(0)} tok/s ({route.estimate.source})
                                    </div>
                                )}
                                {status !== "idle" && !running && (
                                    <button className="mt-2.5 font-mono text-[9.5px] text-neutral-500 underline" onClick={reset}>clear</button>
                                )}
                            </div>
                        </div>
                    </div>
                </PhoneFrame>

                {/* Right Callouts */}
                <div className="flex flex-col gap-4.5 text-left">
                    <div className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-lg max-w-[280px]">
                        <div className="font-mono text-[10.5px] text-teal-400 font-semibold mb-2 uppercase tracking-wide">privacy | by policy</div>
                        <div className="text-[13px] text-neutral-400 leading-relaxed">
                            Under auto routing a photo reaches a cloud model only if <code className="font-mono text-white bg-white/5 px-1 rounded text-[0.9em]">policy.cloudMedia</code> allows it. By default it is denied, and the scanner says so instead of uploading.
                        </div>
                    </div>
                    <div className="bg-[#10131D] border border-white/5 rounded-xl p-4.5 shadow-lg max-w-[280px]">
                        <div className="font-mono text-[10.5px] text-indigo-400 font-semibold mb-2 uppercase tracking-wide">typed result</div>
                        <div className="text-[13px] text-neutral-400 leading-relaxed">
                            The answer is parsed and validated against the schema before your app sees it. If the model rambles, it is told what was wrong and asked once more.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
