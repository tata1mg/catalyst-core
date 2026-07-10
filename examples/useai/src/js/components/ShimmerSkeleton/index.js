import React from "react";

export default function ShimmerSkeleton({ rows = 2, width = "100%", height = "9px", className = "" }) {
    const rowList = Array.from({ length: rows });

    return (
        <div className={`flex flex-col gap-2 ${className}`} style={{ width }}>
            {rowList.map((_, index) => {
                // Vary width of final row for a natural text paragraph look
                const rowWidth = index === rowList.length - 1 && rows > 1 ? "72%" : "100%";
                return (
                    <div
                        key={index}
                        className="rounded-full bg-gradient-to-r from-neutral-800 via-neutral-700 to-neutral-800 bg-[length:220px_100%] animate-pulse"
                        style={{
                            height,
                            width: rowWidth,
                        }}
                    />
                );
            })}
        </div>
    );
}
