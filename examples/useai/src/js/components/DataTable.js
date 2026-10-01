import React from "react";

export default function DataTable({ headers, rows }) {
    return (
        <div className="my-2 border border-[var(--border)] rounded-xl overflow-hidden font-sans text-[12px]">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
                            {headers && headers.map((header, idx) => (
                                <th key={idx} className="px-4 py-2 font-semibold text-white border-r border-[var(--border)] last:border-r-0">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows && rows.map((row, rIdx) => (
                            <tr key={rIdx} className="border-b border-[var(--border)] last:border-b-0 hover:bg-white/5 transition-colors">
                                {row && row.map((cell, cIdx) => (
                                    <td key={cIdx} className="px-4 py-2 text-neutral-300 border-r border-[var(--border)] last:border-r-0">
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
