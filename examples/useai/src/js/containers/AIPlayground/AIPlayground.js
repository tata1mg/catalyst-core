import React, { useState, useEffect, useRef } from "react";
import { useFilePicker } from "catalyst-core/hooks";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@tata1mg/router";

const DEMOS = [
    {
        id: "sentiment",
        name: "Sentiment Analysis",
        icon: "😊",
        size: "~67MB",
        model: "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
        task: "text-classification",
        accent: "#10B981", // green
        desc: "Classify text polarity as positive or negative."
    },
    {
        id: "summarize",
        name: "Summarization",
        icon: "📝",
        size: "~300MB",
        model: "Xenova/distilbart-cnn-6-6",
        task: "summarization",
        accent: "#8B5CF6", // purple
        desc: "Generate concise summaries of long articles with token streaming."
    },
    {
        id: "translate",
        name: "Translation",
        icon: "🌐",
        size: "~600MB",
        model: "Xenova/nllb-200-distilled-600M",
        task: "translation",
        accent: "#6366f1", // indigo
        desc: "Translate between languages using a heavy universal model."
    },
    {
        id: "qa",
        name: "Q&A",
        icon: "❓",
        size: "~67MB",
        model: "Xenova/distilbert-base-cased-distilled-squad",
        task: "question-answering",
        accent: "#EC4899", // pink
        desc: "Ask questions based on a context paragraph."
    },
    {
        id: "whisper",
        name: "Whisper STT",
        icon: "🎤",
        size: "~97MB",
        model: "Xenova/whisper-tiny.en",
        task: "automatic-speech-recognition",
        accent: "#06B6D4", // cyan
        desc: "Transcribe voice recordings locally with a live audio visualizer."
    },
    {
        id: "image_class",
        name: "Image Class",
        icon: "🖼",
        size: "~350MB",
        model: "Xenova/vit-base-patch16-224",
        task: "image-classification",
        accent: "#14B8A6", // teal
        desc: "Classify images into 1000 ImageNet categories instantly."
    },
    {
        id: "embeddings",
        name: "Similarity",
        icon: "🔗",
        size: "~23MB",
        model: "Xenova/all-MiniLM-L6-v2",
        task: "feature-extraction",
        accent: "#3B82F6", // blue
        desc: "Compare two sentences and visualize their semantic projection."
    },
    {
        id: "fill_mask",
        name: "Fill-Mask",
        icon: "😷",
        size: "~134MB",
        model: "Xenova/bert-base-uncased",
        task: "fill-mask",
        accent: "#D946EF", // fuchsia
        desc: "Predict missing words in a sentence using BERT mask filling."
    },
    {
        id: "zero_shot",
        name: "Zero-shot Class",
        icon: "🏷",
        size: "~150MB",
        model: "Xenova/clip-vit-base-patch32",
        task: "zero-shot-image-classification",
        accent: "#10B981", // emerald
        desc: "Classify images using arbitrary custom text categories."
    }
];

const LANGUAGES = [
    { code: "eng_Latn", label: "English" },
    { code: "fra_Latn", label: "French" },
    { code: "spa_Latn", label: "Spanish" },
    { code: "deu_Latn", label: "German" },
    { code: "hin_Deva", label: "Hindi" },
    { code: "jpn_Jpan", label: "Japanese" },
    { code: "zho_Hans", label: "Chinese" }
];

// Unified Web Worker Script for all pipelines
const WORKER_SCRIPT = `
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";
let pipes = {};

async function getPipeline(task, model, progressCallback) {
    const key = task + ":" + model;
    if (pipes[key]) return pipes[key];

    self.postMessage({ type: "log", msg: "[worker] importing transformers..." });
    const mod = await import(TRANSFORMERS_CDN);
    mod.env.allowLocalModels = false;

    self.postMessage({ type: "log", msg: "[worker] instantiating pipeline..." });
    const pipe = await mod.pipeline(task, model, {
        progress_callback: progressCallback,
        device: "webgpu" // auto falls back to WASM if WebGPU is unsupported
    });

    pipes[key] = pipe;
    return pipe;
}

self.onmessage = async (e) => {
    const { type, task, model, input, options } = e.data;
    if (type !== "run") return;

    try {
        let totalBytes = 0;
        const dlStart = performance.now();
        const pipe = await getPipeline(task, model, (info) => {
            const { status, file, name, loaded, total } = info;
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
            if (total) totalBytes = Math.max(totalBytes, total);
            self.postMessage({ type: "progress", task, model, file: file || name, percent: pct, status });
        });

        const loadMs = Math.round(performance.now() - dlStart);
        self.postMessage({ type: "ready", task, model, loadMs, totalBytes });

        const runStart = performance.now();
        let result;
        const mod = await import(TRANSFORMERS_CDN);

        if (task === "text-classification") {
            result = await pipe(input.text);
        } else if (task === "summarization") {
            const streamer = new mod.TextStreamer(pipe.tokenizer, {
                skip_prompt: true,
                skip_special_tokens: true,
                callback_function: (text) => {
                    self.postMessage({ type: "token", text });
                }
            });
            result = await pipe(input.text, {
                streamer,
                max_new_tokens: options?.max_new_tokens || 128,
                temperature: options?.temperature || 0.3
            });
        } else if (task === "translation") {
            const streamer = new mod.TextStreamer(pipe.tokenizer, {
                skip_prompt: true,
                skip_special_tokens: true,
                callback_function: (text) => {
                    self.postMessage({ type: "token", text });
                }
            });
            result = await pipe(input.text, {
                src_lang: options.src_lang,
                tgt_lang: options.tgt_lang,
                streamer,
                max_new_tokens: options?.max_new_tokens || 128
            });
        } else if (task === "question-answering") {
            result = await pipe(input.question, input.context);
        } else if (task === "automatic-speech-recognition") {
            const streamer = new mod.TextStreamer(pipe.tokenizer, {
                skip_prompt: true,
                skip_special_tokens: true,
                callback_function: (text) => {
                    self.postMessage({ type: "token", text });
                }
            });
            result = await pipe(input.audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                language: "english",
                task: "transcribe",
                streamer
            });
        } else if (task === "image-classification") {
            const img = await mod.RawImage.fromURL(input.image);
            result = await pipe(img, { topk: 5 });
        } else if (task === "feature-extraction") {
            const out1 = await pipe(input.text1, { pooling: "mean", normalize: true });
            const out2 = await pipe(input.text2, { pooling: "mean", normalize: true });
            const vec1 = Array.from(out1.data);
            const vec2 = Array.from(out2.data);
            
            let dot = 0;
            for (let i = 0; i < vec1.length; i++) {
                dot += vec1[i] * vec2[i];
            }
            result = { similarity: dot, vec1, vec2 };
        } else if (task === "fill-mask") {
            result = await pipe(input.text);
        } else if (task === "zero-shot-image-classification") {
            const img = await mod.RawImage.fromURL(input.image);
            result = await pipe(img, input.candidate_labels);
        }

        const runMs = Math.round(performance.now() - runStart);
        self.postMessage({ type: "done", task, model, result, runMs });
    } catch (err) {
        self.postMessage({ type: "error", task, model, message: err.message || String(err) });
    }
};
`;

let workerBlobUrl = null;
function getWorkerBlobUrl() {
    if (!workerBlobUrl) {
        const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
        workerBlobUrl = URL.createObjectURL(blob);
    }
    return workerBlobUrl;
}

