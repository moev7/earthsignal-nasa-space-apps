# Complete gauge receipts and experimental forecasts

A result must retain the data quality the source actually provided. USGS JSON
qualifiers may be null, a string or an array. Earthsignal retains their bounded,
ordered union separately from approval status. An `Approved` reading carrying
`ESTIMATED` remains a source estimate. It is not silently upgraded to an
unqualified measurement or approved forecast-development input.

## Large histories in observatory 1.6

Small received snapshots remain embedded in the existing `gaugeVintage` contract.
Above 64 KiB of canonical wrapped receipt JSON, the complete snapshot is stored
in `gauge-vintage-snapshot.json` and the result contains a compact reference.
This keeps the existing 256 KiB result JSON limit and 8 MiB per-file ceiling.
No record is truncated to make a history fit.

The reference contains the original receipt cutoff, exact series identity,
date range, complete/unknown population and counts of qualified and withdrawn
records. `snapshotHash` identifies the canonical semantic snapshot. The separate
artifact SHA256 identifies **exact canonical UTF-8 file bytes, including the final
newline**. These hashes have different purposes and cannot be substituted.

Before a job becomes completed, the worker verifies the fixed file name, regular
file status, size, exact byte digest, canonical JSON, record-level lineage and
all reference joins. Missing, corrupt, noncanonical or substituted files block
publication. Existing storage reservations and transfer limits remain in force.

The artifact uses the existing authenticated assessment download route. It is
available only to the owning account and only while the completed result remains
available. The web interface fetches it on an explicit click, verifies the exact
bytes and metadata before allowing a download, and cancels outstanding work when
identity changes. The default state says the snapshot is stored separately;
it does not claim that a download has already been checked.

Saved snapshots preserve the result, history and compact reference after ordinary
job artifacts expire. Archive validation checks their structure and disclosed
timing, but cannot replay a missing observation ledger or verify its information
hash. Full reproduction requires the original matching file. A well-shaped hash
alone proves neither file availability nor source authenticity. Earlier embedded
1.4/1.5 assessments remain readable without rewriting their measurements.

## Recorded real-data check

The October 13 engineering replay used saved public USGS responses for station
01646500, daily mean discharge 00060/00003, October 2, 2021–September 30, 2025.
It retained all **1,460 station-days**, including **46 `ESTIMATED` qualifiers**.
The original parser rejected the array shape; embedding the corrected full receipt
then exceeded the result JSON limit. The reference implementation produced a
141,761-byte result and a complete 1,252,539-byte file.

This replay used actual source response completion times, not invented historical
availability. It tests ingestion, lineage and storage. It is not an independent
field accuracy benchmark, untouched forecast evaluation or scientist-usefulness
study. The existing strict approved-only development policy correctly withheld
this history with `unsupported_quality`; those 46 flags were not removed to fit
a model.

## Separate provisional-input experiment

`service.observatory.provisional_issue` supplies explicit, offline-only compute
and score functions. It consumes an independently pinned, ready approved-only
frozen policy and separately pinned as-received issue snapshot. It accepts
literal `Approved`/`approved`/`Provisional`/`provisional` predictors only with empty
qualifiers, and retains quality, receipt and version lineage for every attempt.
Unsupported required support produces an explicit withholding reason.

The experiment returns point predictions for persistence, a seasonal comparison
and a bounded past-only trend, across 1/3/7-day horizons. It does **not** inherit
calibrated bands from an approved-input policy: prediction and source-revision
uncertainty remain unquantified. Targets must lie wholly after the issue instant;
missing seasonal support and elapsed targets remain withheld attempts. Later
scoring accepts only completed approved, unqualified truths received by the score
cutoff. It retains every outcome and duplicate-target counts, and reports point
errors without pretending repeated targets are independent observations.

No API, dashboard prediction or operational publication is enabled by this
module. The current application continues to distinguish experimental evidence
from readiness. Prospective receipts, independent reference labels, frozen final
evaluation and actual scientist feedback remain required by the broader
[scientific benchmark gates](research/scientific-excellence-2026-10-12/BENCHMARKS.md).
