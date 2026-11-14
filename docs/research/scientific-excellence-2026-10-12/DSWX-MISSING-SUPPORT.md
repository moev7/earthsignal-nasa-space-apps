# Missing optical support in the frozen Lake Mead patch

## In simple terms

The four selected satellite water maps have no usable observations in this small
patch. That prevents a before/after water comparison. It does **not** mean the
patch is dry, unchanged, flooded or dangerous. The retained radar result measures
a different signal; it does not fill this missing optical evidence.

## Question and frozen inputs

On 14 October 2026, we investigated whether the previously recorded absence of
valid DSWx-HLS pixels was caused by source no-data, projection/window errors or
padding outside the source raster. The search geometry, selected source IDs and
discovery responses were frozen before inspecting pixel values. No replacement
AOI, mask relaxation or selection based on environmental outcomes was used.

Bounding box in longitude/latitude: `[-114.75, 36.05, -114.74, 36.06]`.
Discovery interval: 26 June–30 September 2026.

| CMR source ID | Producer acquisition timestamp | Tile | Source window x, y, width, height |
|---|---|---|---|
| G4229638379-POCLOUD | 20260626T182921Z, S2C | T11SPV | 3421, 235, 32, 38 |
| G4230244355-POCLOUD | 20260627T182105Z, L8 | T11SPV | 3421, 235, 32, 38 |
| G4328803480-POCLOUD | 20260928T181131Z, S2C | T11SQV | 89, 235, 32, 38 |
| G4329336187-POCLOUD | 20260928T181131Z, S2C | T11SQA | 89, 3569, 32, 38 |

The two public discovery-response hashes were
`b4cd4e55ee319a0a326f7db5a4495c8e20565fad3542f0b33336a10e3faaf8ad`
and `71852d38ded2fa4b4c6804c7bda66990929ff44f70e40ef9531e39a13a827b9a`.

## Measurement and checks

The native-GDAL check used the unchanged `crop_bands` implementation and the
known original OPERA processing-1.1 / PROTEUS-1.0.2 collapsed-WTR source gate.
Instrumentation recorded the actual Byte read before no-data conversion. This
distinguishes source fill from padding and from values transformed by the reader.
The gate remains conditional on those verified product definitions; this result
does not validate arbitrary products labelled v1.1.

All four source rasters were 3660 × 3660 cells. Each 32 × 38 source window
contained **1216 values of 255**, the source's declared no-data value. All
**1111 selected pixel centres** were inside the source raster, all held 255,
and none were outside-source padding. Valid pixels were **zero** on every date.
All crops used EPSG:32611, 30 m cells and the same selected grid.

An independently accepted Codex Sol audit reconstructed the window and 1111-cell
AOI mask with a standard-library WGS84/UTM calculation. It also reproduced the
earlier June fill-array hash. That audit did not perform native reads; the
coordinator's subsequent native reads established the September source values.

Repeated hashes across all four reads:

| Recorded representation | SHA-256 |
|---|---|
| Raw Byte source window | `ceba783b6b905da8307e782413601d26f2d765ddd234b6db7b588c77ecbdea76` |
| Float32 crop representation | `ae583df6e83425bc95b94c475d6d234b24baf412054f42adb4e905ab573301de` |
| AOI mask | `329f2448e180b87650be172105ece86af5cfade8b632f81821b09f5d21ab5d4c` |
| Grid | `b489d0a0776169aaf39ab066e74cc440578572d7d853f09ea0777041c757ac07` |

The bounded run read 165379 remote range bytes in 27.111 seconds. It used a
64 MiB shared transfer cap, 240-second deadline and a 160 MiB transient unit in
the existing science slice. No production job, configuration or database was
modified. These observations are one diagnostic run, not a general throughput
or concurrent-load benchmark.

## What follows, and what remains unknown

Source no-data explains this four-product comparison's missing support. The
window is not outside these source rasters, and independently reconstructed
projection/mask results contradict a window-placement explanation for these
reads. We have **not** established why the producer supplied no-data, whether
other products or dates cover this patch, classification accuracy, water depth,
damage, or environmental stability. Those require different evidence.

The result therefore remains unavailable. Subsequent source searches should use
a recorded question and selection rule, preserve this negative result and never
reinterpret missing pixels as no change. Original radar and optical context
observations retain their own acquisition times, quantities and limitations.
