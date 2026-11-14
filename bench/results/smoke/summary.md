# Pitch benchmark: `data\smoke`

2 clips. Streaming modes use 300 ms of past audio and the stated lookahead; estimates every 30 ms. CPU: 2 threads.

**Usable** = share of sung frames reported voiced *and* within 50 cents. **Octave err** and **Other gross** are shares of the frames the detector reported voiced. **False voicing** = share of silent/unsung frames reported voiced. **Latency** = lookahead + CPU time per new estimate.

## All conditions, all pitches

| Detector | Mode | Usable | Raw pitch | Octave err | Other gross | Missed | False voicing | Median error (cents) | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MPM | offline | 85.4% | 92.7% | 2.1% | 0.7% | 12.1% | 37.3% | 4 | – |
| MPM | L20 | 85.4% | 92.7% | 2.1% | 0.7% | 12.1% | 37.3% | 4 | 20 ms |
| MPM | L40 | 85.4% | 92.7% | 2.1% | 0.7% | 12.1% | 37.3% | 4 | 40 ms |
| MPM | L20+guard | 85.1% | 85.1% | 2.0% | 1.1% | 12.1% | 37.3% | 4 | 20 ms |
| CREPE-tiny | offline | 99.2% | 99.2% | 0.1% | 0.4% | 0.3% | 52.8% | 7 | – |
| CREPE-tiny | L20 | 96.4% | 96.4% | 0.0% | 3.3% | 0.3% | 50.8% | 11 | 22 ms |
| CREPE-tiny | L40 | 99.2% | 99.2% | 0.1% | 0.4% | 0.3% | 52.8% | 7 | 42 ms |
| CREPE-tiny | L20+guard | 96.3% | 96.3% | 0.0% | 3.4% | 0.3% | 50.8% | 11 | 22 ms |
| PESTO | offline | 89.4% | 99.8% | 0.0% | 0.2% | 10.4% | 4.7% | 9 | – |
| PESTO | L20 | 87.9% | 99.7% | 0.0% | 0.2% | 11.9% | 3.1% | 9 | 22 ms |
| PESTO | L40 | 89.3% | 99.8% | 0.0% | 0.2% | 10.6% | 4.1% | 9 | 42 ms |
| PESTO | L20+guard | 87.9% | 87.9% | 0.0% | 0.2% | 11.9% | 3.1% | 9 | 22 ms |
| SwiftF0 | offline | 98.7% | 98.8% | 0.0% | 1.2% | 0.2% | 39.4% | 6 | – |
| SwiftF0 | L20 | 77.0% | 84.7% | 0.0% | 10.1% | 14.3% | 18.7% | 12 | 20 ms |
| SwiftF0 | L40 | 86.1% | 99.5% | 0.1% | 0.1% | 13.7% | 16.1% | 6 | 40 ms |
| SwiftF0 | L20+guard | 76.9% | 76.9% | 0.0% | 10.2% | 14.3% | 18.7% | 12 | 20 ms |
| FCPE | offline | 79.6% | 79.6% | 0.0% | 0.7% | 19.9% | 58.0% | 4 | – |
| FCPE | L20 | 79.5% | 79.5% | 0.0% | 0.9% | 19.8% | 58.0% | 5 | 21 ms |
| FCPE | L40 | 79.7% | 79.7% | 0.0% | 0.7% | 19.8% | 58.0% | 5 | 41 ms |
| FCPE | L20+guard | 79.4% | 79.4% | 0.0% | 1.0% | 19.8% | 58.0% | 5 | 21 ms |

## All conditions, notes above C6 (1046 Hz)

| Detector | Mode | Usable | Raw pitch | Octave err | Other gross | Missed | False voicing | Median error (cents) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MPM | offline | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | – | 4 |
| MPM | L20 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | – | 4 |
| MPM | L40 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | – | 4 |
| MPM | L20+guard | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | – | 4 |
| CREPE-tiny | offline | 98.4% | 98.4% | 0.4% | 0.0% | 1.2% | – | 8 |
| CREPE-tiny | L20 | 96.7% | 96.7% | 0.0% | 2.5% | 0.8% | – | 14 |
| CREPE-tiny | L40 | 98.4% | 98.4% | 0.4% | 0.0% | 1.2% | – | 8 |
| CREPE-tiny | L20+guard | 96.7% | 96.7% | 0.0% | 2.5% | 0.8% | – | 14 |
| PESTO | offline | 54.1% | 100.0% | 0.0% | 0.0% | 45.9% | – | 11 |
| PESTO | L20 | 53.7% | 100.0% | 0.0% | 0.0% | 46.3% | – | 9 |
| PESTO | L40 | 54.1% | 100.0% | 0.0% | 0.0% | 45.9% | – | 10 |
| PESTO | L20+guard | 53.7% | 53.7% | 0.0% | 0.0% | 46.3% | – | 9 |
| SwiftF0 | offline | 98.0% | 98.8% | 0.0% | 1.2% | 0.8% | – | 9 |
| SwiftF0 | L20 | 32.8% | 64.8% | 0.0% | 14.0% | 61.9% | – | 14 |
| SwiftF0 | L40 | 41.8% | 98.4% | 0.0% | 0.0% | 58.2% | – | 11 |
| SwiftF0 | L20+guard | 32.8% | 32.8% | 0.0% | 14.0% | 61.9% | – | 14 |
| FCPE | offline | 7.8% | 7.8% | 0.0% | 13.6% | 91.0% | – | 9 |
| FCPE | L20 | 7.8% | 7.8% | 0.0% | 17.4% | 90.6% | – | 4 |
| FCPE | L40 | 7.8% | 7.8% | 0.0% | 17.4% | 90.6% | – | 9 |
| FCPE | L20+guard | 7.8% | 7.8% | 0.0% | 17.4% | 90.6% | – | 4 |

