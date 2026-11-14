# Pitch benchmark: `data\synth`

35 clips. Streaming modes use 300 ms of past audio and the stated lookahead; estimates every 30 ms. CPU: 2 threads.

**Usable** = share of sung frames reported voiced *and* within 50 cents. **Raw pitch** = share of sung frames whose pitch is within 50 cents, ignoring the voicing decision. **Octave err** and **Other gross** are shares of the frames the detector reported voiced. **False voicing** = share of silent/unsung frames reported voiced. **Latency** = lookahead + CPU time per new estimate.

## All conditions, all pitches

| Detector | Mode | Usable | Raw pitch | Octave err | Other gross | Missed | False voicing | Median error (cents) | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MPM | offline | 89.7% | 96.1% | 1.0% | 0.9% | 8.6% | 29.3% | 4 | – |
| MPM | L20 | 89.7% | 96.1% | 1.0% | 0.9% | 8.6% | 29.3% | 4 | 20 ms |
| MPM | L40 | 89.7% | 96.1% | 1.0% | 0.9% | 8.6% | 29.3% | 4 | 40 ms |
| MPM | L20+guard | 89.6% | 89.6% | 1.0% | 1.0% | 8.6% | 29.3% | 4 | 20 ms |
| CREPE-tiny | offline | 97.2% | 97.4% | 0.7% | 1.3% | 0.8% | 43.4% | 7 | – |
| CREPE-tiny | L20 | 94.7% | 94.9% | 0.6% | 4.0% | 0.8% | 43.3% | 9 | 22 ms |
| CREPE-tiny | L40 | 97.2% | 97.4% | 0.7% | 1.3% | 0.8% | 43.4% | 7 | 42 ms |
| CREPE-tiny | L20+guard | 94.5% | 94.5% | 0.5% | 4.2% | 0.8% | 43.3% | 9 | 22 ms |
| PESTO | offline | 89.8% | 96.6% | 0.5% | 1.8% | 8.1% | 9.1% | 9 | – |
| PESTO | L20 | 89.7% | 97.2% | 0.5% | 1.3% | 8.7% | 7.3% | 9 | 21 ms |
| PESTO | L40 | 89.7% | 96.5% | 0.5% | 1.7% | 8.2% | 8.9% | 9 | 41 ms |
| PESTO | L20+guard | 89.7% | 89.7% | 0.4% | 1.4% | 8.7% | 7.3% | 9 | 21 ms |
| SwiftF0 | offline | 98.1% | 98.3% | 0.8% | 0.9% | 0.2% | 26.8% | 6 | – |
| SwiftF0 | L20 | 80.3% | 86.4% | 0.3% | 10.2% | 10.2% | 13.7% | 10 | 20 ms |
| SwiftF0 | L40 | 89.3% | 97.2% | 0.4% | 0.6% | 9.8% | 12.4% | 5 | 40 ms |
| SwiftF0 | L20+guard | 80.2% | 80.2% | 0.2% | 10.4% | 10.2% | 13.7% | 10 | 20 ms |
| FCPE | offline | 83.1% | 83.1% | 2.0% | 6.5% | 9.2% | 38.5% | 3 | – |
| FCPE | L20 | 83.6% | 83.6% | 2.2% | 5.6% | 9.3% | 38.7% | 3 | 20 ms |
| FCPE | L40 | 83.3% | 83.3% | 2.4% | 5.9% | 9.2% | 38.4% | 3 | 40 ms |
| FCPE | L20+guard | 83.5% | 83.5% | 2.1% | 5.7% | 9.3% | 38.7% | 3 | 20 ms |

## All conditions, notes above C6 (1046 Hz)

| Detector | Mode | Usable | Raw pitch | Octave err | Other gross | Missed | False voicing | Median error (cents) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MPM | offline | 91.1% | 95.4% | 0.9% | 1.4% | 6.9% | – | 5 |
| MPM | L20 | 91.1% | 95.4% | 0.9% | 1.4% | 6.9% | – | 5 |
| MPM | L40 | 91.1% | 95.4% | 0.9% | 1.4% | 6.9% | – | 5 |
| MPM | L20+guard | 91.1% | 91.1% | 0.8% | 1.5% | 6.9% | – | 5 |
| CREPE-tiny | offline | 91.2% | 92.1% | 2.5% | 2.6% | 3.8% | – | 8 |
| CREPE-tiny | L20 | 87.4% | 88.4% | 2.3% | 6.6% | 4.0% | – | 11 |
| CREPE-tiny | L40 | 91.2% | 92.1% | 2.5% | 2.6% | 3.8% | – | 8 |
| CREPE-tiny | L20+guard | 86.9% | 86.9% | 2.2% | 7.2% | 4.0% | – | 11 |
| PESTO | offline | 42.8% | 85.2% | 1.5% | 12.4% | 50.3% | – | 9 |
| PESTO | L20 | 43.3% | 87.9% | 0.8% | 9.6% | 51.7% | – | 8 |
| PESTO | L40 | 43.0% | 85.3% | 1.5% | 11.8% | 50.4% | – | 8 |
| PESTO | L20+guard | 43.2% | 43.2% | 0.6% | 10.0% | 51.7% | – | 8 |
| SwiftF0 | offline | 93.6% | 94.0% | 3.9% | 2.0% | 0.5% | – | 9 |
| SwiftF0 | L20 | 42.7% | 65.3% | 1.2% | 23.0% | 43.6% | – | 13 |
| SwiftF0 | L40 | 55.7% | 87.1% | 1.7% | 2.3% | 42.0% | – | 9 |
| SwiftF0 | L20+guard | 42.6% | 42.6% | 0.6% | 23.9% | 43.6% | – | 13 |
| FCPE | offline | 7.7% | 7.7% | 19.6% | 61.1% | 60.2% | – | 8 |
| FCPE | L20 | 8.5% | 8.5% | 21.2% | 57.0% | 61.1% | – | 9 |
| FCPE | L40 | 8.4% | 8.4% | 24.8% | 54.0% | 60.5% | – | 10 |
| FCPE | L20+guard | 8.4% | 8.4% | 20.8% | 57.7% | 61.1% | – | 9 |

