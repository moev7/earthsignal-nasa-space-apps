# One real SAR case, including its limits 🛰️

This is a **retrospective Sentinel-1 development case**, separate from the
original NISAR study. It is a reproducibility and data-readiness exercise, not a
flood detector validation, present-day warning or independent reference survey.

The tile and central window were fixed in [selection-plan.json](selection-plan.json)
**before any image, label or validity pixels were opened**. Selection uses the
first bytewise lexicographic individual `sample/…/s1grd/…` path in the pinned
provider tree, then its matched files. This is a convenience sample of the
provider's already curated sample; it is not a probability sample or an untouched
final evaluation set. No label prevalence or validity fraction selected this case.

The case is `EMSR712-10-0`, Germany, from the provider's train split. The filename
dates are 8 September 2023, 17:08:41, and 3 January 2024, 05:34:06. The sample
metadata does not independently establish their timezone, original scene IDs,
relative orbit, direction or incidence angles. The CEMS delineation timestamps
are separate from those actual SAR filename times. No temporal ratio, change
classification or causal comparison is published without compatibility evidence.

## In simple terms

We checked a small historical radar image patch against the dataset's own map.
Most of this patch is outside the mapped area. Of its 65,536 cells, only 7,935
have usable data on both dates—about 12%. Those cells all belong to the dataset's
**background** category. There are no mapped flood or permanent-water examples
in this fixed window, so it cannot tell us how well a flood detector works.
“Background” does not independently prove dry ground or absence of danger.

We keep the failed readiness result instead of searching for a prettier example.
The measurements describe the small observed subset. They say nothing about
current conditions, an entire German flood event or NISAR performance.

## Frozen evidence

- Dataset revision: `868407460bf3db492f50730a57585916baa71dc6`.
- Producer code: `3a1647ed11aea0c81d5f59a8022e9cb8548bddab`.
- Pre-payload plan SHA-256:
  `364c2df188c5ef4623000eb7a68adbda4e92d72b0f6781c44193dfd10c45df61`.
- Four full individual GeoTIFFs: **19,687,587 bytes** in total. No TAR shard,
  whole collection, optical image, DEM or foundation model was downloaded.
- The two imagery files match provider LFS SHA-256 values; the small label and
  validity files match the pinned tree's Git blob SHA-1, including its blob
  header. SHA-256 values for all four are recorded in
  [acquisition-receipt.json](acquisition-receipt.json). These checks establish
  identity against the pinned provider revision, not independent authenticity
  or radiometric calibration.
- [inputs.npz](inputs.npz) contains only the original central 256×256 values and
  native valid masks: no resampling, epsilon fill, normalization or smoothing.
  Its SHA-256 is
  `73661a1b15b7d34fc58dee68810a270607cfa7e673f2452d2e3b173b27877074`.

All four files have identical native 1024×1024 grids, EPSG:32632, nominal 10 m
spacing. The central crop spans easting 618240–620800 m and northing
5687040–5689600 m. The recorded affine retains floating representation exactly;
nominal spacing checks permit only a documented numerical tolerance.
The crop has 7,936 background-label cells and 57,600 ignored cells. One additional
cell fails the positive finite two-date/two-band power rule, leaving 7,935 common
cells (approximately 0.7935 km² of native projected cell footprint).

The card and producer loader describe the imagery as **linear sigma-zero**, VV
then VH. The TIFFs themselves do not embed radiometric units or band names.
Those definitions remain producer assertions. The same static retrospective
provider label groups both dates; it is not per-date class truth. Per-date summaries use
`10 × log10(power)` on exactly the same common population; no cross-date
difference or ratio is authorized by this experiment. Unknown labels, masks,
scaling or grid definitions must fail. The producer loader excludes nonfinite,
nonpositive and >1000 power values; we exclude them rather than replace them.

The threshold of 30 cells before showing a class summary is an engineering
presentation gate, **not** an independence or statistical adequacy claim.
Pixels are spatially correlated, there is only one window, and no confidence
interval, p-value, population estimate or map accuracy follows.

## Source and licence

Read the [pinned dataset card](https://huggingface.co/datasets/links-ads/geoid-flood/blob/868407460bf3db492f50730a57585916baa71dc6/README.md)
and [paper v1](https://arxiv.org/html/2608.02315v1).
The compilation/labels are CC BY 4.0, attributed to Gaetano Chiriaco, Luca Barco,
Andrea Bragagnolo, Claudio Rossi and Edoardo Arnaudo / Fondazione LINKS and
contributors (GEOID-Flood, 2026). This repository redistributes a cropped subset
with the acquisition record and analysis described here; it is not an endorsement
by those authors. Contains modified Copernicus Sentinel-1 data and Copernicus
Emergency Management Service Rapid Mapping products, © European Union.
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
No DEM is included; the DEM's separate WorldDEM terms were not used as permission
for another layer.

The labels combine CEMS delineations and learned permanent-water mapping. They
are provider reference products, may share satellite inputs with the imagery,
and are not independent field truth. Annual embedding-derived permanent-water
labels can include observations later than the event, so they must not be treated
as information available to a responder at the historical acquisition time.

## Repeat the check

```sh
python -m service.verify_geoid_development
```

This offline path needs NumPy only. See the [acquisition and native-reader
commands](../../docs/geoid-development.md#run-and-reproduce) to independently
fetch the four original files and repeat the exact window.
