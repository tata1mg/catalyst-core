# Lifecycle results

Median (p95, ±stdev) in ms unless noted. "visible" = from the first keystroke/click to the result being in the DOM; "paint" = to the next painted frame (rAF + setTimeout). Slow4g = Lighthouse applied Slow 4G + 4x CPU; cpu4x = no network throttling, 4x CPU. n is the number of repetitions.

## Journey, slow4g

| Measure | catalyst-1.1.0 (n=12) | catalyst-safe (n=12) | catalyst-prehydrate (n=12) |
|---|---:|---:|---:|
| A. cold visit: first paint | 642 (p95 675, ±20) | 634 (p95 676, ±23) | 650 (p95 658, ±15) |
| A. cold visit: LCP | 1170 (p95 1182, ±8) | 1168 (p95 1177, ±7) | 1168 (p95 1180, ±8) |
| A. cold visit: JS downloaded (KiB) | 95 (p95 95, ±0) | 95 (p95 95, ±0) | 95 (p95 95, ±0) |
| B. warm reload: first paint | 84 (p95 96, ±8) | 76 (p95 88, ±5) | 80 (p95 88, ±5) |
| B. warm reload: LCP | 84 (p95 96, ±8) | 76 (p95 88, ±5) | 80 (p95 88, ±5) |
| B. warm reload: JS files revalidated / from cache | 0 / 5 of 5 | 0 / 5 of 5 | 0 / 5 of 5 |
| C. first activation, cold cache (type pika): visible | 49 (p95 55, ±3) | 49 (p95 60, ±5) | 50 (p95 57, ±5) |
| C. first activation, cold cache: paint | 65 (p95 75, ±6) | 67 (p95 75, ±7) | 65 (p95 81, ±9) |
| C'. first activation, warm HTTP cache: visible | 17 (p95 22, ±3) | 17 (p95 24, ±4) | 17 (p95 25, ±4) |
| C'. first activation, warm HTTP cache: paint | 30 (p95 36, ±3) | 32 (p95 41, ±5) | 25 (p95 38, ±8) |
| D1. second interaction (clear search): paint | 52 (p95 55, ±2) | 49 (p95 51, ±2) | 51 (p95 52, ±2) |
| D2. second search (type char): visible | 22 (p95 28, ±3) | 23 (p95 26, ±2) | 23 (p95 27, ±2) |
| D2. second search (type char): paint | 31 (p95 39, ±5) | 31 (p95 34, ±1) | 31 (p95 40, ±4) |
| E1. open Charizard: paint | 621 (p95 636, ±8) | 620 (p95 622, ±2) | 619 (p95 623, ±4) |
| E2. back to list: paint | 58 (p95 63, ±3) | 35 (p95 38, ±2) | 35 (p95 36, ±1) |
| E3. search after back (type bulba): paint | 38 (p95 45, ±6) | 38 (p95 45, ±6) | 31 (p95 42, ±5) |
| worst event duration, cold pass (Event Timing, ms) | 40 (p95 48, ±8) | 40 (p95 40, ±4) | 40 (p95 44, ±6) |
| long tasks during cold pass (count) | 0 (p95 0, ±0) | 0 (p95 0, ±0) | 0 (p95 0, ±0) |
| total waiting, cold pass (sum of paint times, ms) | 867 (p95 890, ±12) | 878 (p95 889, ±11) | 873 (p95 892, ±11) |
| total waiting, warm pass (sum of paint times, ms) | 784 (p95 806, ±11) | 804 (p95 818, ±14) | 793 (p95 857, ±29) |
| C. JS downloaded / revalidated / from cache during first activation (cold) | 0 / 0 / 0 (0 KiB) | 0 / 0 / 0 (0 KiB) | 0 / 0 / 0 (0 KiB) |
| C'. same, after warm reload | 0 / 0 / 0 (0.0 KiB) | 0 / 0 / 0 (0.0 KiB) | 0 / 0 / 0 (0.0 KiB) |
| E. state after back (input value; cards) | kept in 0/12 runs | kept in 12/12 runs | kept in 12/12 runs |