## All conditions, F5 to C6

| Detector | Mode | Usable | Raw pitch | Octave err | Other gross | Missed | False voicing | Median error (cents) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MPM | offline | 99.7% | 99.7% | 0.0% | 0.3% | 0.0% | – | 3 |
| MPM | L20 | 99.7% | 99.7% | 0.0% | 0.3% | 0.0% | – | 3 |
| MPM | L40 | 99.7% | 99.7% | 0.0% | 0.3% | 0.0% | – | 3 |
| MPM | L20+guard | 99.7% | 99.7% | 0.0% | 0.3% | 0.0% | – | 3 |
| CREPE-tiny | offline | 99.7% | 99.7% | 0.0% | 0.3% | 0.0% | – | 7 |
| CREPE-tiny | L20 | 94.9% | 94.9% | 0.0% | 5.1% | 0.0% | – | 10 |
| CREPE-tiny | L40 | 99.7% | 99.7% | 0.0% | 0.3% | 0.0% | – | 7 |
| CREPE-tiny | L20+guard | 94.9% | 94.9% | 0.0% | 5.1% | 0.0% | – | 10 |
| PESTO | offline | 99.7% | 100.0% | 0.0% | 0.0% | 0.3% | – | 8 |
| PESTO | L20 | 99.7% | 100.0% | 0.0% | 0.0% | 0.3% | – | 8 |
| PESTO | L40 | 99.7% | 100.0% | 0.0% | 0.0% | 0.3% | – | 9 |
| PESTO | L20+guard | 99.7% | 99.7% | 0.0% | 0.0% | 0.3% | – | 8 |
| SwiftF0 | offline | 99.4% | 99.4% | 0.0% | 0.6% | 0.0% | – | 5 |
| SwiftF0 | L20 | 85.9% | 88.2% | 0.0% | 12.1% | 2.2% | – | 13 |
| SwiftF0 | L40 | 96.5% | 100.0% | 0.0% | 0.0% | 3.5% | – | 4 |
| SwiftF0 | L20+guard | 85.9% | 85.9% | 0.0% | 12.1% | 2.2% | – | 13 |
| FCPE | offline | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | – | 3 |
| FCPE | L20 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | – | 5 |
| FCPE | L40 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | – | 5 |
| FCPE | L20+guard | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | – | 5 |

## Usable by condition (L20+guard)

| Detector | clean | uke_bleed |
| --- | --- | --- |
| MPM | 99.8% | 69.5% |
| CREPE-tiny | 95.8% | 96.9% |
| PESTO | 80.2% | 96.1% |
| SwiftF0 | 63.9% | 90.8% |
| FCPE | 60.9% | 99.1% |

## Usable above C6 by condition (L20+guard)

| Detector | clean | uke_bleed |
| --- | --- | --- |
| MPM | 100.0% | – |
| CREPE-tiny | 96.7% | – |
| PESTO | 53.7% | – |
| SwiftF0 | 32.8% | – |
| FCPE | 7.8% | – |

## False voicing by condition (L20+guard)

Share of frames with no singing that the detector reported as sung. With uke bleed, the instrument keeps playing between phrases, so a high value there means it tracked the uke.

| Detector | clean | uke_bleed |
| --- | --- | --- |
| MPM | 7.6% | 57.9% |
| CREPE-tiny | 6.3% | 81.6% |
| PESTO | 0.0% | 5.3% |
| SwiftF0 | 2.5% | 29.8% |
| FCPE | 2.5% | 96.5% |

## CPU cost per estimate (2 threads)

| Detector | Cached streaming | Recompute whole window |
| --- | --- | --- |
| MPM | 0.29 ms | 0.3 ms |
| CREPE-tiny | 2.49 ms | 2.5 ms |
| PESTO | 1.59 ms | 56.7 ms |
| SwiftF0 | 0.18 ms | 5.4 ms |
| FCPE | 0.51 ms | 28.9 ms |

Context models never use a window's final frame (unreliable for all three), so their newest estimate is one hop older than the lookahead suggests: 16 ms for SwiftF0, 10 ms for PESTO and FCPE.
