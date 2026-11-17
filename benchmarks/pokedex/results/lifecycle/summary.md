# Lifecycle results

Median (p95, ±stdev) in ms unless noted. "visible" = from the first keystroke/click to the result being in the DOM; "paint" = to the next painted frame (rAF + setTimeout). Slow4g = Lighthouse applied Slow 4G + 4x CPU; cpu4x = no network throttling, 4x CPU. n is the number of repetitions.

## Journey, slow4g

| Measure | catalyst-1.1.0 (n=12) | sveltekit (n=12) | exact (n=12) | exact-immutable (n=12) |
|---|---:|---:|---:|---:|
| A. cold visit: first paint | 642 (p95 675, ±20) | 1216 (p95 1237, ±12) | 664 (p95 687, ±12) | 660 (p95 680, ±10) |
| A. cold visit: LCP | 1170 (p95 1182, ±8) | 1226 (p95 1250, ±14) | 1232 (p95 1249, ±12) | 1224 (p95 1244, ±10) |
| A. cold visit: JS downloaded (KiB) | 95 (p95 95, ±0) | 39 (p95 39, ±0) | 0 (p95 0, ±0) | 0 (p95 0, ±0) |
| B. warm reload: first paint | 84 (p95 96, ±8) | 630 (p95 644, ±6) | 638 (p95 653, ±11) | 624 (p95 645, ±10) |
| B. warm reload: LCP | 84 (p95 96, ±8) | 630 (p95 644, ±6) | 638 (p95 653, ±11) | 624 (p95 645, ±10) |
| B. warm reload: JS files revalidated / from cache | 0 / 5 of 5 | 0 / 12 of 12 | 0 / 0 of 0 | 0 / 0 of 0 |
| C. first activation, cold cache (type pika): visible | 49 (p95 55, ±3) | 39 (p95 41, ±2) | 1622 (p95 1656, ±26) | 1621 (p95 1633, ±13) |
| C. first activation, cold cache: paint | 65 (p95 75, ±6) | 52 (p95 59, ±6) | 1628 (p95 1664, ±26) | 1626 (p95 1640, ±13) |
| C'. first activation, warm HTTP cache: visible | 17 (p95 22, ±3) | 14 (p95 17, ±2) | 1258 (p95 1263, ±15) | 87 (p95 120, ±15) |
| C'. first activation, warm HTTP cache: paint | 30 (p95 36, ±3) | 23 (p95 29, ±5) | 1264 (p95 1270, ±15) | 102 (p95 136, ±15) |
| D1. second interaction (clear search): paint | 52 (p95 55, ±2) | 30 (p95 30, ±1) | 64 (p95 86, ±11) | 63 (p95 65, ±2) |
| D2. second search (type char): visible | 22 (p95 28, ±3) | 17 (p95 21, ±3) | 37 (p95 50, ±7) | 37 (p95 41, ±2) |
| D2. second search (type char): paint | 31 (p95 39, ±5) | 22 (p95 35, ±7) | 45 (p95 59, ±9) | 46 (p95 51, ±4) |
| E1. open Charizard: paint | 621 (p95 636, ±8) | 618 (p95 626, ±4) | 47 (p95 65, ±9) | 46 (p95 50, ±2) |
| E2. back to list: paint | 58 (p95 63, ±3) | 661 (p95 682, ±10) | 20 (p95 24, ±2) | 21 (p95 22, ±1) |
| E3. search after back (type bulba): paint | 38 (p95 45, ±6) | 24 (p95 28, ±6) | 36 (p95 43, ±5) | 34 (p95 45, ±7) |
| worst event duration, cold pass (Event Timing, ms) | 40 (p95 48, ±8) | 32 (p95 36, ±5) | 32 (p95 64, ±16) | 36 (p95 64, ±13) |
| long tasks during cold pass (count) | 0 (p95 0, ±0) | 0 (p95 0, ±0) | 2 (p95 3, ±0) | 2 (p95 3, ±0) |
| total waiting, cold pass (sum of paint times, ms) | 867 (p95 890, ±12) | 1405 (p95 1442, ±17) | 1897 (p95 1983, ±53) | 1893 (p95 1927, ±20) |
| total waiting, warm pass (sum of paint times, ms) | 784 (p95 806, ±11) | 1346 (p95 1369, ±12) | 1508 (p95 1532, ±20) | 382 (p95 455, ±36) |
| C. JS downloaded / revalidated / from cache during first activation (cold) | 0 / 0 / 0 (0 KiB) | 0 / 0 / 0 (0 KiB) | 1 / 0 / 0 (53 KiB) | 1 / 0 / 0 (53 KiB) |
| C'. same, after warm reload | 0 / 0 / 0 (0.0 KiB) | 0 / 0 / 0 (0.0 KiB) | 0 / 1 / 0 (0.2 KiB) | 0 / 0 / 2 (0.0 KiB) |
| E. state after back (input value; cards) | kept in 0/12 runs | kept in 0/12 runs | kept in 12/12 runs | kept in 12/12 runs |