## All conditions, F5 to C6

| Detector | Mode | Usable | Raw pitch | Octave err | Other gross | Missed | False voicing | Median error (cents) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MPM | offline | 92.8% | 94.8% | 1.4% | 1.4% | 4.5% | – | 5 |
| MPM | L20 | 92.8% | 94.8% | 1.4% | 1.4% | 4.5% | – | 5 |
| MPM | L40 | 92.8% | 94.8% | 1.4% | 1.4% | 4.5% | – | 5 |
| MPM | L20+guard | 92.7% | 92.7% | 1.4% | 1.6% | 4.5% | – | 5 |
| CREPE-tiny | offline | 94.6% | 95.1% | 2.1% | 2.1% | 1.2% | – | 7 |
| CREPE-tiny | L20 | 89.8% | 90.1% | 1.7% | 7.4% | 1.2% | – | 10 |
| CREPE-tiny | L40 | 94.6% | 95.1% | 2.1% | 2.1% | 1.2% | – | 7 |
| CREPE-tiny | L20+guard | 89.6% | 89.6% | 1.3% | 7.9% | 1.2% | – | 10 |
| PESTO | offline | 90.5% | 92.7% | 2.2% | 4.4% | 3.1% | – | 9 |
| PESTO | L20 | 90.9% | 93.2% | 2.7% | 3.1% | 3.5% | – | 9 |
| PESTO | L40 | 89.9% | 92.0% | 2.8% | 4.4% | 3.1% | – | 9 |
| PESTO | L20+guard | 90.8% | 90.8% | 2.2% | 3.8% | 3.5% | – | 9 |
| SwiftF0 | offline | 97.5% | 97.8% | 1.5% | 0.6% | 0.4% | – | 6 |
| SwiftF0 | L20 | 63.6% | 81.7% | 1.5% | 14.8% | 24.0% | – | 10 |
| SwiftF0 | L40 | 73.9% | 94.9% | 1.9% | 1.5% | 23.5% | – | 5 |
| SwiftF0 | L20+guard | 63.3% | 63.3% | 1.2% | 15.5% | 24.0% | – | 10 |
| FCPE | offline | 81.8% | 81.8% | 3.3% | 14.9% | 0.0% | – | 4 |
| FCPE | L20 | 83.3% | 83.3% | 4.9% | 11.7% | 0.0% | – | 6 |
| FCPE | L40 | 81.2% | 81.2% | 4.6% | 14.1% | 0.1% | – | 6 |
| FCPE | L20+guard | 83.3% | 83.3% | 4.7% | 12.0% | 0.0% | – | 6 |

## Usable by condition (L20+guard)

| Detector | breathy | clean | noisy | reverb | uke_bleed |
| --- | --- | --- | --- | --- | --- |
| MPM | 79.3% | 99.6% | 99.4% | 98.2% | 71.5% |
| CREPE-tiny | 97.2% | 97.1% | 97.1% | 92.8% | 88.5% |
| PESTO | 92.1% | 94.5% | 93.7% | 85.7% | 82.5% |
| SwiftF0 | 73.3% | 82.7% | 86.4% | 75.3% | 83.4% |
| FCPE | 86.1% | 86.4% | 86.7% | 85.8% | 72.7% |

## Usable above C6 by condition (L20+guard)

| Detector | breathy | clean | noisy | reverb | uke_bleed |
| --- | --- | --- | --- | --- | --- |
| MPM | 89.1% | 100.0% | 100.0% | 98.8% | 67.4% |
| CREPE-tiny | 95.1% | 95.1% | 95.5% | 89.9% | 58.9% |
| PESTO | 49.7% | 64.3% | 58.8% | 21.7% | 21.5% |
| SwiftF0 | 25.8% | 40.6% | 61.2% | 26.5% | 58.8% |
| FCPE | 9.2% | 10.4% | 13.0% | 9.2% | 0.2% |

## False voicing by condition (L20+guard)

Share of frames with no singing that the detector reported as sung. With uke bleed, the instrument keeps playing between phrases, so a high value there means it tracked the uke.

| Detector | breathy | clean | noisy | reverb | uke_bleed |
| --- | --- | --- | --- | --- | --- |
| MPM | 3.8% | 7.6% | 4.7% | 66.1% | 64.3% |
| CREPE-tiny | 7.7% | 8.3% | 20.3% | 91.9% | 88.4% |
| PESTO | 2.5% | 3.9% | 3.3% | 10.7% | 16.3% |
| SwiftF0 | 3.9% | 4.5% | 4.8% | 16.3% | 38.8% |
| FCPE | 6.9% | 7.3% | 9.5% | 73.1% | 96.8% |

## CPU cost per estimate (2 threads)

| Detector | Cached streaming | Recompute whole window |
| --- | --- | --- |
| MPM | 0.28 ms | 0.3 ms |
| CREPE-tiny | 2.22 ms | 2.2 ms |
| PESTO | 1.39 ms | 53.3 ms |
| SwiftF0 | 0.16 ms | 4.7 ms |
| FCPE | 0.49 ms | 23.5 ms |

Context models never use a window's final frame (unreliable for all three), so their newest estimate is one hop older than the lookahead suggests: 16 ms for SwiftF0, 10 ms for PESTO and FCPE.
