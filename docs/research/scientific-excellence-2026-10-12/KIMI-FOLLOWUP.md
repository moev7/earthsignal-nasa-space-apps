# Kimi research follow-up — 13 October 2026

Earthsignal can use this research to strengthen **reference evidence, measured
uncertainty and understandable explanations**. These are research decisions,
not newly established accuracy or forecast claims.

The user requested the latest [Kimi conversation](https://www.kimi.ai/chat/1a13216c-b152-8a43-8000-09e34b5d49f7)
and supplied its search export. The completed answer was inspected in the browser
(visible Instant / High); it reports 21 Scholar-plugin queries. That query count
and the search index's metadata are adviser-reported, not independently audited.
Primary sources below decide adoption. No private result, credential or repository
was sent to Kimi in this continuation.

The supplied raw export contains89 indexed records, including duplicates; all
titles were screened rather than treating the sixteen-item synthesis as exhaustive.
Raw/coherent SAR, receive-only spacecraft and hardware-UAV papers require inputs
or hardware outside this release. Application papers in traffic/energy/soil health
do not establish transfer to environmental decisions. Training-heavy architectures
remain challengers requiring declared sensors, licences, held-out tests and measured
compute, regardless of novelty or citation count.

Three additional leads deserve retention. [GlobMap FFP](https://essd.copernicus.org/articles/18/5915/2026/essd-18-5915-2026.html)
is a published1984–2022 forest-fire-patch dataset. Its authors explicitly describe
an initial Landsat-derived characterization with biome-dependent agreement, not
a complete global burn inventory. Use it as dated ecological context, not incident
truth. AcATaMa's supplied publisher link returned403; its full methodology and code
licence remain unresolved. The supplied Siqueira NISAR early-results IEEE record
was inaccessible through the research tool, so no results are attributed to it.
OpenSAR Insight's raw Sentinel-1/RFI lead may inform later artifact research, but
does not define a supported NISAR GCOV validity mask today.

## Entry-level audit of the reattached export

The supplied `pasted-text.txt` is now traceable through an
[89-entry screening inventory](SCHOLAR-ENTRY-SCREEN.csv) and a
[count/hash receipt](SCHOLAR-ENTRY-RECEIPT.json). It contains87 distinct exact
titles and88 distinct exact URLs. Entries31 and36 repeat titles from9 and35;
their separate index records remain visible and are not independent evidence.
Its SHA256 is `5571052254ae54222a2d1915c414671dd09fff83c68a2a2cf59a75c7b67b5a97`.

Every entry has an explicit title/index screening decision and acceptance gate.
This is **not89 full-paper reviews**. It does not verify publication, licence,
compute or field performance. There are20 visible table-header blocks and15
display-truncation notices; the export cannot prove all results from the
adviser-reported21 queries were supplied, or that the literature is exhaustive.
The year/index metadata also need care: STACI says2026 while its proceedings
URL contains2025; the spatial-autocorrelation item says2010 while its linked
PDF path contains1972. Neither inconsistency is resolved by a search snippet.

Independent Luna audit `c660c0a31dfb4feab92d56bf0a1b5511` found this to be the
same research set/synthesis already described here, with no additional immediate
E1–E6 priority beyond retained leads. Its report is an index/document comparison,
not fresh primary-source verification. A fresh attempt to read the inundation
review and LST-suitability publisher pages returned429; the GHSL page was
unavailable through the research tool. No scientific claims were adopted from
those failed reads, and no models, checkpoints or datasets were activated.

Since the earlier follow-up, `5f5e9d0` adds the standalone
[frozen forecast-policy experiment](../../forecast-policy.md): pinned
freeze/issue/score artifacts, matched-information baselines and explicit
abstentions. Its final-year gates are development only; genuine policy custody,
untouched evaluation and practical station utility remain unestablished.
The live workspace continues to use its existing release.

## Immediate decisions

| Lead | Checked evidence and decision | Smallest useful experiment |
|---|---|---|
| External flood references | [GEOID-Flood paper v1](https://arxiv.org/html/2608.02315v1) and [dataset card](https://huggingface.co/datasets/links-ads/geoid-flood) support a separate Sentinel-1 development track. Labels inherit CEMS and learned permanent-water errors; they are not field truth or NISAR validation. | Freeze small development events before examining outputs; reserve independent events/sites/scenes for final evaluation. Reconcile unknown pixels and score false alerts, misses, area discrepancy and withholding. |
| Area estimation | [Olofsson's 2025 NASA record](https://ntrs.nasa.gov/citations/20250004331) distinguishes maps from statistical area inference. Use a declared probability-sampling design and independent references before adjusted estimates or intervals. | Design stratified reference sampling, inclusion probabilities, missing-label handling and a reproducible estimator; independently reproduce a synthetic example before any real-data headline. |
| Forecast intervals | [STACI v2, §3.2 and §4.1](https://arxiv.org/html/2505.21658v2) uses locally approximately exchangeable neighbors for spatiotemporal interpolation. Its experiments use A100 GPUs, including conformal calculation. Reject the recommendation to treat it as an immediately cheap, assumption-free gauge-forecast upgrade. | First finish the actual-received, chronological numeric publication policy and matched-information baselines. Only then test a bounded interval challenger without future-neighbor leakage. |
| Burned-area references | [BARD](https://essd.copernicus.org/articles/12/3229/2020/) supplies image-derived reference files, useful for fire-product comparisons. It does not convert thermal detections into burned area or guarantee independent field validation. | Check dated reference support, sensor overlap, sampling and licence for a bounded Camp Fire-region comparison. Withhold if no compatible reference exists. |
| Plain-language uncertainty | [Müller and Döll 2024](https://gc.copernicus.org/articles/7/121/2024/) evaluated communication with participants. Audience and decision context matter; ranges and scenarios should remain visible. | Compare two real brief layouts with actual scientists/planners. Ask users to distinguish measured change, explanation and scenario, and identify what would change their decision. No invented participants. |

The GEOID paper records acceptance at the ECCV2026 Terrabytes II workshop;
Kimi's search-index-only “not yet peer reviewed” status is outdated. Its optical
input is a **pre-event composite**, not a clear post-event observation. Annual
embeddings used to derive permanent water may include observations after an
event; that label pipeline must never be represented as information available
to a real-time forecaster at that event.

There is a consequential radiometry discrepancy to resolve: the dataset card
calls RTC values linear **sigma-zero**, while the paper's cross-dataset protocol
describes terrain-flattened **gamma-zero**. Record the actual asset processing
definition before arithmetic. Do not silently equate these quantities or transfer
its calibration to NISAR Frequency-A HH GCOV.

### 15 October clarification and actual small case

The earlier apparent radiometry discrepancy concerns two different processing
contexts. The released-sample card/loader assert sigma-zero; paper §5.5 describes
gamma-zero for external-dataset harmonization. The retrieved TIFFs have no unit
metadata, so radiometric calibration remains provider-asserted. We do not equate
the quantities. The pinned tree also exposes individual loose sample GeoTIFFs;
four matched files cost19.7MB, eliminating TAR traversal for this milestone.
The default sample downloader remains oversized.

The [frozen real development case](../../geoid-development.md) retains its
metadata-only selected crop, even though only7935/65536 cells have common support
and no flood/permanent-water classes occur. Its analysis withholds temporal
comparison (orbit/incidence unknown) and flood scoring. This negative result
advances reproducibility; E2/E3 validation remains incomplete. The TAR protocol
below is retained for any later shard-only cases, not claimed as implemented.

## A genuinely bounded GEOID experiment

Code revision: `3a1647ed11aea0c81d5f59a8022e9cb8548bddab`.
Dataset revision: `868407460bf3db492f50730a57585916baa71dc6`.
The [pinned card](https://huggingface.co/datasets/links-ads/geoid-flood/blob/868407460bf3db492f50730a57585916baa71dc6/README.md)
declares compilation/splits/labels CC BY4.0; code is MIT. Copernicus notices must
be retained and the DEM has separate WorldDEM terms. Public access is not a
blanket licence for every layer.

The full collection and default sample exceed our operating budget. The public
catalogue is approximately 633KB, but the large chip CSV and shard downloader
are unsuitable defaults. Start with the pinned catalogue; check schema, event,
scene and acquisition identities before constructing a selection. A reported
`Accept-Ranges` HEAD response alone does **not** prove safe partial extraction.
Actual 206 status, exact Content-Range and bounded reads must be checked; reject
200/full-body fallbacks, changed object identity, unsupported TAR entries and
missing member metadata. Never fetch an entire shard to recover an unsupported
partial read. Reserve a maximum 64MiB experiment transfer budget and preserve
offset/size/hash receipts. This budget is an engineering limit, not a statistical
sample-size guarantee.

Native geometries, masks, zero/negative power handling and units must be explicit.
Evaluate a declared crop picked before looking at the labels. A small development
crop proves reproducibility and integration only. It does not establish general
flood-detection accuracy, independent NISAR performance or usefulness in response.

## Remaining leads: qualified, not activated

| Kimi entry | Status and applicability |
|---|---|
| Amitrano et al.2021 MT-SAR review | Method taxonomy lead. Test comparability and speckle handling; a review cannot certify our current detector. |
| Agram et al.2023 terrain flattening | Relevant geometry guidance. NISAR GCOV already has a documented gamma-zero basis: no automatic second terrain correction. |
| Ta et al.2026 TCEV flood anomalies | Interesting seasonal-baseline challenger. Publisher returned429; full assumptions, code, licence and compute remain unverified. No automatic per-pixel probability claims. |
| Chen and Bruzzone2021 self-supervised fusion | Research candidate. Check implementation/licence, registration, temporal availability and independent-region performance before inference adoption. |
| Li et al.2024 CausalCD | Deep-model candidate. A causal graph in a representation model does not identify the environmental cause of a change. |
| Padilla et al.2015 stratified burned-area comparison | Sampling-design lead. Confirm estimand and reference protocol before importing a ranking or formula. |
| He et al.2024 GFBS | Historical severity context candidate. Product-to-product agreement is not new field truth; check dates, masks, calibration and reference dependence. |
| Wang et al.2026 forest disturbance/recovery age | Timing-reference candidate, not evidence that a particular radar decrease is deforestation. Verify regional applicability and licence first. |
| Huang et al.2021 GISA | Urban historical-context candidate. Impervious cover, population, runoff and human heat exposure remain distinct quantities. |
| Lou et al.2026 GeoXCP | Explanation-stability candidate. A stable model explanation does not prove environmental causality. Licence and reproducible implementation unverified. |
| Xiao et al.2025 foundation-model survey | Catalogue for experiments, not a mandate to replace simple methods. Publication verified at arXiv:2410.16602; task-specific compute and transfer require measurement. |
| FloodNet-Lite2025 | Challenger only. The reported inference time is not our server/pipeline measurement; input sensor, checkpoint and licence need verification. |
| Siqueira et al.2026 NISAR early results | Exact primary paper and scientific transfer evidence remain unresolved. No accuracy claim adopted. |

Kimi's claim that our design already avoids biased area estimation is too broad:
we currently report mapped footprints and valid support. A defensible adjusted
area estimate still needs its sampling and reference evidence. An unsuccessful
plugin search for Olofsson2014 does not invalidate the existing verified
[2014 DOI](https://doi.org/10.1016/j.rse.2014.02.015).

## Continuation from T3

The interrupted **Dancing with the SARs Solutions** chat committed and pushed
`9565173`, `b471c9e` and `86692bb`. The last adds `observatory-1.5.0`
information-set disclosures. It checks timing and preserves all attempted dates;
it does not implement the complete numeric forecasting publication policy.
The recorded-water-history library is also still separate from a real-input
workspace workflow. These distinctions survive deployment.

The original prepared radar measurements and original historical forecast bodies
remain immutable. E1–E6 field/reference, chronological validation and actual
scientist-usefulness gates remain open. Continue by finishing the supervised
deployment and owner-isolation checks, then the numeric policy and bounded
reference experiments. Full goal completion cannot be inferred from passing
engineering tests.
