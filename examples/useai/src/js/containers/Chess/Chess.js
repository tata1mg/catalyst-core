import React, { useState, useEffect, useRef } from "react";
import { Link } from "@tata1mg/router";
import { useAI } from "catalyst-core/hooks";
import { motion, AnimatePresence } from "framer-motion";
import { Chess as ChessRules } from "chess.js";

// Beautiful SVG Chess Pieces
const PIECE_SVGS = {
    w: {
        p: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-.83.33-1.41 1.15-1.41 2.1 0 1.25 1.01 2.27 2.27 2.27H25.7c1.26 0 2.27-1.02 2.27-2.27 0-.95-.58-1.77-1.41-2.1 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#fff" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
        n: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 22,10 C 22,10 19,11 16,15 C 13,19 13,23 13,23 C 13,23 14.5,21.5 15,21.5 C 15.5,21.5 16,22.5 15.5,23 C 15,23.5 13.5,25 13.5,26.5 C 13.5,28 14.5,28.5 14.5,28.5 C 14.5,28.5 16.5,26.5 18,26.5 C 19.5,26.5 19.5,28 19.5,28 C 19.5,28 18.5,29.5 17,30 C 15.5,30.5 17,32.5 19,31.5 C 21,30.5 21.5,28.5 22,28.5 C 22.5,28.5 23,30 22,31 C 21,32 23,34 25,32 C 27,30 28.5,26.5 28.5,24 C 28.5,21.5 29,20 29,20 C 29,20 31,19 32,20 C 33,21 34.5,20.5 33,18.5 C 31.5,16.5 29.5,14.5 28.5,12 C 27.5,9.5 24.5,9.5 22,10 z" fill="#fff" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
        b: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 9,36 C 9,36 22.5,37 22.5,29 C 22.5,29 20,24 20,20 C 20,15 22.5,10 22.5,10 C 22.5,10 25,15 25,20 C 25,24 22.5,29 22.5,29 C 22.5,37 36,36 36,36 C 36,36 33.5,39 22.5,39 C 11.5,39 9,36 9,36 z" fill="#fff" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="22.5" cy="5" r="2.3" fill="#fff" stroke="#000" strokeWidth="1.5" />
                <path d="M 17.5,18 L 27.5,18 M 22.5,14 L 22.5,22" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
        r: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z M 12,36 L 33,36 L 30,15 L 15,15 L 12,36 z M 13,15 L 32,15 L 35,9 L 31,9 L 31,12 L 27,12 L 27,9 L 18,9 L 18,12 L 14,12 L 14,9 L 10,9 L 13,15 z" fill="#fff" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
        q: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 9 26 C 17.5 24.5 22.5 13 22.5 13 C 22.5 13 27.5 24.5 36 26 C 33 28 31 32.5 31 35.5 L 14 35.5 C 14 32.5 12 28 9 26 z" fill="#fff" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="6" cy="12" r="2.75" fill="#fff" stroke="#000" strokeWidth="1.5" />
                <circle cx="14" cy="9" r="2.75" fill="#fff" stroke="#000" strokeWidth="1.5" />
                <circle cx="22.5" cy="7.5" r="2.75" fill="#fff" stroke="#000" strokeWidth="1.5" />
                <circle cx="31" cy="9" r="2.75" fill="#fff" stroke="#000" strokeWidth="1.5" />
                <circle cx="39" cy="12" r="2.75" fill="#fff" stroke="#000" strokeWidth="1.5" />
                <path d="M 9,26 L 22.5,9 L 36,26 M 9,26 L 22.5,7.5 L 36,26" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
        k: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 22.5,11.63 L 22.5,6 M 20,8 L 25,8 M 22.5,11.63 C 22.5,11.63 26.5,8 29.5,12 C 32.5,16 28.5,28.5 28.5,28.5 L 16.5,28.5 C 16.5,28.5 12.5,16 15.5,12 C 18.5,8 22.5,11.63 22.5,11.63 z" fill="#fff" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M 11.5,30 C 11.5,30 22.5,31 22.5,25.5 C 22.5,31 33.5,30 33.5,30 C 33.5,30 31,33 22.5,33 C 14,33 11.5,30 11.5,30 z" fill="#fff" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
    },
    b: {
        p: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-.83.33-1.41 1.15-1.41 2.1 0 1.25 1.01 2.27 2.27 2.27H25.7c1.26 0 2.27-1.02 2.27-2.27 0-.95-.58-1.77-1.41-2.1 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#4f5b66" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
        n: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 22,10 C 22,10 19,11 16,15 C 13,19 13,23 13,23 C 13,23 14.5,21.5 15,21.5 C 15.5,21.5 16,22.5 15.5,23 C 15,23.5 13.5,25 13.5,26.5 C 13.5,28 14.5,28.5 14.5,28.5 C 14.5,28.5 16.5,26.5 18,26.5 C 19.5,26.5 19.5,28 19.5,28 C 19.5,28 18.5,29.5 17,30 C 15.5,30.5 17,32.5 19,31.5 C 21,30.5 21.5,28.5 22,28.5 C 22.5,28.5 23,30 22,31 C 21,32 23,34 25,32 C 27,30 28.5,26.5 28.5,24 C 28.5,21.5 29,20 29,20 C 29,20 31,19 32,20 C 33,21 34.5,20.5 33,18.5 C 31.5,16.5 29.5,14.5 28.5,12 C 27.5,9.5 24.5,9.5 22,10 z" fill="#4f5b66" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
        b: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 9,36 C 9,36 22.5,37 22.5,29 C 22.5,29 20,24 20,20 C 20,15 22.5,10 22.5,10 C 22.5,10 25,15 25,20 C 25,24 22.5,29 22.5,29 C 22.5,37 36,36 36,36 C 36,36 33.5,39 22.5,39 C 11.5,39 9,36 9,36 z" fill="#4f5b66" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="22.5" cy="5" r="2.3" fill="#4f5b66" stroke="#000" strokeWidth="1.5" />
                <path d="M 17.5,18 L 27.5,18 M 22.5,14 L 22.5,22" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
        r: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z M 12,36 L 33,36 L 30,15 L 15,15 L 12,36 z M 13,15 L 32,15 L 35,9 L 31,9 L 31,12 L 27,12 L 27,9 L 18,9 L 18,12 L 14,12 L 14,9 L 10,9 L 13,15 z" fill="#4f5b66" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
        q: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 9 26 C 17.5 24.5 22.5 13 22.5 13 C 22.5 13 27.5 24.5 36 26 C 33 28 31 32.5 31 35.5 L 14 35.5 C 14 32.5 12 28 9 26 z" fill="#4f5b66" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="6" cy="12" r="2.75" fill="#4f5b66" stroke="#000" strokeWidth="1.5" />
                <circle cx="14" cy="9" r="2.75" fill="#4f5b66" stroke="#000" strokeWidth="1.5" />
                <circle cx="22.5" cy="7.5" r="2.75" fill="#4f5b66" stroke="#000" strokeWidth="1.5" />
                <circle cx="31" cy="9" r="2.75" fill="#4f5b66" stroke="#000" strokeWidth="1.5" />
                <circle cx="39" cy="12" r="2.75" fill="#4f5b66" stroke="#000" strokeWidth="1.5" />
                <path d="M 9,26 L 22.5,9 L 36,26 M 9,26 L 22.5,7.5 L 36,26" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
        k: (
            <svg viewBox="0 0 45 45" className="w-[85%] h-[85%] select-none">
                <path d="M 22.5,11.63 L 22.5,6 M 20,8 L 25,8 M 22.5,11.63 C 22.5,11.63 26.5,8 29.5,12 C 32.5,16 28.5,28.5 28.5,28.5 L 16.5,28.5 C 16.5,28.5 12.5,16 15.5,12 C 18.5,8 22.5,11.63 22.5,11.63 z" fill="#4f5b66" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M 11.5,30 C 11.5,30 22.5,31 22.5,25.5 C 22.5,31 33.5,30 33.5,30 C 33.5,30 31,33 22.5,33 C 14,33 11.5,30 11.5,30 z" fill="#4f5b66" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
    }
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

export default function Chess() {
    const chessRef = useRef(null);
    const [fen, setFen] = useState("start");
    const [selectedSquare, setSelectedSquare] = useState(null);
    const [possibleMoves, setPossibleMoves] = useState([]);
    const [isPlayerTurn, setIsPlayerTurn] = useState(true); // Player is White
    const [provider, setProvider] = useState("openai");
    const [history, setHistory] = useState([]);
    const [gameStatus, setGameStatus] = useState("active"); // 'active' | 'checkmate_win' | 'checkmate_loss' | 'draw'
    const [lastMove, setLastMove] = useState(null); // { from, to }
    const [aiThinking, setAiThinking] = useState(false);
    const moveLogEndRef = useRef(null);

    // Initialize chess rules instance
    useEffect(() => {
        chessRef.current = new ChessRules();
        setFen(chessRef.current.fen());
    }, []);

    // Scroll move log to bottom
    useEffect(() => {
        if (moveLogEndRef.current) {
            moveLogEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [history]);

    // Set up useAI Hook
    const useAIResult = useAI({
        provider,
        sessionMode: "stateful",
        genConfig: {
            stream: false,
            temperature: 0.1,
            maxTokens: 20
        },
        systemPrompt: "You are a chess engine playing as Black. Return only the selected move in SAN notation."
    });

    const { generate, loading, error, output, reset } = useAIResult;

    // Check game condition
    const checkGameStatus = () => {
        const chess = chessRef.current;
        if (!chess) return;

        if (chess.isGameOver()) {
            if (chess.isCheckmate()) {
                // If it's White's turn to play (after Black played), Black won, so checkmate_loss.
                // If it's Black's turn to play (after White played), White won, so checkmate_win.
                if (chess.turn() === "w") {
                    setGameStatus("checkmate_loss");
                } else {
                    setGameStatus("checkmate_win");
                }
            } else {
                setGameStatus("draw");
            }
        }
    };

    // User selection/move interaction
    const handleSquareClick = (square) => {
        if (!isPlayerTurn || gameStatus !== "active" || aiThinking || !chessRef.current) return;

        const chess = chessRef.current;
        const piece = chess.get(square);

        // Clicked own piece
        if (piece && piece.color === "w") {
            setSelectedSquare(square);
            const moves = chess.moves({ square, verbose: true });
            setPossibleMoves(moves.map(m => m.to));
            return;
        }

        // Clicked destination square to move selected piece
        if (selectedSquare && possibleMoves.includes(square)) {
            const moves = chess.moves({ square: selectedSquare, verbose: true });
            const matchedMove = moves.find(m => m.to === square);

            if (matchedMove) {
                // Execute move
                const result = chess.move({
                    from: selectedSquare,
                    to: square,
                    promotion: matchedMove.flags.includes("p") ? "q" : undefined // Auto promote to queen for simplicity
                });

                if (result) {
                    setFen(chess.fen());
                    setHistory(chess.history());
                    setLastMove({ from: selectedSquare, to: square });
                    setSelectedSquare(null);
                    setPossibleMoves([]);

                    // Check win/loss/draw
                    if (chess.isGameOver()) {
                        checkGameStatus();
                    } else {
                        setIsPlayerTurn(false);
                        triggerAIMove();
                    }
                }
            }
        } else {
            // Cancel selection
            setSelectedSquare(null);
            setPossibleMoves([]);
        }
    };

    // AI logic trigger
    const triggerAIMove = async () => {
        setAiThinking(true);
        const chess = chessRef.current;
        if (!chess) return;

        const validMoves = chess.moves();
        const fullHistory = chess.history();

        const promptMsg = `The game is Chess. You are playing as Black ('b'). The opponent is White ('w').
The current board state in FEN notation is:
${chess.fen()}

The complete match history is:
${fullHistory.join(" ")}

The list of all legal moves you can play is:
${validMoves.join(", ")}

Please select your next move from the legal moves list. Play strategically.
IMPORTANT: Respond with ONLY the selected SAN move (e.g. "Nf6", "exd5", "O-O") exactly as it appears in the list. Do not include extra text, explanations, markdown or brackets. Just the move.`;

        try {
            await generate({
                messages: [{ role: "user", content: promptMsg }]
            });
        } catch (e) {
            console.error("Chess AI move failed, choosing fallback", e);
            makeFallbackMove(validMoves);
        }
    };

    // Listen to AI response
    useEffect(() => {
        if (aiThinking && !loading && !error && chessRef.current) {
            setAiThinking(false);
            const chess = chessRef.current;
            const validMoves = chess.moves();
            const cleanOutput = (output || "").trim().replace(/[\[\]"`'“”’\s]/g, "");

            // Look for case insensitive matches in legal moves
            const matchedMove = validMoves.find(
                m => m.toLowerCase() === cleanOutput.toLowerCase()
            );

            if (matchedMove) {
                executeAIMove(matchedMove);
            } else {
                // Try fuzzy check or fallback
                console.warn(`Chess AI returned invalid move: "${output}". Fallback active.`);
                makeFallbackMove(validMoves);
            }
        } else if (error && aiThinking) {
            setAiThinking(false);
            if (chessRef.current) {
                makeFallbackMove(chessRef.current.moves());
            }
        }
    }, [loading, error, output]);

    const executeAIMove = (moveStr) => {
        const chess = chessRef.current;
        if (!chess) return;

        // Perform move validation and get details to highlight
        const movesBefore = chess.moves({ verbose: true });
        const moveObj = movesBefore.find(m => m.san === moveStr);
        
        const result = chess.move(moveStr);
        if (result) {
            setFen(chess.fen());
            setHistory(chess.history());
            if (moveObj) {
                setLastMove({ from: moveObj.from, to: moveObj.to });
            }
            
            if (chess.isGameOver()) {
                checkGameStatus();
            } else {
                setIsPlayerTurn(true);
            }
        }
    };

    const makeFallbackMove = (validMoves) => {
        if (validMoves.length === 0) return;
        // Simple random legal fallback
        const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
        executeAIMove(randomMove);
    };

    const handleRestart = () => {
        chessRef.current = new ChessRules();
        setFen(chessRef.current.fen());
        setHistory([]);
        setLastMove(null);
        setSelectedSquare(null);
        setPossibleMoves([]);
        setIsPlayerTurn(true);
        setGameStatus("active");
        setAiThinking(false);
        reset();
    };

    // Helper to check if a square is light or dark
    const isLightSquare = (fileIdx, rankIdx) => {
        return (fileIdx + rankIdx) % 2 === 0;
    };

    // Render board cells representation
    const renderBoardSquares = () => {
        if (!chessRef.current) return null;
        const chess = chessRef.current;
        const inCheckSquare = chess.inCheck() && chess.turn() === "w"
            ? findKingSquare("w")
            : chess.inCheck() && chess.turn() === "b"
                ? findKingSquare("b")
                : null;

        const rendered = [];
        RANKS.forEach((rank, rankIdx) => {
            FILES.forEach((file, fileIdx) => {
                const square = `${file}${rank}`;
                const piece = chess.get(square);
                const isLight = isLightSquare(fileIdx, rankIdx);
                const isSelected = selectedSquare === square;
                const isPossible = possibleMoves.includes(square);
                const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
                const isCheck = inCheckSquare === square;

                rendered.push(
                    <div
                        key={square}
                        onClick={() => handleSquareClick(square)}
                        className={`relative aspect-square flex items-center justify-center cursor-pointer select-none transition-all duration-200 ${
                            isLight
                                ? "bg-[#383f55]/30 hover:bg-[#383f55]/45"
                                : "bg-[#1c2030] hover:bg-[#1c2030]/90"
                        } ${
                            isSelected ? "ring-2 ring-indigo-500 ring-inset bg-indigo-500/10 z-10" : ""
                        } ${
                            isLast ? "border border-amber-500/50 bg-amber-500/5" : ""
                        } ${
                            isCheck ? "bg-red-500/25 ring-2 ring-red-500 z-10 shadow-[0_0_15px_rgba(239,68,68,0.4)]" : ""
                        }`}
                    >
                        {/* Piece Icon */}
                        {piece && (
                            <motion.div
                                layoutId={`piece-${square}-${piece.color}-${piece.type}`}
                                className="w-full h-full flex items-center justify-center"
                                transition={{ type: "spring", stiffness: 220, damping: 20 }}
                            >
                                {PIECE_SVGS[piece.color][piece.type]}
                            </motion.div>
                        )}

                        {/* Possible moves indicator */}
                        {isPossible && (
                            <div className="absolute w-3.5 h-3.5 bg-[var(--green)]/60 rounded-full shadow-[0_0_8px_rgba(70,212,131,0.5)] z-20" />
                        )}

                        {/* Coordinates labels on bottom/left edges */}
                        {fileIdx === 0 && (
                            <span className="absolute top-1 left-1.5 text-[8.5px] font-mono text-neutral-500 font-semibold pointer-events-none select-none">
                                {rank}
                            </span>
                        )}
                        {rankIdx === 7 && (
                            <span className="absolute bottom-0.5 right-1.5 text-[8.5px] font-mono text-neutral-500 font-semibold pointer-events-none select-none">
                                {file}
                            </span>
                        )}
                    </div>
                );
            });
        });

        return rendered;
    };

    const findKingSquare = (color) => {
        if (!chessRef.current) return null;
        for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
            for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
                const square = `${FILES[fileIdx]}${RANKS[rankIdx]}`;
                const piece = chessRef.current.get(square);
                if (piece && piece.type === "k" && piece.color === color) {
                    return square;
                }
            }
        }
        return null;
    };

    // Format moves in groups for clean table presentation
    const renderMoveList = () => {
        const rows = [];
        for (let i = 0; i < history.length; i += 2) {
            const moveNum = Math.floor(i / 2) + 1;
            rows.push(
                <div key={moveNum} className="flex border-b border-[var(--border)] py-1.5 text-[12.5px] font-mono">
                    <span className="w-12 text-[var(--text-3)] text-right pr-3 select-none">{moveNum}.</span>
                    <span className="flex-1 text-white/90 font-medium">{history[i]}</span>
                    <span className="flex-1 text-neutral-400 font-medium">{history[i + 1] || "..."}</span>
                </div>
            );
        }
        return rows;
    };

    return (
        <div className="max-w-[1200px] mx-auto px-6 py-12 animate-[fadeIn_0.5s_ease-out]">
            {/* Top Bar */}
            <div className="flex items-center justify-between mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] font-mono text-[11px] text-[var(--text-2)] select-none shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                    <span>useAI</span>
                    <span className="text-[var(--text-3)]">|</span>
                    <span className="text-white font-semibold">Chess Grandmaster AI</span>
                </div>
                <Link
                    to="/"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-white font-mono text-[10.5px] font-bold uppercase tracking-wider transition no-underline shadow-sm"
                >
                    ← Back to Showcase
                </Link>
            </div>

            <div className="text-center md:text-left mb-8">
                <h1 className="text-4xl font-semibold text-white tracking-tight mb-2">Chess Grandmaster AI</h1>
                <p className="text-[14px] leading-relaxed text-[var(--text-2)] max-w-[60ch]">
                    Play Chess against a cloud AI opponent. Choose your engine provider to see how they perform in complex chess logic and positional strategy.
                </p>
            </div>

            {/* Dashboard grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Side Logs and Controls */}
                <div className="lg:col-span-4 flex flex-col gap-6 order-2 lg:order-1">
                    
                    {/* Engine selection */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-xl select-none">
                        <h2 className="text-[13px] tracking-wider uppercase text-[var(--text-3)] font-bold mb-4 font-mono">Opponent Settings</h2>
                        
                        <div className="flex flex-col gap-5">
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

                            <div className="pt-4 border-t border-[var(--border)] flex items-center justify-between">
                                <span className="text-[12px] text-[var(--text-2)] font-mono">Status:</span>
                                <div className="flex items-center gap-2">
                                    {gameStatus !== "active" ? (
                                        <span className="text-[12px] font-bold text-[var(--teal)] uppercase font-mono tracking-wider">Game Over</span>
                                    ) : aiThinking ? (
                                        <span className="flex items-center gap-1.5 text-[12px] font-bold text-amber-400 uppercase font-mono tracking-wider">
                                            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping" />
                                            AI thinking
                                        </span>
                                    ) : isPlayerTurn ? (
                                        <span className="text-[12px] font-bold text-[var(--accent)] uppercase font-mono tracking-wider">Your Turn (White)</span>
                                    ) : (
                                        <span className="text-[12px] font-bold text-indigo-400 uppercase font-mono tracking-wider">AI Turn (Black)</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Move Logs card */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-xl flex flex-col h-[320px]">
                        <h2 className="text-[13px] tracking-wider uppercase text-[var(--text-3)] font-bold mb-3 font-mono">Match Move Log</h2>
                        <div className="flex-1 overflow-y-auto pr-1 border border-[var(--border)] rounded-xl p-3 bg-[var(--surface-2)]/40">
                            {history.length === 0 ? (
                                <div className="text-[12px] text-[var(--text-3)] italic text-center py-10 font-mono select-none">No moves played yet</div>
                            ) : (
                                <div>
                                    {renderMoveList()}
                                    <div ref={moveLogEndRef} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main Chessboard View */}
                <div className="lg:col-span-8 flex flex-col items-center order-1 lg:order-2">
                    
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 shadow-2xl w-full max-w-[560px] flex flex-col items-center relative overflow-hidden">
                        
                        {/* Board container */}
                        <div className="relative w-full aspect-square bg-[var(--surface-2)]/30 border border-[var(--border-2)] rounded-2xl p-4 overflow-hidden shadow-inner">
                            
                            {/* 8x8 Grid */}
                            <div className="grid grid-cols-8 grid-rows-8 w-full h-full border border-neutral-900 rounded-lg overflow-hidden relative">
                                {renderBoardSquares()}
                            </div>

                            {/* AI Thinking Screen overlay */}
                            {aiThinking && (
                                <div className="absolute inset-0 bg-[var(--surface)]/60 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center transition-all duration-300 z-30">
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
                                        AI computing move
                                    </div>
                                </div>
                            )}

                            {/* Game End Overlay */}
                            {gameStatus !== "active" && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="absolute inset-0 bg-[var(--surface-2)]/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-6 text-center select-text z-40"
                                >
                                    {gameStatus === "checkmate_win" && (
                                        <>
                                            <div className="text-4xl mb-3">🏆</div>
                                            <h3 className="text-2xl font-bold text-[var(--green)] mb-1">Checkmate!</h3>
                                            <p className="text-[13px] text-[var(--text-2)] mb-5">You defeated the AI opponent.</p>
                                        </>
                                    )}
                                    {gameStatus === "checkmate_loss" && (
                                        <>
                                            <div className="text-4xl mb-3">🤖</div>
                                            <h3 className="text-2xl font-bold text-[var(--red)] mb-1">Checkmate</h3>
                                            <p className="text-[13px] text-[var(--text-2)] mb-5">The AI engine won this match.</p>
                                        </>
                                    )}
                                    {gameStatus === "draw" && (
                                        <>
                                            <div className="text-4xl mb-3">🤝</div>
                                            <h3 className="text-2xl font-bold text-[var(--text-2)] mb-1">Draw</h3>
                                            <p className="text-[13px] text-[var(--text-2)] mb-5">Match ended in a tie/stalemate.</p>
                                        </>
                                    )}

                                    <button
                                        onClick={handleRestart}
                                        className="cursor-pointer border-0 bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-[13px] px-6 py-2.5 rounded-xl shadow-[0_8px_20px_-8px_rgba(99,102,241,0.5)] transition hover:-translate-y-0.5"
                                    >
                                        New Game
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
