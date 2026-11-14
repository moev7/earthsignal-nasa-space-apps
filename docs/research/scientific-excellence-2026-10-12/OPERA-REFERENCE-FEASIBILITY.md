# OPERA optical-reference metadata feasibility — 13 October 2026

This is a bounded public catalog check for the existing Lake Mead NISAR crop,
not a reference-label corpus or accuracy result. The detector's own classifications
have not been used as truth.

NASA lists [DSWx-HLS](https://podaac.jpl.nasa.gov/dataset/OPERA_L3_DSWX-HLS_V1)
as a 30-m optical surface-water product with classification, confidence and
visibility layers. Its science files require Earthdata authentication; public
metadata does not establish download access. The page directs readers to contact
PO.DAAC for its calibration/validation database. No contact, new login, OAuth
grant, paid service or science-file download was performed here.

The actual CMR collection response confirms `C2617126679-POCLOUD`, collection
version `1.0`, short name `OPERA_L3_DSWX-HLS_V1`. Separate granule names encode
`v1.1`; these fields must remain separate rather than being normalized into one
invented product version.

For bbox `[-114.75,36.05,-114.74,36.06]`:

| Query | CMR hit count | Returned sample | Result |
| --- | ---: | --- | --- |
| June 19–July 3, 2026 | 35 | G4226123796-POCLOUD | June 19 Landsat-9 candidate; not claimed nearest |
| September 23–October 7 | 31 | G4323645042-POCLOUD | September 23 Landsat-9 candidate; not claimed nearest |
| June 26 only | 1 | G4229638379-POCLOUD | Same calendar day as first NISAR acquisition |
| September 30 only | 0 | none | No same-day candidate in this collection/query |

The June 26 sample's filename has `20260626T182921Z`, while CMR `time_start`
is `2026-06-26T18:44:19.730Z`. Preserve both; the time discrepancy needs resolution
before a precise timing match. Even a same-day optical acquisition does not
establish simultaneous water conditions, visible pixels or independent ground truth.

Five accepted metadata captures total **62,639 bytes**. SHA256 and actual
body-completion times are retained in ignored local
`outputs/opera-reference-metadata-20261013/` receipts. Two earlier larger-page
queries failed a local admission assertion and produced no accepted raw capture;
the follow-up reduced page size without increasing the 128-KiB response cap.
The accepted collection digest is
`4d324b89fcbc12e8ebef9d5c4cd0f9aa745583b6438b9ab3656c18b8593451f5`.

Next: verify bounded authenticated tile access, class/confidence/cloud-mask
semantics, actual common valid support and timing. Then freeze a source/split
manifest and obtain blinded reference interpretation. A derived optical product
can be a separately qualified comparison; it is not automatically a gold label.
No raster was read, no water area was scored, and E2/E3 remain incomplete.