## Journey, cpu4x

| Measure | catalyst-1.1.0 (n=20) | sveltekit (n=20) | exact (n=20) | exact-immutable (n=20) |
|---|---:|---:|---:|---:|
| A. cold visit: first paint | 116 (p95 144, ±10) | 116 (p95 130, ±10) | 112 (p95 120, ±4) | 112 (p95 120, ±4) |
| A. cold visit: LCP | 116 (p95 144, ±10) | 116 (p95 130, ±10) | 128 (p95 136, ±6) | 128 (p95 136, ±5) |
| A. cold visit: JS downloaded (KiB) | 95 (p95 95, ±0) | 39 (p95 39, ±0) | 0 (p95 0, ±0) | 0 (p95 0, ±0) |
| B. warm reload: first paint | 76 (p95 77, ±4) | 76 (p95 81, ±5) | 72 (p95 76, ±3) | 72 (p95 80, ±3) |
| B. warm reload: LCP | 76 (p95 77, ±4) | 76 (p95 81, ±5) | 72 (p95 76, ±3) | 72 (p95 80, ±3) |
| B. warm reload: JS files revalidated / from cache | 0 / 5 of 5 | 0 / 12 of 12 | 0 / 0 of 0 | 0 / 0 of 0 |
| C. first activation, cold cache (type pika): visible | 48 (p95 51, ±3) | 40 (p95 45, ±3) | 126 (p95 136, ±5) | 129 (p95 160, ±15) |
| C. first activation, cold cache: paint | 63 (p95 68, ±5) | 54 (p95 62, ±6) | 132 (p95 142, ±5) | 135 (p95 166, ±15) |
| C'. first activation, warm HTTP cache: visible | 17 (p95 20, ±2) | 13 (p95 17, ±2) | 94 (p95 119, ±12) | 93 (p95 122, ±15) |
| C'. first activation, warm HTTP cache: paint | 30 (p95 37, ±7) | 26 (p95 29, ±6) | 100 (p95 125, ±12) | 108 (p95 137, ±16) |
| D1. second interaction (clear search): paint | 50 (p95 52, ±1) | 29 (p95 33, ±4) | 62 (p95 68, ±2) | 62 (p95 76, ±5) |
| D2. second search (type char): visible | 24 (p95 26, ±1) | 17 (p95 22, ±3) | 36 (p95 38, ±3) | 36 (p95 50, ±6) |
| D2. second search (type char): paint | 32 (p95 36, ±2) | 29 (p95 40, ±6) | 46 (p95 50, ±5) | 48 (p95 59, ±8) |
| E1. open Charizard: paint | 53 (p95 61, ±5) | 49 (p95 54, ±5) | 44 (p95 50, ±4) | 44 (p95 49, ±4) |
| E2. back to list: paint | 55 (p95 56, ±1) | 42 (p95 43, ±1) | 20 (p95 24, ±2) | 20 (p95 25, ±2) |
| E3. search after back (type bulba): paint | 43 (p95 45, ±6) | 28 (p95 44, ±7) | 40 (p95 48, ±8) | 41 (p95 50, ±10) |
| worst event duration, cold pass (Event Timing, ms) | 40 (p95 48, ±4) | 32 (p95 40, ±4) | 32 (p95 56, ±10) | 44 (p95 64, ±15) |
| long tasks during cold pass (count) | 0 (p95 0, ±0) | 0 (p95 0, ±0) | 2 (p95 2, ±0) | 2 (p95 3, ±0) |
| total waiting, cold pass (sum of paint times, ms) | 294 (p95 305, ±9) | 235 (p95 247, ±12) | 399 (p95 425, ±13) | 406 (p95 466, ±30) |
| total waiting, warm pass (sum of paint times, ms) | 214 (p95 229, ±11) | 173 (p95 196, ±12) | 347 (p95 386, ±23) | 357 (p95 439, ±39) |
| C. JS downloaded / revalidated / from cache during first activation (cold) | 0 / 0 / 0 (0 KiB) | 0 / 0 / 0 (0 KiB) | 2 / 0 / 0 (66 KiB) | 2 / 0 / 0 (66 KiB) |
| C'. same, after warm reload | 0 / 0 / 0 (0.0 KiB) | 0 / 0 / 0 (0.0 KiB) | 0 / 2 / 0 (0.4 KiB) | 0 / 0 / 2 (0.0 KiB) |
| E. state after back (input value; cards) | kept in 0/20 runs | kept in 0/20 runs | kept in 20/20 runs | kept in 20/20 runs |

