import React from "react";

export default function Header({ text, level = 2 }) {
    const lvl = Number(level);
    if (lvl === 1) {
        return <h1 className="text-2xl font-bold text-white my-2 font-sans">{text}</h1>;
    } else if (lvl === 3) {
        return <h3 className="text-base font-semibold text-neutral-200 my-2 font-sans">{text}</h3>;
    } else {
        return <h2 className="text-xl font-semibold text-white my-2 font-sans">{text}</h2>;
    }
}
