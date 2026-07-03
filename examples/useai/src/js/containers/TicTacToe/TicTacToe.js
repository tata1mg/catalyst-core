import React, { useState, useEffect, useRef } from "react";
import { Link } from "@tata1mg/router";
import { useAI } from "catalyst-core/hooks";
import { motion, AnimatePresence } from "framer-motion";

const WINNING_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6]             // diagonals
];

export default function TicTacToe() {
    const [board, setBoard] = useState(Array(9).fill(null));
    const [isPlayerTurn, setIsPlayerTurn] = useState(true);
    const [provider, setProvider] = useState("openai"); // 'openai' or 'gemini'
    const [gameStatus, setGameStatus] = useState("active"); // 'active' | 'won' | 'lost' | 'draw'
    const [winningLine, setWinningLine] = useState(null);
    const [stats, setStats] = useState(() => {
        try {
            const saved = localStorage.getItem("tictactoe_stats");
            return saved ? JSON.parse(saved) : { playerWins: 0, aiWins: 0, draws: 0 };
        } catch {
            return { playerWins: 0, aiWins: 0, draws: 0 };
        }
    });

    // Save stats
    useEffect(() => {
        localStorage.setItem("tictactoe_stats", JSON.stringify(stats));
    }, [stats]);

    // Set up useAI Hook
    const useAIResult = useAI({
        provider,
        sessionMode: "stateless",
        genConfig: {
            stream: false,
            temperature: 0.1,
            maxTokens: 10
        },
        systemPrompt: "You are an AI playing Tic Tac Toe. You play to win and block opponents. Keep responses minimal."
    });

    const { generate, loading, error, output, reset } = useAIResult;

    // Track AI thinking states manually to sync with hook lifecycle
    const [aiThinking, setAiThinking] = useState(false);

    // Board analyzer
    const checkWinner = (currentBoard) => {
        for (const combo of WINNING_COMBOS) {
            const [a, b, c] = combo;
            if (currentBoard[a] && currentBoard[a] === currentBoard[b] && currentBoard[a] === currentBoard[c]) {
                return { winner: currentBoard[a], combo };
            }
        }
        if (currentBoard.every(cell => cell !== null)) {
            return { winner: "draw", combo: null };
        }
        return null;
    };

    // When the user plays a move
    const handleCellClick = (index) => {
        if (board[index] || !isPlayerTurn || gameStatus !== "active" || aiThinking) return;

        const nextBoard = [...board];
        nextBoard[index] = "X"; // Player is X
        setBoard(nextBoard);

        const result = checkWinner(nextBoard);
        if (result) {
            handleGameEnd(result);
        } else {
            setIsPlayerTurn(false);
            triggerAIMove(nextBoard);
        }
    };

    // Game end handler
    const handleGameEnd = (result) => {
        if (result.winner === "X") {
            setGameStatus("won");
            setWinningLine(result.combo);
            setStats(prev => ({ ...prev, playerWins: prev.playerWins + 1 }));
        } else if (result.winner === "O") {
            setGameStatus("lost");
            setWinningLine(result.combo);
            setStats(prev => ({ ...prev, aiWins: prev.aiWins + 1 }));
        } else {
            setGameStatus("draw");
            setStats(prev => ({ ...prev, draws: prev.draws + 1 }));
        }
    };

    // AI logic
    const triggerAIMove = async (currentBoard) => {
        setAiThinking(true);
        const emptyIndices = currentBoard
            .map((cell, idx) => cell === null ? idx : null)
            .filter(val => val !== null);

        if (emptyIndices.length === 0) return;

        const promptMsg = `The game is Tic Tac Toe. You are 'O' and the player is 'X'.
The current board state is represented as a 9-element array (indices 0 to 8):
${JSON.stringify(currentBoard)}

The empty indices on the board are: ${JSON.stringify(emptyIndices)}.
Please select your next move from the empty indices. Choose index strategically to win or block X.
IMPORTANT: Respond with ONLY the number of the index (0 to 8) that you choose. Do not write anything else. Just the single digit index.`;

        try {
            await generate({
                messages: [{ role: "user", content: promptMsg }]
            });
        } catch (e) {
            console.error("AI move fetch failed, using fallback", e);
            makeFallbackMove(currentBoard, emptyIndices);
        }
    };

    // Listen to AI response completion
    const lastOutputRef = useRef("");
    useEffect(() => {
        if (aiThinking && !loading && !error) {
            // When loading finishes, evaluate output
            setAiThinking(false);
            
            const rawOutput = output || "";
            const cleanText = rawOutput.trim();
            const match = cleanText.match(/\b[0-8]\b/);
            const emptyIndices = board
                .map((cell, idx) => cell === null ? idx : null)
                .filter(val => val !== null);

            let chosenIndex = match ? parseInt(match[0], 10) : null;

            // Validation: Make sure the chosen cell is indeed empty
            if (chosenIndex !== null && emptyIndices.includes(chosenIndex)) {
                executeAIMove(chosenIndex);
            } else {
                console.warn(`AI returned invalid or empty cell: "${rawOutput}". Fallback engaged.`);
                makeFallbackMove(board, emptyIndices);
            }
        } else if (error) {
            setAiThinking(false);
            const emptyIndices = board
                .map((cell, idx) => cell === null ? idx : null)
                .filter(val => val !== null);
            makeFallbackMove(board, emptyIndices);
        }
    }, [loading, error, output]);

    const executeAIMove = (index) => {
        const nextBoard = [...board];
        nextBoard[index] = "O";
        setBoard(nextBoard);

        const result = checkWinner(nextBoard);
        if (result) {
            handleGameEnd(result);
        } else {
            setIsPlayerTurn(true);
        }
    };

    const makeFallbackMove = (currentBoard, emptyIndices) => {
        if (emptyIndices.length === 0) return;
        
        // Strategic simple fallback logic if AI fails:
        // Try to win, block, or take center, then corners, then random
        const findBestFallback = () => {
            // 1. Can we win?
            for (const combo of WINNING_COMBOS) {
                const [a, b, c] = combo;
                const vals = [currentBoard[a], currentBoard[b], currentBoard[c]];
                const oCount = vals.filter(v => v === "O").length;
                const nullCount = vals.filter(v => v === null).length;
                if (oCount === 2 && nullCount === 1) {
                    return combo[vals.indexOf(null)];
                }
            }
            // 2. Can we block?
            for (const combo of WINNING_COMBOS) {
                const [a, b, c] = combo;
                const vals = [currentBoard[a], currentBoard[b], currentBoard[c]];
                const xCount = vals.filter(v => v === "X").length;
                const nullCount = vals.filter(v => v === null).length;
                if (xCount === 2 && nullCount === 1) {
                    return combo[vals.indexOf(null)];
                }
            }
            // 3. Center
            if (emptyIndices.includes(4)) return 4;
            // 4. Corners
            const corners = [0, 2, 6, 8].filter(c => emptyIndices.includes(c));
            if (corners.length > 0) return corners[Math.floor(Math.random() * corners.length)];
            // 5. Random
            return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
        };

        const bestIdx = findBestFallback();
        executeAIMove(bestIdx);
    };

    // Restart game
    const handleRestart = () => {
        setBoard(Array(9).fill(null));
        setIsPlayerTurn(true);
        setGameStatus("active");
        setWinningLine(null);
        setAiThinking(false);
        reset();
    };

    const resetStats = () => {
        setStats({ playerWins: 0, aiWins: 0, draws: 0 });
    };

    return (
        <div className="max-w-[1200px] mx-auto px-6 py-12 animate-[fadeIn_0.5s_ease-out]">
            {/* Top Bar */}
            <div className="flex items-center justify-between mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] font-mono text-[11px] text-[var(--text-2)] select-none shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                    <span>useAI</span>
                    <span className="text-[var(--text-3)]">|</span>
                    <span className="text-white font-semibold">Tic-Tac-Toe Arena</span>
                </div>
                <Link
                    to="/"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-white font-mono text-[10.5px] font-bold uppercase tracking-wider transition no-underline shadow-sm"
                >
                    ← Back to Showcase
                </Link>
            </div>

            <div className="text-center md:text-left mb-8">
                <h1 className="text-4xl font-semibold text-white tracking-tight mb-2">Tic-Tac-Toe AI Arena</h1>
                <p className="text-[14px] leading-relaxed text-[var(--text-2)] max-w-[60ch]">
                    Play Tic-Tac-Toe against artificial intelligence. Choose your cloud model provider and test their logical strategic capabilities in real time.
                </p>
            </div>

            {/* Dashboard Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Side Controls */}
                <div className="lg:col-span-4 flex flex-col gap-6">
                    {/* Settings card */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-xl select-none">
                        <h2 className="text-[13px] tracking-wider uppercase text-[var(--text-3)] font-bold mb-4 font-mono">Opponent Settings</h2>
                        
                        <div className="flex flex-col gap-5">
                            {/* Provider Toggle */}
                            <div>
                                <label className="text-[12px] font-semibold text-[var(--text-2)] block mb-2 font-mono">Select AI Engine</label>
                                <div className="grid grid-cols-2 gap-2 bg-[var(--surface-2)] p-1 rounded-xl border border-[var(--border)]">
                                    <button
                                        type="button"
                                        onClick={() => setProvider("openai")}
                                        className={`py-2 rounded-lg font-semibold text-[12px] transition cursor-pointer ${
                                            provider === "openai"
                                                ? "bg-indigo-500 text-white shadow-md"
                                                : "text-[var(--text-2)] hover:text-white"
                                        }`}
                                    >
                                        OpenAI (GPT-4o)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setProvider("gemini")}
                                        className={`py-2 rounded-lg font-semibold text-[12px] transition cursor-pointer ${
                                            provider === "gemini"
                                                ? "bg-indigo-500 text-white shadow-md"
                                                : "text-[var(--text-2)] hover:text-white"
                                        }`}
                                    >
                                        Gemini (3.5 Flash)
                                    </button>
                                </div>
                            </div>

                            {/* Current Turn display */}
                            <div className="pt-4 border-t border-[var(--border)] flex items-center justify-between">
                                <span className="text-[12px] text-[var(--text-2)] font-mono">Current Turn:</span>
                                <div className="flex items-center gap-2">
                                    {gameStatus !== "active" ? (
                                        <span className="text-[12px] font-bold text-[var(--teal)] uppercase font-mono tracking-wider">Game Over</span>
                                    ) : aiThinking ? (
                                        <span className="flex items-center gap-1.5 text-[12px] font-bold text-amber-400 uppercase font-mono tracking-wider">
                                            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping" />
                                            AI thinking
                                        </span>
                                    ) : isPlayerTurn ? (
                                        <span className="text-[12px] font-bold text-[var(--accent)] uppercase font-mono tracking-wider">Your Turn (X)</span>
                                    ) : (
                                        <span className="text-[12px] font-bold text-indigo-400 uppercase font-mono tracking-wider">AI Turn (O)</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Stats Card */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-[13px] tracking-wider uppercase text-[var(--text-3)] font-bold font-mono">Arena Record</h2>
                            <button
                                onClick={resetStats}
                                className="text-[11px] font-mono text-[var(--text-3)] hover:text-red-400 transition cursor-pointer"
                            >
                                Reset Record
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3">
                                <div className="text-[11px] text-[var(--text-2)] font-semibold font-mono uppercase mb-1">Wins</div>
                                <div className="text-2xl font-bold text-[var(--green)] font-mono">{stats.playerWins}</div>
                            </div>
                            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3">
                                <div className="text-[11px] text-[var(--text-2)] font-semibold font-mono uppercase mb-1">Losses</div>
                                <div className="text-2xl font-bold text-[var(--red)] font-mono">{stats.aiWins}</div>
                            </div>
                            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3">
                                <div className="text-[11px] text-[var(--text-2)] font-semibold font-mono uppercase mb-1">Draws</div>
                                <div className="text-2xl font-bold text-[var(--text-2)] font-mono">{stats.draws}</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Game Screen */}
                <div className="lg:col-span-8 flex flex-col items-center">
                    
                    {/* Game board card */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 shadow-2xl w-full max-w-[480px] flex flex-col items-center relative overflow-hidden">
                        
                        {/* Glassmorphic Board container */}
                        <div className="grid grid-cols-3 gap-3.5 bg-[var(--surface-2)]/60 border border-[var(--border-2)] rounded-2xl p-4.5 w-full aspect-square relative select-none">
                            {board.map((cell, index) => {
                                const isWinningCell = winningLine && winningLine.includes(index);
                                return (
                                    <button
                                        key={index}
                                        onClick={() => handleCellClick(index)}
                                        disabled={cell !== null || !isPlayerTurn || gameStatus !== "active" || aiThinking}
                                        className={`relative flex items-center justify-center rounded-xl bg-[var(--surface-3)]/40 border transition-all duration-300 font-bold ${
                                            cell === null && isPlayerTurn && gameStatus === "active" && !aiThinking
                                                ? "hover:bg-[var(--surface-3)] cursor-pointer hover:shadow-lg border-[var(--border)] hover:border-[var(--accent-line)]"
                                                : "border-[var(--border)]"
                                        } ${
                                            isWinningCell ? "bg-[var(--accent-dim)] border-[var(--accent)] shadow-[0_0_15px_rgba(99,102,241,0.2)]" : ""
                                        }`}
                                    >
                                        <AnimatePresence mode="wait">
                                            {cell === "X" && (
                                                <motion.div
                                                    key="X"
                                                    initial={{ scale: 0, rotate: -45, opacity: 0 }}
                                                    animate={{ scale: 1, rotate: 0, opacity: 1 }}
                                                    exit={{ scale: 0, opacity: 0 }}
                                                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                                                    className="w-12 h-12 flex items-center justify-center"
                                                >
                                                    {/* SVG X Piece */}
                                                    <svg className="w-10 h-10 stroke-[var(--accent)]" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round">
                                                        <path d="M18 6 6 18M6 6l12 12" />
                                                    </svg>
                                                </motion.div>
                                            )}
                                            {cell === "O" && (
                                                <motion.div
                                                    key="O"
                                                    initial={{ scale: 0, rotate: 45, opacity: 0 }}
                                                    animate={{ scale: 1, rotate: 0, opacity: 1 }}
                                                    exit={{ scale: 0, opacity: 0 }}
                                                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                                                    className="w-12 h-12 flex items-center justify-center"
                                                >
                                                    {/* SVG O Piece */}
                                                    <svg className="w-10 h-10 stroke-[var(--teal)]" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round">
                                                        <circle cx="12" cy="12" r="9" />
                                                    </svg>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </button>
                                );
                            })}

                            {/* Thinking Overlay */}
                            {aiThinking && (
                                <div className="absolute inset-0 bg-[var(--surface)]/60 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center transition-all duration-300">
                                    <div className="flex gap-2 mb-3">
                                        <motion.span
                                            animate={{ y: [0, -10, 0] }}
                                            transition={{ repeat: Infinity, duration: 0.6, delay: 0 }}
                                            className="w-3.5 h-3.5 bg-[var(--teal)] rounded-full shadow-[0_0_8px_#2dd4bf]"
                                        />
                                        <motion.span
                                            animate={{ y: [0, -10, 0] }}
                                            transition={{ repeat: Infinity, duration: 0.6, delay: 0.15 }}
                                            className="w-3.5 h-3.5 bg-[var(--accent)] rounded-full shadow-[0_0_8px_#6366f1]"
                                        />
                                        <motion.span
                                            animate={{ y: [0, -10, 0] }}
                                            transition={{ repeat: Infinity, duration: 0.6, delay: 0.3 }}
                                            className="w-3.5 h-3.5 bg-[var(--teal)] rounded-full shadow-[0_0_8px_#2dd4bf]"
                                        />
                                    </div>
                                    <div className="text-[12px] font-bold font-mono text-white/90 uppercase tracking-widest">
                                        AI is matching moves
                                    </div>
                                </div>
                            )}

                            {/* Game End Overlay */}
                            {gameStatus !== "active" && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="absolute inset-0 bg-[var(--surface-2)]/90 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-6 text-center select-text"
                                >
                                    {gameStatus === "won" && (
                                        <>
                                            <div className="text-4xl mb-3">🎉</div>
                                            <h3 className="text-2xl font-bold text-[var(--green)] mb-1">Victory!</h3>
                                            <p className="text-[13px] text-[var(--text-2)] mb-5">You defeated the AI.</p>
                                        </>
                                    )}
                                    {gameStatus === "lost" && (
                                        <>
                                            <div className="text-4xl mb-3">🤖</div>
                                            <h3 className="text-2xl font-bold text-[var(--red)] mb-1">Defeated</h3>
                                            <p className="text-[13px] text-[var(--text-2)] mb-5">AI won this round.</p>
                                        </>
                                    )}
                                    {gameStatus === "draw" && (
                                        <>
                                            <div className="text-4xl mb-3">🤝</div>
                                            <h3 className="text-2xl font-bold text-[var(--text-2)] mb-1">Tie Game</h3>
                                            <p className="text-[13px] text-[var(--text-2)] mb-5">A perfectly balanced match.</p>
                                        </>
                                    )}

                                    <button
                                        onClick={handleRestart}
                                        className="cursor-pointer border-0 bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-[13px] px-6 py-2.5 rounded-xl shadow-[0_8px_20px_-8px_rgba(99,102,241,0.5)] transition hover:-translate-y-0.5"
                                    >
                                        Play Again
                                    </button>
                                </motion.div>
                            )}
                        </div>

                        {/* Reset button at bottom of active game */}
                        {gameStatus === "active" && (
                            <button
                                onClick={handleRestart}
                                className="mt-6 text-[12px] font-bold font-mono tracking-wider text-[var(--text-2)] hover:text-white flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition cursor-pointer"
                            >
                                🔄 Reset Match
                            </button>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
