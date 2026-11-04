import React from "react"
import css from "./Home.scss"

// The 14 rays of the Catalyst mark, as [outer x, outer y, inner x, inner y].
const RAYS = [
    [11.8, 89.7, 80, 90.4],
    [33.9, 51.3, 92, 70.7],
    [56, 13.2, 103, 53.6],
    [100.6, 11.8, 124.5, 52.6],
    [145.3, 12.5, 146.2, 52],
    [145.3, 167, 146.2, 128],
    [100.4, 167.6, 124.4, 128.2],
    [56, 167.1, 103, 127.8],
    [33.7, 128.9, 92, 109.5],
    [122.2, 51.5, 135.5, 72.8],
    [78.4, 51.5, 112.8, 71.3],
    [56.4, 89.6, 102.6, 90.4],
    [78.5, 128.3, 112.7, 109.6],
    [122.3, 128.4, 135.7, 108.2],
]

const OUTER_RADIUS = 11.8
const INNER_RADIUS = 5.8

// A capsule that narrows from the outer end to the inner end.
function rayPath([x1, y1, x2, y2]) {
    const length = Math.hypot(x2 - x1, y2 - y1)
    const nx = -(y2 - y1) / length
    const ny = (x2 - x1) / length
    const point = (x, y, radius, side) =>
        `${(x + nx * radius * side).toFixed(2)} ${(y + ny * radius * side).toFixed(2)}`

    return [
        `M${point(x1, y1, OUTER_RADIUS, 1)}`,
        `L${point(x2, y2, INNER_RADIUS, 1)}`,
        `A${INNER_RADIUS} ${INNER_RADIUS} 0 0 0 ${point(x2, y2, INNER_RADIUS, -1)}`,
        `L${point(x1, y1, OUTER_RADIUS, -1)}`,
        `A${OUTER_RADIUS} ${OUTER_RADIUS} 0 0 0 ${point(x1, y1, OUTER_RADIUS, 1)}`,
        "Z",
    ].join("")
}

function Mark() {
    return (
        <svg className={css.mark} viewBox="0 0 158 180" aria-hidden="true">
            <defs>
                {RAYS.map(([x1, y1, x2, y2], index) => (
                    <linearGradient
                        key={index}
                        id={`catalyst-ray-${index}`}
                        gradientUnits="userSpaceOnUse"
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                    >
                        <stop offset="0" className={css.rayOuter} />
                        <stop offset="1" className={css.rayInner} />
                    </linearGradient>
                ))}
            </defs>
            {RAYS.map((ray, index) => {
                const length = Math.hypot(ray[2] - ray[0], ray[3] - ray[1])
                return (
                    <path
                        key={index}
                        className={css.ray}
                        d={rayPath(ray)}
                        fill={`url(#catalyst-ray-${index})`}
                        style={{
                            "--from-x": `${((ray[0] - ray[2]) / length) * 26}px`,
                            "--from-y": `${((ray[1] - ray[3]) / length) * 26}px`,
                            "--delay": `${index * 34}ms`,
                        }}
                    />
                )
            })}
        </svg>
    )
}

export default Mark
