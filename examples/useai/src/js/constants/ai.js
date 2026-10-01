export const PROMPTS = [
    "What is 2+2?",
    "What is Antigravity and what problem does it solve for mobile developers?",
    "How does Catalyst handle cross-platform AI routing between native and web?",
    "Explain the useAI hook and why it abstracts provider decisions away from developers.",
    "What are the performance tradeoffs between on-device inference and cloud AI?",
    "How should a developer migrate an existing React Native app to Catalyst?",
];

export const LOCAL_MODELS = [
    { id: "onnx-community/Qwen2.5-0.5B-Instruct",  label: "Qwen2.5 0.5B",     size: "~300MB",  dtype: "q4f16" },
    { id: "onnx-community/Llama-3.2-1B-Instruct",  label: "Llama 3.2 1B",     size: "~700MB",  dtype: "q4f16" },
    { id: "onnx-community/Llama-3.2-3B-Instruct",  label: "Llama 3.2 3B",     size: "~2GB",    dtype: "q4f16" },
    { id: "Xenova/TinyLlama-1.1B-Chat-v1.0",       label: "TinyLlama 1.1B",   size: "~600MB",  dtype: "q4"    },
];