## F. New tab, slow4g

| Measure | catalyst-1.1.0 (n=10) | sveltekit (n=10) | exact (n=10) | exact-immutable (n=10) |
|---|---:|---:|---:|---:|
| first visit: first paint | 638 (p95 660, ±14) | 1210 (p95 1218, ±7) | 664 (p95 684, ±12) | 662 (p95 678, ±9) |
| revisit: first paint | 110 (p95 136, ±14) | 662 (p95 694, ±16) | 664 (p95 668, ±5) | 666 (p95 676, ±7) |
| revisit: LCP | 110 (p95 136, ±14) | 662 (p95 694, ±16) | 680 (p95 686, ±6) | 682 (p95 695, ±8) |
| revisit: JS revalidated / from cache / downloaded | 0 / 5 / 0 | 0 / 12 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| first search on first visit: paint | 68 (p95 78, ±7) | 57 (p95 60, ±5) | 1610 (p95 1632, ±15) | 1622 (p95 1650, ±16) |
| first search after revisit: paint | 64 (p95 85, ±11) | 63 (p95 66, ±6) | 1287 (p95 1315, ±16) | 172 (p95 179, ±5) |

## F. New tab, cpu4x

| Measure | catalyst-1.1.0 (n=10) | sveltekit (n=10) | exact (n=10) | exact-immutable (n=10) |
|---|---:|---:|---:|---:|
| first visit: first paint | 118 (p95 130, ±8) | 118 (p95 128, ±7) | 112 (p95 129, ±9) | 112 (p95 120, ±3) |
| revisit: first paint | 110 (p95 143, ±16) | 108 (p95 112, ±6) | 104 (p95 108, ±5) | 104 (p95 108, ±3) |
| revisit: LCP | 110 (p95 143, ±16) | 108 (p95 112, ±6) | 122 (p95 124, ±5) | 124 (p95 124, ±3) |
| revisit: JS revalidated / from cache / downloaded | 0 / 5 / 0 | 0 / 12 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| first search on first visit: paint | 61 (p95 84, ±13) | 59 (p95 63, ±4) | 139 (p95 164, ±14) | 136 (p95 145, ±7) |
| first search after revisit: paint | 68 (p95 87, ±10) | 58 (p95 64, ±6) | 175 (p95 179, ±4) | 172 (p95 176, ±3) |

## G. New browser session, slow4g

| Measure | catalyst-1.1.0 (n=10) | sveltekit (n=10) | exact (n=10) | exact-immutable (n=10) |
|---|---:|---:|---:|---:|
| first visit: first paint | 632 (p95 660, ±16) | 1208 (p95 1218, ±6) | 676 (p95 676, ±8) | 662 (p95 676, ±8) |
| revisit: first paint | 664 (p95 679, ±6) | 660 (p95 671, ±6) | 664 (p95 677, ±7) | 670 (p95 680, ±9) |
| revisit: LCP | 664 (p95 679, ±6) | 660 (p95 671, ±6) | 680 (p95 703, ±12) | 692 (p95 696, ±10) |
| revisit: JS revalidated / from cache / downloaded | 0 / 5 / 0 | 0 / 12 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| first search on first visit: paint | 67 (p95 85, ±12) | 54 (p95 58, ±4) | 1621 (p95 1639, ±19) | 1624 (p95 1650, ±20) |
| first search after revisit: paint | 65 (p95 72, ±5) | 56 (p95 62, ±5) | 1276 (p95 1297, ±13) | 169 (p95 177, ±5) |

## G. New browser session, cpu4x

| Measure | catalyst-1.1.0 (n=10) |
|---|---:|
| first visit: first paint | 112 (p95 122, ±5) |
| revisit: first paint | 116 (p95 126, ±5) |
| revisit: LCP | 116 (p95 126, ±5) |
| revisit: JS revalidated / from cache / downloaded | 0 / 5 / 0 |
| first search on first visit: paint | 61 (p95 67, ±3) |
| first search after revisit: paint | 62 (p95 65, ±2) |