// Vector 2D Deterministic Projection
const projectTo2D = (vec) => {
    let x = 0;
    let y = 0;
    for (let i = 0; i < vec.length; i++) {
        x += vec[i] * Math.sin(i * 0.15);
        y += vec[i] * Math.cos(i * 0.25);
    }
    // normalization factor to keep inside a boundary box
    const len = Math.sqrt(x * x + y * y) || 1;
    return { x: (x / len) * 70, y: (y / len) * 70 };
};



export default function AIPlayground() {
    const [activeDemo, setActiveDemo] = useState("sentiment");
    const [theme, setTheme] = useState("dark");
    const [view, setView] = useState("desktop"); // desktop or mobile screen emulation
    const [isMobileScreen, setIsMobileScreen] = useState(false);
    const [isMobileFullScreen, setIsMobileFullScreen] = useState(false);

    const imageClassPicker = useFilePicker();
    const zeroShotPicker = useFilePicker();

    useEffect(() => {
        if (imageClassPicker.selectedFile) {
            setClassImage(imageClassPicker.selectedFile.fileSrc);
            setClassResult([]);
        }
    }, [imageClassPicker.selectedFile]);

    useEffect(() => {
        if (zeroShotPicker.selectedFile) {
            setZeroShotImage(zeroShotPicker.selectedFile.fileSrc);
            setZeroShotResult([]);
        }
    }, [zeroShotPicker.selectedFile]);

    // Caching state mapping (tracked in localStorage so it persists)
    const [cachedModels, setCachedModels] = useState(() => {
        try {
            const saved = localStorage.getItem("playground_cached_models");
            return saved ? JSON.parse(saved) : {};
        } catch (_) {
            return {};
        }
    });

    // Per-demo States
    // 1. Sentiment
    const [sentimentText, setSentimentText] = useState("This product exceeds all my expectations! Simple integration, fantastic performance, and beautiful visuals.");
    const [sentimentResult, setSentimentResult] = useState(null);

    // 2. Summarize
    const [summarizeText, setSummarizeText] = useState("Catalyst Core is a next-generation hybrid framework designed to bridge the gap between high-performance native experiences and fast web iteration. By wrapping native OS web views and providing unified JavaScript bridges, developers can deploy a single codebase that executes locally on iOS, Android, and web targets. On-device AI execution is offloaded to highly optimized local runtimes like Transformers.js, ensuring total privacy and constant uptime without incurring cloud backend server costs.");
    const [summarizeResult, setSummarizeResult] = useState("");
    const [summarizeWordCount, setSummarizeWordCount] = useState({ before: 0, after: 0 });

    // 3. Translate
    const [translateText, setTranslateText] = useState("Welcome to the browser-based AI Playground! Everything runs on your device.");
    const [translateFrom, setTranslateFrom] = useState("eng_Latn");
    const [translateTo, setTranslateTo] = useState("fra_Latn");
    const [translateResult, setTranslateResult] = useState("");

    // 4. Q&A
    const [qaContext, setQaContext] = useState("Transformers.js allows developers to run state-of-the-art machine learning models directly in the browser. It abstracts model downsampling, tokenization, and pipeline creation into simple, clean APIs. Because the computations run locally on the client via WebGPU or WebAssembly, user data never leaves their device, offering complete privacy and offline capabilities.");
    const [qaQuestion, setQaQuestion] = useState("Where do computations run?");
    const [qaResult, setQaResult] = useState(null);

    // 5. Whisper STT
    const [isRecording, setIsRecording] = useState(false);
    const [whisperResult, setWhisperResult] = useState("");
    const [recordTime, setRecordTime] = useState(0);
    const [waveVolume, setWaveVolume] = useState(0);
    const mediaRecorderRef = useRef(null);
    const recordTimerRef = useRef(null);
    const audioStreamRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const animationFrameRef = useRef(null);

    // 6. Image Classification
    const [classImage, setClassImage] = useState(null);
    const [classResult, setClassResult] = useState([]);

    // 7. Embeddings
    const [embedText1, setEmbedText1] = useState("The weather today is absolutely beautiful and sunny.");
    const [embedText2, setEmbedText2] = useState("It is a gorgeous, clear, and bright day outside.");
    const [similarityScore, setSimilarityScore] = useState(null);
    const [vectorCoords, setVectorCoords] = useState(null); // { x1, y1, x2, y2 }

    // 8. Fill-Mask
    const [fillMaskText, setFillMaskText] = useState("The capital of France is [MASK].");
    const [fillMaskResult, setFillMaskResult] = useState(null);

    // 9. Zero-shot
    const [zeroShotImage, setZeroShotImage] = useState(null);
    const [zeroShotTags, setZeroShotTags] = useState(["cat", "dog", "car", "computer", "sunset"]);
    const [tagInput, setTagInput] = useState("");
    const [zeroShotResult, setZeroShotResult] = useState([]);

    // Universal active model state
    const [loading, setLoading] = useState(false);
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState(null);
    const [downloadProgress, setDownloadProgress] = useState(null);
    const [metrics, setMetrics] = useState(null);

    const workerRef = useRef(null);

    // Handle view auto-detection on resize
    useEffect(() => {
        const handleResize = () => {
            const isMobile = window.innerWidth <= 768 || (typeof window !== "undefined" && (!!window.NativeBridge || !!window.webkit?.messageHandlers?.NativeBridge));
            setIsMobileScreen(isMobile);
            if (isMobile) {
                setView("mobile");
            }
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // Sync theme
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
    }, [theme]);

    const activeDemoRef = useRef(activeDemo);
    const handleDoneRef = useRef(null);

    const handleDone = React.useCallback((task, result) => {
        if (task === "text-classification") {
            setSentimentResult(result[0]);
        } else if (task === "summarization") {
            const finalCount = result[0]?.summary_text || result;
            setSummarizeResult(finalCount);
            setSummarizeWordCount({
                before: summarizeText.trim().split(/\s+/).length,
                after: finalCount.trim().split(/\s+/).length
            });
        } else if (task === "translation") {
            setTranslateResult(result[0]?.translation_text || result);
        } else if (task === "question-answering") {
            setQaResult(result);
        } else if (task === "automatic-speech-recognition") {
            setWhisperResult(result.text || result);
        } else if (task === "image-classification") {
            setClassResult(result);
        } else if (task === "feature-extraction") {
            setSimilarityScore(result.similarity);
            const p1 = projectTo2D(result.vec1);
            const p2 = projectTo2D(result.vec2);
            setVectorCoords({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        } else if (task === "fill-mask") {
            setFillMaskResult(result);
        } else if (task === "zero-shot-image-classification") {
            setZeroShotResult(result);
        }
    }, [summarizeText]);

    useEffect(() => {
        activeDemoRef.current = activeDemo;
    }, [activeDemo]);

    useEffect(() => {
        handleDoneRef.current = handleDone;
    }, [handleDone]);

    // Initialize Web Worker
    useEffect(() => {
        workerRef.current = new Worker(getWorkerBlobUrl(), { type: "module" });

        workerRef.current.onmessage = (e) => {
            const msg = e.data;
            switch (msg.type) {
                case "log":
                    console.log(msg.msg);
                    break;
                case "progress":
                    setDownloadProgress({
                        file: msg.file,
                        percent: msg.percent,
                        status: msg.status
                    });
                    break;
                case "ready":
                    setLoading(false);
                    setDownloadProgress(null);
                    setCachedModels((prev) => {
                        const updated = { ...prev, [msg.model]: true };
                        localStorage.setItem("playground_cached_models", JSON.stringify(updated));
                        return updated;
                    });
                    break;
                case "token":
                    setLoading(false);
                    setStreaming(true);
                    if (activeDemoRef.current === "summarize") {
                        setSummarizeResult((prev) => prev + msg.text);
                    } else if (activeDemoRef.current === "translate") {
                        setTranslateResult((prev) => prev + msg.text);
                    } else if (activeDemoRef.current === "whisper") {
                        setWhisperResult((prev) => prev + msg.text);
                    }
                    break;
                case "done":
                    setStreaming(false);
                    setLoading(false);
                    setMetrics({ runMs: msg.runMs });
                    if (handleDoneRef.current) {
                        handleDoneRef.current(msg.task, msg.result);
                    }
                    break;
                case "error":
                    setStreaming(false);
                    setLoading(false);
                    setDownloadProgress(null);
                    setError(msg.message);
                    break;
            }
        };

        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
            }
        };
    }, []);

    const runDemo = (demoId) => {
        if (!workerRef.current) return;
        setError(null);
        setLoading(true);
        setMetrics(null);

        const config = DEMOS.find((d) => d.id === demoId);

        if (demoId === "sentiment") {
            setSentimentResult(null);
            workerRef.current.postMessage({
                type: "run",
                task: config.task,
                model: config.model,
                input: { text: sentimentText }
            });
        } else if (demoId === "summarize") {
            setSummarizeResult("");
            workerRef.current.postMessage({
                type: "run",
                task: config.task,
                model: config.model,
                input: { text: summarizeText },
                options: { max_new_tokens: 128, temperature: 0.3 }
            });
        } else if (demoId === "translate") {
            setTranslateResult("");
            workerRef.current.postMessage({
                type: "run",
                task: config.task,
                model: config.model,
                input: { text: translateText },
                options: { src_lang: translateFrom, tgt_lang: translateTo, max_new_tokens: 128 }
            });
        } else if (demoId === "qa") {
            setQaResult(null);
            workerRef.current.postMessage({
                type: "run",
                task: config.task,
                model: config.model,
                input: { question: qaQuestion, context: qaContext }
            });
        } else if (demoId === "image_class") {
            if (!classImage) {
                setError("Please select or drop an image first.");
                setLoading(false);
                return;
            }
            setClassResult([]);
            workerRef.current.postMessage({
                type: "run",
                task: config.task,
                model: config.model,
                input: { image: classImage }
            });
        } else if (demoId === "embeddings") {
            setSimilarityScore(null);
            setVectorCoords(null);
            workerRef.current.postMessage({
                type: "run",
                task: config.task,
                model: config.model,
                input: { text1: embedText1, text2: embedText2 }
            });
        } else if (demoId === "fill_mask") {
            setFillMaskResult(null);
            workerRef.current.postMessage({
                type: "run",
                task: config.task,
                model: config.model,
                input: { text: fillMaskText }
            });
        } else if (demoId === "zero_shot") {
            if (!zeroShotImage) {
                setError("Please select or drop an image first.");
                setLoading(false);
                return;
            }
            setZeroShotResult([]);
            workerRef.current.postMessage({
                type: "run",
                task: config.task,
                model: config.model,
                input: { image: zeroShotImage, candidate_labels: zeroShotTags }
            });
        }
    };

    // Whisper STT Recording functions
    const startSpeechRecording = async () => {
        try {
            setError(null);
            setWhisperResult("");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStreamRef.current = stream;

            // Audio Context for Wave Visualizer
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioContextRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            source.connect(analyser);
            analyserRef.current = analyser;

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const updateWave = () => {
                if (analyserRef.current) {
                    analyserRef.current.getByteFrequencyData(dataArray);
                    // get average volume
                    let sum = 0;
                    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
                    setWaveVolume(sum / bufferLength);
                    animationFrameRef.current = requestAnimationFrame(updateWave);
                }
            };
            updateWave();

            // Setup MediaRecorder
            const chunks = [];
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                setIsRecording(false);
                setLoading(true);

                const blob = new Blob(chunks, { type: "audio/wav" });
                try {
                    const arrayBuffer = await blob.arrayBuffer();
                    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                    
                    const targetSampleRate = 16000;
                    const offlineCtx = new OfflineAudioContext(
                        1, // mono
                        audioBuffer.duration * targetSampleRate,
                        targetSampleRate
                    );
                    
                    const bufferSource = offlineCtx.createBufferSource();
                    bufferSource.buffer = audioBuffer;
                    bufferSource.connect(offlineCtx.destination);
                    bufferSource.start();
                    
                    const resampledBuffer = await offlineCtx.startRendering();
                    const float32Data = resampledBuffer.getChannelData(0);

                    // run pipeline
                    const config = DEMOS.find((d) => d.id === "whisper");
                    workerRef.current.postMessage({
                        type: "run",
                        task: config.task,
                        model: config.model,
                        input: { audio: float32Data }
                    });
                } catch (decodeErr) {
                    setError("Failed to decode audio: " + (decodeErr.message || String(decodeErr)));
                    setLoading(false);
                }
            };

            chunks.length = 0;
            mediaRecorder.start();
            setIsRecording(true);
            setRecordTime(0);

            recordTimerRef.current = setInterval(() => {
                setRecordTime((t) => t + 1);
            }, 1000);

        } catch (err) {
            setError("Could not access microphone: " + (err.message || String(err)));
        }
    };

    const stopSpeechRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
        }
        if (recordTimerRef.current) {
            clearInterval(recordTimerRef.current);
            recordTimerRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach((track) => track.stop());
        }
    };

    const handleFileDrop = (e, targetDemo) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) {
            readFileAsDataURL(file, targetDemo);
        }
    };

    const handleFileSelect = (e, targetDemo) => {
        const file = e.target.files[0];
        if (file) {
            readFileAsDataURL(file, targetDemo);
        }
    };

    const readFileAsDataURL = (file, targetDemo) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            if (targetDemo === "image_class") {
                setClassImage(dataUrl);
                setClassResult([]);
            } else if (targetDemo === "zero_shot") {
                setZeroShotImage(dataUrl);
                setZeroShotResult([]);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleAddTag = (e) => {
        if (e.key === "Enter" && tagInput.trim()) {
            if (!zeroShotTags.includes(tagInput.trim().toLowerCase())) {
                setZeroShotTags((prev) => [...prev, tagInput.trim().toLowerCase()]);
            }
            setTagInput("");
        }
    };

    const handleRemoveTag = (tag) => {
        setZeroShotTags((prev) => prev.filter((t) => t !== tag));
    };

    const activeDemoData = DEMOS.find((d) => d.id === activeDemo);

    // Audio Visualizer waveform elements
    const renderWaveform = () => {
        const bars = Array.from({ length: 15 }, (_, i) => i);
        return (
            <div className="flex items-center justify-center gap-1.5 h-12 my-6">
                {bars.map((b) => {
                    const heightFactor = Math.sin(b * 0.4) * 15 + 20;
                    // multiply height based on waveVolume
                    const scale = isRecording ? Math.max(0.1, waveVolume / 10) : 0.1;
                    const animatedHeight = heightFactor * scale + 4;
                    return (
                        <motion.div
                            key={b}
                            animate={{ height: animatedHeight }}
                            transition={{ type: "spring", stiffness: 300, damping: 20 }}
                            className="w-1.5 rounded-full bg-[var(--accent)]"
                            style={{ backgroundColor: activeDemoData.accent }}
                        />
                    );
                })}
            </div>
        );
    };

    return (
        <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-200 select-none font-sans overflow-hidden">
            
            {/* Desktop Left Sidebar (Visible if view === 'desktop' and window size is above mobile) */}
            {view === "desktop" && !isMobileScreen && (
                <aside className="w-64 shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col p-6 h-screen overflow-y-auto">
                    {/* Header */}
                    <div className="flex items-center gap-3 pb-5 border-b border-[var(--border)] mb-6">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center shadow-lg">
                            <span className="text-sm font-semibold text-white">🧠</span>
                        </div>
                        <div>
                            <div className="font-semibold text-sm leading-none text-white">AI Playground</div>
                            <div className="text-[10px] text-[var(--text-3)] font-mono tracking-wider mt-1 uppercase">Local in-browser</div>
                        </div>
                    </div>

                    <div className="text-[10px] tracking-widest text-[var(--text-3)] font-bold mb-3 uppercase font-mono">Demos</div>
                    <nav className="flex flex-col gap-1.5 flex-grow">
                        {DEMOS.map((demo) => {
                            const isSelected = activeDemo === demo.id;
                            const isCached = !!cachedModels[demo.model];
                            return (
                                <button
                                    key={demo.id}
                                    onClick={() => {
                                        setActiveDemo(demo.id);
                                        setError(null);
                                    }}
                                    className={`relative w-full text-left p-3 rounded-xl flex gap-3 items-center transition cursor-pointer select-none group border border-transparent ${
                                        isSelected ? "text-white" : "text-[var(--text-2)] hover:text-white"
                                    }`}
                                >
                                    {isSelected && (
                                        <motion.div
                                            layoutId="activeSidebarIndicator"
                                            className="absolute inset-0 bg-white/5 rounded-xl border border-white/10"
                                            transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                        />
                                    )}
                                    <span className="text-base relative z-10">{demo.icon}</span>
                                    <div className="flex flex-col gap-0.5 flex-1 relative z-10 min-w-0">
                                        <span className="text-[13px] font-semibold truncate">{demo.name}</span>
                                        <span className="text-[10px] text-[var(--text-3)] font-mono">{demo.size}</span>
                                    </div>
                                    {isCached && (
                                        <span className="relative z-10 px-1.5 py-0.5 text-[8px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-mono uppercase tracking-wider shrink-0 select-none">
                                            cached
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </nav>

                    {/* Bottom Settings / Controls */}
                    <div className="mt-auto pt-4 border-t border-[var(--border)] flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-[var(--text-3)] font-bold uppercase tracking-wider font-mono">Appearance</span>
                            <button
                                onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                                className="cursor-pointer border border-[var(--border-2)] bg-[var(--surface-2)] rounded-full flex p-[3px] gap-[2px] shadow-inner"
                            >
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition ${
                                    theme === "dark" ? "bg-indigo-500 text-white" : "bg-transparent text-neutral-400"
                                }`}>Dark</span>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition ${
                                    theme === "light" ? "bg-indigo-500 text-white" : "bg-transparent text-neutral-400"
                                }`}>Light</span>
                            </button>
                        </div>
                    </div>
                </aside>
            )}

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[var(--bg)]">
                
                {/* Header Navbar */}
                <header className="sticky top-0 z-20 h-14 shrink-0 flex items-center justify-between px-6 bg-[var(--surface)] border-b border-[var(--border)]">
                    <div className="flex items-center gap-3">
                        {/* Mobile Back Button (only shown if a demo is active on mobile screen) */}
                        {isMobileScreen && isMobileFullScreen && (
                            <button
                                onClick={() => setIsMobileFullScreen(false)}
                                className="mr-1 p-1 rounded-lg hover:bg-white/5 text-[var(--text-2)] hover:text-white transition cursor-pointer"
                            >
                                ◀ Back
                            </button>
                        )}
                        <span className="font-semibold text-sm text-white flex items-center gap-2 select-none">
                            <span className="text-base">{activeDemoData.icon}</span>
                            <span>{activeDemoData.name}</span>
                        </span>
                        <span className="px-2 py-0.5 text-[9px] font-bold bg-white/5 border border-white/10 rounded-full text-[var(--text-2)] font-mono uppercase tracking-wider">
                            {activeDemoData.model.split("/")[1]}
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-white font-mono text-[9px] font-bold uppercase tracking-wider transition no-underline"
                        >
                            ← Showcase
                        </Link>
                        {/* Device / Platform indicators */}
                        {!isMobileScreen && (
                            <button
                                onClick={() => setView((prev) => (prev === "desktop" ? "mobile" : "desktop"))}
                                className="cursor-pointer border border-[var(--border-2)] bg-[var(--surface-2)] rounded-full flex p-[3px] gap-[2px] font-mono shadow-sm"
                            >
                                <span className={`text-[9px] font-bold px-2.5 py-0.5 rounded-full transition ${
                                    view === "desktop" ? "bg-indigo-500 text-white" : "bg-transparent text-neutral-400"
                                }`}>Desktop</span>
                                <span className={`text-[9px] font-bold px-2.5 py-0.5 rounded-full transition ${
                                    view === "mobile" ? "bg-indigo-500 text-white" : "bg-transparent text-neutral-400"
                                }`}>Mobile</span>
                            </button>
                        )}
                        <span className="flex items-center gap-1.5 font-mono text-[10px] text-teal-400 font-semibold select-none bg-teal-500/5 px-2 py-0.5 border border-teal-500/20 rounded-md">
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                            on-device
                        </span>
                    </div>
                </header>

                {/* Model Download Progress Bar */}
                {downloadProgress && (
                    <div className="bg-[var(--surface-2)] border-b border-[var(--border)] px-6 py-3 shrink-0 shadow-inner select-none">
                        <div className="flex justify-between text-[11px] font-mono text-[var(--text-2)] mb-1.5">
                            <span className="truncate max-w-[70%] font-semibold">Downloading: {downloadProgress.file}</span>
                            <span className="text-white font-bold">{downloadProgress.percent}%</span>
                        </div>
                        <div className="w-full h-2 bg-[var(--surface-3)] rounded-full overflow-hidden border border-white/5">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${downloadProgress.percent}%` }}
                                className="h-full bg-indigo-500 rounded-full shadow-lg"
                                style={{ backgroundColor: activeDemoData.accent }}
                            />
                        </div>
                        <p className="text-[9px] text-[var(--text-3)] font-mono mt-1 uppercase tracking-wider">Models are loaded locally and cached automatically in the browser.</p>
                    </div>
                )}

                {/* Main Interactive Sandbox */}
                <div className="flex-1 overflow-y-auto p-6 relative">
                    <AnimatePresence mode="wait">
                        {isMobileScreen && !isMobileFullScreen ? (
                            /* Mobile Home Grid Selection View */
                            <motion.div
                                key="mobileGrid"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="grid grid-cols-2 gap-3 pb-24"
                            >
                                {DEMOS.map((demo) => {
                                    const isCached = !!cachedModels[demo.model];
                                    return (
                                        <button
                                            key={demo.id}
                                            onClick={() => {
                                                setActiveDemo(demo.id);
                                                setIsMobileFullScreen(true);
                                                setError(null);
                                            }}
                                            className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4.5 text-left flex flex-col justify-between h-32 active:scale-95 transition select-none cursor-pointer"
                                        >
                                            <div className="flex justify-between items-start">
                                                <span className="text-2xl">{demo.icon}</span>
                                                {isCached && (
                                                    <span className="px-1.5 py-0.5 text-[8px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded uppercase font-mono tracking-wider select-none shrink-0">
                                                        cached
                                                    </span>
                                                )}
                                            </div>
                                            <div>
                                                <div className="text-[13px] font-bold text-white leading-tight">{demo.name}</div>
                                                <div className="text-[10px] text-[var(--text-3)] font-mono mt-0.5 leading-none">{demo.size}</div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </motion.div>
                        ) : (
                            /* Interactive Demo Sandbox Panel */
                            <motion.div
                                key={activeDemo}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -12 }}
                                transition={{ duration: 0.2, type: "spring", stiffness: 260, damping: 24 }}
                                className="max-w-4xl mx-auto flex flex-col gap-6"
                            >
                                {/* Active Demo Intro Info */}
                                <div className="select-none mb-2">
                                    <h2 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 mb-1.5">
                                        <span>{activeDemoData.icon}</span>
                                        <span>{activeDemoData.name}</span>
                                    </h2>
                                    <p className="text-[13px] text-[var(--text-2)] leading-relaxed">{activeDemoData.desc}</p>
                                </div>

                                {/* General Error Banner */}
                                {error && (
                                    <motion.div
                                        initial={{ scale: 0.9, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        className="bg-red-500/10 border border-red-500/25 rounded-2xl p-4 flex flex-col gap-2 font-mono text-[12px] text-red-300 relative overflow-hidden"
                                    >
                                        <span className="font-bold text-red-400 flex items-center gap-1.5 select-none">
                                            <span>⚠️</span> Error Occurred
                                        </span>
                                        <span className="break-words leading-relaxed">{error}</span>
                                        <button
                                            onClick={() => setError(null)}
                                            className="self-start px-2.5 py-1 bg-red-500/20 hover:bg-red-500/35 border border-red-500/30 hover:border-red-500/50 rounded-lg text-[10px] font-bold text-white transition cursor-pointer select-none"
                                        >
                                            Dismiss
                                        </button>
                                    </motion.div>
                                )}

                                {/* INTERACTIVE PANEL FOR SELECTED DEMO */}

                                {/* 1. Sentiment Analysis */}
                                {activeDemo === "sentiment" && (
                                    <div className="flex flex-col gap-4">
                                        <div className="flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl">
                                            <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Enter feedback text</label>
                                            <textarea
                                                value={sentimentText}
                                                onChange={(e) => setSentimentText(e.target.value)}
                                                placeholder="Write something to evaluate sentiment polarity..."
                                                className="w-full min-h-[100px] bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl p-4 text-[13.5px] text-white leading-relaxed placeholder-[var(--text-3)] resize-y transition duration-200"
                                            />
                                            <button
                                                onClick={() => runDemo("sentiment")}
                                                disabled={loading || !sentimentText.trim()}
                                                className="cursor-pointer select-none self-end px-5 py-2.5 rounded-xl text-white font-semibold text-[13px] transition duration-150 flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                                                style={{ backgroundColor: activeDemoData.accent }}
                                            >
                                                {loading ? "Analyzing..." : "Analyze Sentiment →"}
                                            </button>
                                        </div>

                                        {sentimentResult && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 15 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex flex-col gap-3 shadow-lg select-none"
                                            >
                                                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-3)]">
                                                    <span>ANALYSIS RESULT</span>
                                                    {metrics && <span className="font-bold">Inference: {metrics.runMs}ms</span>}
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-3xl">
                                                        {sentimentResult.label === "POSITIVE" ? "🎉" : "😢"}
                                                    </span>
                                                    <div className="flex-1">
                                                        <span className="block font-sans text-xs text-[var(--text-2)] font-semibold uppercase tracking-wider">Classification</span>
                                                        <span
                                                            className="block text-lg font-bold"
                                                            style={{ color: sentimentResult.label === "POSITIVE" ? "#10B981" : "#FF6B7A" }}
                                                        >
                                                            {sentimentResult.label}
                                                        </span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="block font-sans text-xs text-[var(--text-2)] font-semibold uppercase tracking-wider">Confidence</span>
                                                        <span className="block font-mono text-lg font-bold text-white">{(sentimentResult.score * 100).toFixed(1)}%</span>
                                                    </div>
                                                </div>
                                                {/* Confidence Bar */}
                                                <div className="w-full h-2 bg-[var(--surface-3)] rounded-full overflow-hidden border border-white/5">
                                                    <motion.div
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${sentimentResult.score * 100}%` }}
                                                        className="h-full rounded-full"
                                                        style={{ backgroundColor: sentimentResult.label === "POSITIVE" ? "#10B981" : "#FF6B7A" }}
                                                    />
                                                </div>
                                            </motion.div>
                                        )}
                                    </div>
                                )}

                                {/* 2. Summarization */}
                                {activeDemo === "summarize" && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div className="flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl">
                                            <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Source Article</label>
                                            <textarea
                                                value={summarizeText}
                                                onChange={(e) => setSummarizeText(e.target.value)}
                                                placeholder="Paste a long block of text here..."
                                                className="w-full flex-grow min-h-[220px] bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl p-4 text-[13px] text-white leading-relaxed placeholder-[var(--text-3)] resize-y transition duration-200"
                                            />
                                            <button
                                                onClick={() => runDemo("summarize")}
                                                disabled={loading || !summarizeText.trim()}
                                                className="cursor-pointer select-none self-end px-5 py-2.5 rounded-xl text-white font-semibold text-[13px] transition duration-150 flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                                                style={{ backgroundColor: activeDemoData.accent }}
                                            >
                                                {loading ? "Warming up..." : streaming ? "Summarizing..." : "Summarize Article →"}
                                            </button>
                                        </div>
                                        <div className="flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl relative min-h-[260px]">
                                            <div className="flex justify-between items-center select-none border-b border-[var(--border)] pb-3">
                                                <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold">Summary Output</label>
                                                {summarizeResult && (
                                                    <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--text-3)] font-semibold">
                                                        <span>Words: {summarizeWordCount.before}</span>
                                                        <span>▶</span>
                                                        <span className="text-white font-bold">{summarizeWordCount.after}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 font-mono text-[13px] leading-relaxed text-white/90 overflow-y-auto whitespace-pre-wrap">
                                                {summarizeResult ? (
                                                    <span>
                                                        {summarizeResult}
                                                        {streaming && <span className="inline-block w-1.5 h-4 bg-purple-500 ml-1 animate-pulse align-middle" style={{ backgroundColor: activeDemoData.accent }} />}
                                                    </span>
                                                ) : (
                                                    <span className="text-[var(--text-3)] italic">Streaming summary will appear here...</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 3. Translation */}
                                {activeDemo === "translate" && (
                                    <div className="flex flex-col gap-5 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl">
                                        {/* Dropdowns */}
                                        <div className="flex items-center justify-between gap-3 select-none pb-4 border-b border-[var(--border)]">
                                            <div className="flex flex-col gap-1.5 flex-1">
                                                <label className="text-[10px] tracking-wider uppercase text-[var(--text-3)] font-bold">Source Lang</label>
                                                <select
                                                    value={translateFrom}
                                                    onChange={(e) => setTranslateFrom(e.target.value)}
                                                    className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] text-white focus:outline-none focus:border-indigo-500"
                                                >
                                                    {LANGUAGES.map((l) => (
                                                        <option key={l.code} value={l.code}>{l.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const tmp = translateFrom;
                                                    setTranslateFrom(translateTo);
                                                    setTranslateTo(tmp);
                                                }}
                                                className="mt-5 p-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] hover:border-white/20 text-white transition cursor-pointer select-none"
                                            >
                                                ⇄
                                            </button>
                                            <div className="flex flex-col gap-1.5 flex-1">
                                                <label className="text-[10px] tracking-wider uppercase text-[var(--text-3)] font-bold">Target Lang</label>
                                                <select
                                                    value={translateTo}
                                                    onChange={(e) => setTranslateTo(e.target.value)}
                                                    className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] text-white focus:outline-none focus:border-indigo-500"
                                                >
                                                    {LANGUAGES.map((l) => (
                                                        <option key={l.code} value={l.code}>{l.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Panels grid */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="flex flex-col gap-2">
                                                <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Source text</label>
                                                <textarea
                                                    value={translateText}
                                                    onChange={(e) => setTranslateText(e.target.value)}
                                                    placeholder="Enter text to translate..."
                                                    className="w-full min-h-[140px] bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl p-4 text-[13.5px] text-white leading-relaxed placeholder-[var(--text-3)] resize-y transition duration-200"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Translated text</label>
                                                <div className="w-full min-h-[140px] bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 text-[13.5px] text-white leading-relaxed overflow-y-auto font-sans">
                                                    {translateResult ? (
                                                        <span>
                                                            {translateResult}
                                                            {streaming && <span className="inline-block w-1.5 h-4 bg-indigo-500 ml-1 animate-pulse align-middle" style={{ backgroundColor: activeDemoData.accent }} />}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[var(--text-3)] italic font-mono text-[12px]">Streaming translation output...</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => runDemo("translate")}
                                            disabled={loading || !translateText.trim()}
                                            className="cursor-pointer select-none self-end px-5 py-2.5 rounded-xl text-white font-semibold text-[13px] transition duration-150 flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                                            style={{ backgroundColor: activeDemoData.accent }}
                                        >
                                            {loading ? "Warming up..." : streaming ? "Translating..." : "Translate Text →"}
                                        </button>
                                    </div>
                                )}

                                {/* 4. Q&A */}
                                {activeDemo === "qa" && (
                                    <div className="flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl">
                                        <div className="flex flex-col gap-1.5">
                                            <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Paragraph Context</label>
                                            <textarea
                                                value={qaContext}
                                                onChange={(e) => setQaContext(e.target.value)}
                                                placeholder="Paste reference paragraph..."
                                                className="w-full min-h-[120px] bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl p-4 text-[13px] text-white leading-relaxed placeholder-[var(--text-3)] resize-y transition duration-200"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Question</label>
                                            <input
                                                type="text"
                                                value={qaQuestion}
                                                onChange={(e) => setQaQuestion(e.target.value)}
                                                placeholder="Ask something about the context above..."
                                                className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl px-4 py-2.5 text-[13.5px] text-white placeholder-[var(--text-3)] transition duration-200"
                                            />
                                        </div>

                                        <button
                                            onClick={() => runDemo("qa")}
                                            disabled={loading || !qaQuestion.trim() || !qaContext.trim()}
                                            className="cursor-pointer select-none self-end px-5 py-2.5 rounded-xl text-white font-semibold text-[13px] transition duration-150 flex items-center gap-2 bg-pink-500 hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-md font-sans"
                                            style={{ backgroundColor: activeDemoData.accent }}
                                        >
                                            {loading ? "Searching Context..." : "Ask Question →"}
                                        </button>

                                        {qaResult && (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.98 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="mt-4 p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex flex-col gap-2 shadow"
                                            >
                                                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-3)]">
                                                    <span>ANSWER FOUND</span>
                                                    <span className="font-bold text-pink-400" style={{ color: activeDemoData.accent }}>Score: {(qaResult.score * 100).toFixed(1)}%</span>
                                                </div>
                                                <p className="text-[14px] text-white font-semibold leading-relaxed">&quot;{qaResult.answer}&quot;</p>
                                            </motion.div>
                                        )}
                                    </div>
                                )}

                                {/* 5. Whisper STT */}
                                {activeDemo === "whisper" && (
                                    <div className="flex flex-col gap-5 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl items-center text-center">
                                        <div className="flex items-center justify-between w-full border-b border-[var(--border)] pb-3 mb-2 select-none">
                                            <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold">Local Speech to Text</label>
                                            <span className="px-2 py-0.5 text-[9px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded font-bold uppercase tracking-wider font-mono">English only</span>
                                        </div>

                                        {/* Microphone Button */}
                                        <div className="relative my-4">
                                            <motion.button
                                                onMouseDown={startSpeechRecording}
                                                onMouseUp={stopSpeechRecording}
                                                onTouchStart={startSpeechRecording}
                                                onTouchEnd={stopSpeechRecording}
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                className={`w-20 h-20 rounded-full border-4 flex items-center justify-center text-2xl shadow-xl transition-colors select-none cursor-grab active:cursor-grabbing ${
                                                    isRecording 
                                                        ? "bg-red-500 border-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] animate-[pulseGlow_1.5s_infinite]" 
                                                        : "bg-[var(--surface-2)] border-[var(--border-2)] text-[var(--text-2)] hover:text-white"
                                                }`}
                                            >
                                                {isRecording ? "🔴" : "🎤"}
                                            </motion.button>
                                        </div>

                                        <p className="text-[12px] text-[var(--text-2)] max-w-sm select-none">
                                            {isRecording 
                                                ? `Recording live: ${recordTime}s (Release button to Transcribe)` 
                                                : "Hold / Press and hold microphone button to record speech."}
                                        </p>

                                        {/* live audio waveform */}
                                        {renderWaveform()}

                                        {/* Transcript Streaming display */}
                                        <div className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-5 min-h-[100px] text-left">
                                            <label className="block text-[9px] tracking-wider uppercase text-[var(--text-3)] font-bold mb-2 select-none">Transcript Output</label>
                                            <div className="font-sans text-[13.5px] leading-relaxed text-white/90">
                                                {whisperResult ? (
                                                    <span>
                                                        {whisperResult}
                                                        {streaming && <span className="inline-block w-1.5 h-4 bg-cyan-500 ml-1 animate-pulse align-middle" />}
                                                    </span>
                                                ) : (
                                                    <span className="text-[var(--text-3)] italic font-mono text-[12px]">Streaming transcription will appear here...</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 6. Image Classification */}
                                {activeDemo === "image_class" && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        {/* Dropzone */}
                                        <div
                                            onClick={() => imageClassPicker.execute({ mimeType: "image/*" })}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleFileDrop(e, "image_class")}
                                            className="bg-[var(--surface)] border border-dashed border-[var(--border-2)] rounded-3xl p-6 shadow-xl flex flex-col items-center justify-center text-center cursor-pointer select-none min-h-[260px] relative overflow-hidden group hover:border-[var(--accent)] transition duration-200"
                                        >
                                            {classImage ? (
                                                <img src={classImage} alt="Preview" className="w-full h-full object-cover absolute inset-0 rounded-2xl group-hover:scale-[1.02] transition duration-300" />
                                            ) : (
                                                <div className="flex flex-col items-center gap-3">
                                                    <span className="text-3xl text-[var(--text-3)]">📥</span>
                                                    <div>
                                                        <span className="block text-[13px] font-semibold text-white">Drag & drop image here</span>
                                                        <span className="block text-[10px] text-[var(--text-3)] font-mono mt-1 uppercase">or click to browse local files</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Results Class Chart */}
                                        <div className="flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl relative min-h-[260px]">
                                            <div className="flex justify-between items-center select-none border-b border-[var(--border)] pb-3">
                                                <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold">Top Predictions</label>
                                                <button
                                                    onClick={() => runDemo("image_class")}
                                                    disabled={loading || !classImage}
                                                    className="cursor-pointer select-none px-3.5 py-1.5 rounded-lg text-white font-semibold text-[11.5px] bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                                    style={{ backgroundColor: activeDemoData.accent }}
                                                >
                                                    {loading ? "Analyzing..." : "Classify Image"}
                                                </button>
                                            </div>

                                            <div className="flex-1 flex flex-col gap-3 justify-center">
                                                {classResult.length > 0 ? (
                                                    classResult.map((c, idx) => (
                                                        <div key={idx} className="flex flex-col gap-1">
                                                            <div className="flex justify-between text-[11.5px] font-mono select-none">
                                                                <span className="text-white font-medium capitalize">{c.label.split(",")[0]}</span>
                                                                <span className="text-teal-400 font-bold" style={{ color: activeDemoData.accent }}>{(c.score * 100).toFixed(1)}%</span>
                                                            </div>
                                                            <div className="w-full h-2 bg-[var(--surface-2)] rounded-full overflow-hidden border border-white/5">
                                                                <motion.div
                                                                    initial={{ width: 0 }}
                                                                    animate={{ width: `${c.score * 100}%` }}
                                                                    className="h-full bg-teal-500 rounded-full"
                                                                    style={{ backgroundColor: activeDemoData.accent }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="text-center text-[var(--text-3)] italic font-mono text-[12px]">Please run classification to see predictions.</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 7. Embeddings / Similarity */}
                                {activeDemo === "embeddings" && (
                                    <div className="flex flex-col gap-5 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="flex flex-col gap-2">
                                                <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Text Input A</label>
                                                <textarea
                                                    value={embedText1}
                                                    onChange={(e) => setEmbedText1(e.target.value)}
                                                    placeholder="Enter first statement..."
                                                    className="w-full min-h-[90px] bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl p-4 text-[13px] text-white leading-relaxed placeholder-[var(--text-3)] resize-y transition duration-200"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Text Input B</label>
                                                <textarea
                                                    value={embedText2}
                                                    onChange={(e) => setEmbedText2(e.target.value)}
                                                    placeholder="Enter second statement..."
                                                    className="w-full min-h-[90px] bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl p-4 text-[13px] text-white leading-relaxed placeholder-[var(--text-3)] resize-y transition duration-200"
                                                />
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => runDemo("embeddings")}
                                            disabled={loading || !embedText1.trim() || !embedText2.trim()}
                                            className="cursor-pointer select-none self-end px-5 py-2.5 rounded-xl text-white font-semibold text-[13px] transition duration-150 flex items-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                                            style={{ backgroundColor: activeDemoData.accent }}
                                        >
                                            {loading ? "Extracting..." : "Compare Similarity →"}
                                        </button>

                                        {similarityScore !== null && (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.98 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[var(--border)]"
                                            >
                                                {/* Cosine Arc Gauge */}
                                                <div className="flex flex-col items-center justify-center text-center p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl shadow-inner select-none relative h-48">
                                                    <span className="text-[10px] tracking-wider uppercase text-[var(--text-3)] font-bold mb-2">Cosine Similarity</span>
                                                    <div className="relative flex items-center justify-center h-28 w-28">
                                                        <svg className="w-full h-full transform -rotate-90">
                                                            <circle cx="56" cy="56" r="46" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                                                            <motion.circle
                                                                cx="56" cy="56" r="46" fill="transparent"
                                                                stroke={activeDemoData.accent} strokeWidth="8"
                                                                strokeDasharray="290"
                                                                initial={{ strokeDashoffset: 290 }}
                                                                animate={{ strokeDashoffset: 290 - (290 * Math.max(0, similarityScore)) }}
                                                                transition={{ duration: 0.8, ease: "easeOut" }}
                                                            />
                                                        </svg>
                                                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                                                            <span className="font-mono text-2xl font-bold text-white">{similarityScore.toFixed(3)}</span>
                                                            <span className="text-[9px] font-bold text-blue-400 mt-0.5" style={{ color: activeDemoData.accent }}>MATCH SCORE</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Vector Plot Dot projection */}
                                                <div className="flex flex-col items-center text-center p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl shadow-inner relative h-48 select-none">
                                                    <span className="text-[10px] tracking-wider uppercase text-[var(--text-3)] font-bold mb-3">2D Vector Projection</span>
                                                    <div className="w-full flex-grow border border-dashed border-white/5 rounded-xl relative overflow-hidden bg-[var(--bg)] flex items-center justify-center">
                                                        {/* Center Axes */}
                                                        <div className="absolute inset-y-0 left-1/2 w-[1px] bg-white/5" />
                                                        <div className="absolute inset-x-0 top-1/2 h-[1px] bg-white/5" />
                                                        
                                                        {vectorCoords && (
                                                            <>
                                                                {/* Dot 1 */}
                                                                <motion.div
                                                                    initial={{ scale: 0, x: 0, y: 0 }}
                                                                    animate={{ scale: 1, x: vectorCoords.x1, y: vectorCoords.y1 }}
                                                                    className="absolute w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_10px_#6366f1]"
                                                                />
                                                                {/* Dot 2 */}
                                                                <motion.div
                                                                    initial={{ scale: 0, x: 0, y: 0 }}
                                                                    animate={{ scale: 1, x: vectorCoords.x2, y: vectorCoords.y2 }}
                                                                    className="absolute w-3 h-3 rounded-full bg-teal-400 shadow-[0_0_10px_#2dd4bf]"
                                                                />
                                                                {/* Connecting dashed line */}
                                                                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                                                    <line
                                                                        x1={150 + vectorCoords.x1}
                                                                        y1={65 + vectorCoords.y1}
                                                                        x2={150 + vectorCoords.x2}
                                                                        y2={65 + vectorCoords.y2}
                                                                        stroke="rgba(255,255,255,0.15)"
                                                                        strokeWidth="1.5"
                                                                        strokeDasharray="4"
                                                                    />
                                                                </svg>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </div>
                                )}

                                {/* 8. Fill-Mask */}
                                {activeDemo === "fill_mask" && (
                                    <div className="flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl">
                                        <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Enter sentence with [MASK]</label>
                                        <input
                                            type="text"
                                            value={fillMaskText}
                                            onChange={(e) => setFillMaskText(e.target.value)}
                                            placeholder="The capital of France is [MASK]."
                                            className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl px-4 py-2.5 text-[13.5px] text-white placeholder-[var(--text-3)] transition duration-200"
                                        />
                                        <div className="flex justify-between items-center mt-1 select-none">
                                            <span className="text-[10px] text-[var(--text-3)] font-mono uppercase">Ensure [MASK] is included in the sentence.</span>
                                            <button
                                                onClick={() => runDemo("fill_mask")}
                                                disabled={loading || !fillMaskText.trim() || !fillMaskText.includes("[MASK]")}
                                                className="cursor-pointer select-none px-5 py-2.5 rounded-xl text-white font-semibold text-[13px] transition duration-150 flex items-center gap-2 bg-fuchsia-500 hover:bg-fuchsia-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-md font-sans"
                                                style={{ backgroundColor: activeDemoData.accent }}
                                            >
                                                {loading ? "Predicting..." : "Predict Masked Word →"}
                                            </button>
                                        </div>

                                        {fillMaskResult && (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.98 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="mt-4 border-t border-[var(--border)] pt-5 flex flex-col gap-4"
                                            >
                                                <div className="flex justify-between select-none font-mono text-[10px] text-[var(--text-3)] mb-1">
                                                    <span>TOP PREDICTIONS</span>
                                                    {metrics && <span>Inference: {metrics.runMs}ms</span>}
                                                </div>
                                                <div className="flex flex-col gap-3.5">
                                                    {fillMaskResult.map((res, idx) => (
                                                        <div key={idx} className="flex flex-col gap-1.5">
                                                            <div className="flex justify-between text-[12px] font-mono select-none">
                                                                <span className="text-white font-semibold">&quot;{res.token_str}&quot;</span>
                                                                <span className="text-fuchsia-400 font-bold" style={{ color: activeDemoData.accent }}>{(res.score * 100).toFixed(1)}%</span>
                                                            </div>
                                                            <div className="w-full h-2 bg-[var(--surface-2)] rounded-full overflow-hidden border border-white/5">
                                                                <motion.div
                                                                    initial={{ width: 0 }}
                                                                    animate={{ width: `${res.score * 100}%` }}
                                                                    className="h-full bg-fuchsia-500 rounded-full"
                                                                    style={{ backgroundColor: activeDemoData.accent }}
                                                                />
                                                            </div>
                                                            <span className="text-[10.5px] text-[var(--text-2)] italic font-mono truncate">Full: {res.sequence}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </motion.div>
                                        )}
                                    </div>
                                )}

                                {/* 9. Zero-shot Image Classification */}
                                {activeDemo === "zero_shot" && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        {/* Dropzone & Tag Inputs */}
                                        <div className="flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl">
                                            <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none">Target Image</label>
                                            <div
                                                onClick={() => zeroShotPicker.execute({ mimeType: "image/*" })}
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={(e) => handleFileDrop(e, "zero_shot")}
                                                className="bg-[var(--surface-2)] border border-dashed border-[var(--border-2)] rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer select-none min-h-[160px] relative overflow-hidden group hover:border-[var(--accent)] transition"
                                            >
                                                {zeroShotImage ? (
                                                    <img src={zeroShotImage} alt="Input" className="w-full h-full object-cover absolute inset-0 rounded-xl" />
                                                ) : (
                                                    <div className="flex flex-col items-center gap-2">
                                                        <span className="text-2xl text-[var(--text-3)]">🏷</span>
                                                        <span className="text-[12px] font-semibold text-white">Upload Classification Subject</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Tag input block */}
                                            <div className="flex flex-col gap-2 select-none">
                                                <label className="block text-[10px] tracking-wider uppercase text-[var(--text-3)] font-bold">Categories (Press Enter to add)</label>
                                                <input
                                                    type="text"
                                                    value={tagInput}
                                                    onChange={(e) => setTagInput(e.target.value)}
                                                    onKeyDown={handleAddTag}
                                                    placeholder="Add custom classification label..."
                                                    className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-indigo-500 focus:outline-none rounded-xl px-3 py-2 text-[12.5px] text-white"
                                                />

                                                {/* Chip container with AnimatePresence */}
                                                <div className="flex flex-wrap gap-1.5 mt-2 max-h-[84px] overflow-y-auto">
                                                    <AnimatePresence>
                                                        {zeroShotTags.map((tag) => (
                                                            <motion.span
                                                                key={tag}
                                                                initial={{ scale: 0.8, opacity: 0 }}
                                                                animate={{ scale: 1, opacity: 1 }}
                                                                exit={{ scale: 0.8, opacity: 0 }}
                                                                layout
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-white/5 border border-white/10 rounded-full text-white/90"
                                                            >
                                                                <span>{tag}</span>
                                                                <button
                                                                    onClick={() => handleRemoveTag(tag)}
                                                                    className="text-[10px] text-[var(--text-3)] hover:text-white cursor-pointer select-none"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </motion.span>
                                                        ))}
                                                    </AnimatePresence>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => runDemo("zero_shot")}
                                                disabled={loading || !zeroShotImage || zeroShotTags.length === 0}
                                                className="cursor-pointer select-none self-end px-5 py-2.5 rounded-xl text-white font-semibold text-[13px] bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-md"
                                                style={{ backgroundColor: activeDemoData.accent }}
                                            >
                                                {loading ? "Matching labels..." : "Run Zero-shot Match"}
                                            </button>
                                        </div>

                                        {/* Predictions Graph */}
                                        <div className="flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xl relative min-h-[280px]">
                                            <label className="block text-[11px] tracking-wider uppercase text-[var(--text-2)] font-bold select-none border-b border-[var(--border)] pb-3">Ranked Matches</label>
                                            
                                            <div className="flex-grow flex flex-col gap-3 justify-center">
                                                {zeroShotResult.length > 0 ? (
                                                    zeroShotResult.map((c, idx) => (
                                                        <div key={idx} className="flex flex-col gap-1">
                                                            <div className="flex justify-between text-[11.5px] font-mono select-none">
                                                                <span className="text-white font-medium capitalize">&quot;{c.label}&quot;</span>
                                                                <span className="text-emerald-400 font-bold" style={{ color: activeDemoData.accent }}>{(c.score * 100).toFixed(1)}%</span>
                                                            </div>
                                                            <div className="w-full h-2 bg-[var(--surface-2)] rounded-full overflow-hidden border border-white/5">
                                                                <motion.div
                                                                    initial={{ width: 0 }}
                                                                    animate={{ width: `${c.score * 100}%` }}
                                                                    className="h-full bg-emerald-500 rounded-full"
                                                                    style={{ backgroundColor: activeDemoData.accent }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="text-center text-[var(--text-3)] italic font-mono text-[12px] select-none">Run zero-shot to see category predictions.</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Mobile Bottom Tab Bar (Visible if screen size is mobile or view === 'mobile') */}
                {(isMobileScreen || view === "mobile") && (
                    <div className="flex-none border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 pb-6 shrink-0 relative z-30">
                        <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none scroll-smooth">
                            {DEMOS.map((demo) => {
                                const isSelected = activeDemo === demo.id && isMobileFullScreen;
                                return (
                                    <button
                                        key={demo.id}
                                        onClick={() => {
                                            setActiveDemo(demo.id);
                                            setIsMobileFullScreen(true);
                                            setError(null);
                                        }}
                                        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg transition border cursor-pointer select-none ${
                                            isSelected
                                                ? "bg-indigo-500 border-indigo-500 text-white shadow-md"
                                                : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-white"
                                        }`}
                                        style={{
                                            backgroundColor: isSelected ? activeDemoData.accent : "",
                                            borderColor: isSelected ? activeDemoData.accent : ""
                                        }}
                                    >
                                        {demo.icon}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
