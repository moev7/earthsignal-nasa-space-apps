# Mapped water-footprint transitions

New compatible DSWx comparisons can show where the **mapped class-1 footprint**
was gained, lost, present at both dates, or absent at both dates. Unknown support
remains visible. These derived layers live beside the existing measured layers,
filters, swipe, linked images and protected downloads in the investigation.

This is spatial accounting, not a field-validated flood detector. Class 1 is the
mapped open-water class. Other valid classes include partial water, so an
indicator of zero does not establish dry ground. Matching endpoints do not
establish continuous water between observations. A footprint is distinct from
water volume, discharge, damage, ecological impact and causal attribution.

## Accounting and support

`class1-common-pixel-transition-v1` uses the same projected metre grid, exact
selected-area pixel centres, and intersection of both observations' valid masks.
It does not subtract independently masked areas. On that common population:

| Category | Before indicator | After indicator | Export code |
|---|---:|---:|---:|
| Not class 1 at either date | 0 | 0 | 0 |
| Class-1 gain | 0 | 1 | 1 |
| Class-1 loss | 1 | 0 | 2 |
| Class 1 at both dates | 1 | 1 | 3 |
| Unknown comparison within area | Unusable on either date | Unusable on either date | 4 |
| Outside selected area | Outside | Outside | 255, transparent |

For square pixels of recorded resolution `r` metres, each pixel footprint is
`r² / 1,000,000` km². Category area is its count times that footprint.
`netChangeKm2 = gainArea − lossArea`; `turnoverKm2 = gainArea + lossArea`.
Equal gains and losses can produce zero net change while their locations differ.
The proportion bar includes unknown selected-area pixels; unknowns never enter
measured gains or losses. The display does not assign probabilities to categories.

The manifest's optional `transitionAccounting` records counts, areas, method,
grid, area/common-mask and source-indicator/category hashes. `water-transition.tif`
is a native categorical Byte export; its PNG uses nearest-neighbour display only.
The worker verifies original export hashes, reopens native arrays, recomputes the
entire accounting report and category layer, and rejects self-consistent forged
counts or a rehashed but altered category raster. Metadata checks alone do not
verify array contents. The original four raster exports and archived results
remain readable; new optional files and metadata must appear together.

## Current NASA source admission

NASA's collection major `OPERA_L3_DSWX-HLS_V1` differs from a producer filename's
processing version. Catalogue discovery preserves the latter explicitly. The
adapter binds an original B01 filename to its full producer ID on a vetted
download host. Conflicting URLs for the same required layer withhold the candidate
in every link order. Unsupported identities/releases remain catalogue evidence
without substituted measurements.

Processing 1.1 is a **conditional candidate**, limited to the declared known
PROTEUS 1.0.2 collapsed-WTR encoding. Before any science or area-mask array read,
the original file must have the exact supported product/type/source/version and
software declarations, WTR band description, Byte/fill header, collapsed palette
and projected north-up square 30 m grid. Selected raw values must then be among
0/1/2/252/253/254/255. The separate receipt policy is
`dswx-hls-proteus-1.0.2-collapsed-wtr-v1`.

Header declarations alone are insufficient: PROTEUS allows an uncollapsed save
with the same declarations. Its collapsed class-2 palette is `(180,213,244,255)`;
the uncollapsed class-2 palette differs. The gate combines that witness with the
known encoder declaration, original-file binding and domain checks. Neither a
palette nor a header hash authenticates a publisher. Absence of classes 3/4 alone
does not prove collapse. No general processing-1.1 compatibility or field accuracy
is claimed. Legacy processing-1.0 and existing synthetic fixtures retain their
previous behavior; those are not retrospectively certified by the new gate.

CMR times are strictly parsed and normalized to UTC. The producer's input-HLS
acquisition tag and CMR's reported centre-sensing time can legitimately differ.
Exact instants are not asserted equal. Pixel admission conservatively requires
the same UTC calendar day and valid producer time order. Across-midnight cases
remain withheld without asserting a source error or inventing a corrected time.

Primary references: [NASA OPERA products](https://www.jpl.nasa.gov/go/opera/products/dswx-product-suite/),
[PO.DAAC collection](https://podaac.jpl.nasa.gov/dataset/OPERA_L3_DSWX-HLS_V1),
[pinned NASA PROTEUS encoder](https://github.com/nasa/PROTEUS/blob/426a9e762804877fd1afe940940e7b86b374ab32/src/proteus/dswx_hls.py),
and [NASA CMR search API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html).
The encoder source establishes a bounded decoding policy, not environmental
calibration. DSWx-HLS optical results do not establish NISAR radar accuracy.

## Development evidence, 13 October 2026

A predeclared Lake Mead crop `[-114.75,36.05,-114.74,36.06]` and date window
2026-06-26 through 2026-09-30 were selected before pixel inspection. The initial
trial withheld processing 1.1 before reads. It remains recorded separately.
Same-window recovery after the narrow encoding gate discovered four records,
passed the gate on actual original NASA files, but measured no usable support:
31.562 s, 103,936 KiB process maximum RSS and 237,870 metadata/raster bytes.
There was no raster comparison or change estimate. A separate two-input diagnosis
found all 1,111 selected-area pixels nonfinite after source-fill handling, using
98,306 additional range bytes. This does not establish a particular cloud class,
dry ground, or environmental stability. No area/window retuning manufactured a
successful result; no production data or configuration was changed by the trial.

Native export and tamper checks passed on isolated Ubuntu GDAL. Independent
scalar oracles checked category partitions, common masks, net area and turnover,
including 1,280 two-by-two cases. Browser checks used an explicitly synthetic
fixture with simulated preview transport: they verify quantity switching,
legacy fallback, per-image legends, downloads and 390 px containment, not actual
production authentication or scientist usefulness.

The [E1–E6 protocols](research/scientific-excellence-2026-10-12/BENCHMARKS.md)
remain open where independent reference labels, held-out evaluations and human
task results are absent. Passing software checks does not satisfy those gates.
