# Estimate a footprint without overcounting rare changes

For the guided browser workflow, private jobs and downloads, see
[Sampling & uncertainty](sampling-workspace.md).

This experimental offline tool answers a statistical question: **given a declared
probability sample and recorded categories, how much of the recorded frame belongs
to each category?** It supports water, vegetation, disturbance or other categorical
experiments. It does not classify imagery, establish map accuracy or diagnose a
hazard. The current Lake Mead review exercise is not automatically an input.

## In simple terms

Imagine checking more squares around suspected changes so you can inspect them
carefully. Those squares are useful, but their frequency in your sample is not
their frequency across the place. Earthsignal weights each sampling group by its
share of the recorded area. It keeps missing or unclear answers visible instead
of filling them in or treating them as unchanged.

The reported sampling standard error measures variation caused by which squares
were selected. It does **not** measure mistakes in interpreting a square,
misaligned imagery, wrong dates or the distortion of a projected grid. A small
standard error does not make those problems disappear. This version supplies no
confidence interval or decision recommendation.

## What the method assumes

The frozen frame consists of nonoverlapping nominal equal-area cells, partitioned
into known strata. Selection is independently simple random without replacement
within each stratum. The record includes every selected cell, including unfinished,
uncertain and unobservable outcomes. Population and selection counts are fixed;
post-stratification, clusters, unequal-probability samples, adaptive stopping and
convenience samples require other methods.

All categories must be mutually exclusive and compatible with the recorded
response target. The target is a definition of the quantity to estimate, not a
claim that a classifier uses that definition. SCL-derived groups can supply
auxiliary stratification without becoming reference labels. Estimating the area
of a reference-defined category does not require that category to equal SCL;
**scoring a classifier against it would require a separate compatibility check.**

For example, the guided exercise asks whether open water covers the *whole*
20 m square. Its categorical footprint is not a measurement of fractional open
water within mixed cells. [Copernicus describes SCL's spectral/contextual processing](https://sentiwiki.copernicus.eu/web/s2-processing);
this does not establish equivalence to the guided response rule.

An author manuscript of Olofsson's **Accuracy and Area Estimation**, dated
8 April 2025 and [hosted by NASA](https://ntrs.nasa.gov/api/citations/20250004331/downloads/Olofsson_CRS_2nd_ed.pdf),
connects sampling, response design and estimation, and distinguishes counted map
pixels from reference-based inference. [Olofsson et al. (2014)](https://doi.org/10.1016/j.rse.2014.02.015)
likewise separates response and sampling designs. Their map-class-strata formulas
are not assumed to cover every auxiliary stratification. The implementation below
uses a finite-population categorical SRS covariance and is checked by exhaustive
small-population enumeration; it is not a literal transcription of the 2025
manuscript's displayed variance equations; those are not treated as a complete
implementation specification.

## Recorded formula and limits

Method: `stratified-srswor-equal-area-v1`. For stratum `h`, let `N_h` be its cell
population, `n_h` its selected cells and `p_hk` its sample fraction in category
`k`. Let `N = sum N_h`, `W_h = N_h/N`, and `a` the nominal cell area in m²:

```
p_hat_k = sum_h W_h * p_hk
area_hat_k = N * a * p_hat_k
Cov_hat(p_hat) = sum_h W_h² * (1 - n_h/N_h) / (n_h - 1)
                 * [diag(p_h) - p_h p_hᵀ]
Cov_hat(area_hat) = (N*a)² * Cov_hat(p_hat)
```

The covariance formula applies to non-census groups with at least two samples.
Census groups contribute zero sampling variance, including a one-cell census.
Any non-census singleton makes the **entire** covariance and every standard error
unavailable; its point estimate can still be calculated. Omitting that group's
variance would understate the missing uncertainty. Negative off-diagonal
covariances matter when comparing or combining categories.

Any unfinished, unclear or unobservable selected answer, or any positive stratum
with no sample, withholds **all** category estimates. It does not shrink the
population, change selection probabilities, produce respondent-only weights or
turn unknown into a category. Missing, duplicate or foreign selected IDs are
structurally invalid. A homogeneous non-census sample can have zero *estimated*
variance without establishing that the unsampled population is homogeneous.

The bounded kernel supports 64 strata, eight categories, 320 selected cells and
one million frame cells. Combined canonical inputs and the canonical result are
bounded at 2 MiB. Input and output have independently recorded fingerprints;
hashes detect revision, not authentic sampling, reviewer identity or truth.
Cell area must lie between 1e-12 and 1,000,000 m². The lower bound is an
engineering guard against binary64 area/covariance underflow with the recorded
population/sample limits, not a universal scientific resolution threshold.
Nominal areas and binary64 rounding retain the stated method limitations.

## Run the reproducible software demonstration

All observations in [the demonstration](../examples/stratified-area-demo/input.json)
are synthetic software fixtures. No satellite or human reference labels are
created by the fixture. Run from the repository root with the existing Python
runtime, writing to a new private destination:

```sh
PYTHONPATH=. service/.venv/bin/python -m service.benchmarks.area_experiment \
  --input examples/stratified-area-demo/input.json \
  --input-pin e5c5746f151619a6d6baba062b300b53f9dd3bb505b3178050461c9b50732dd2 \
  --output /private/path/new-area-experiment.json
```

The example selects 20 of 100 cells in one group and 30 of 900 in the other.
Category A appears in eight and three selected cells respectively. The naive
sample fraction is 11/50 = 22%; the proper design-weighted proportion is 13%.
At 400 m² per cell, the conditional estimate is 52,000 m², with estimated sampling
standard error about 20,123.83 m². These are **toy arithmetic**, not measurements
of a real place or evidence that a detector is correct.

The independently retained raw-file SHA-256 is checked before JSON parsing or
calculation. Duplicate keys, malformed encoding, nonfinite numbers and unsupported
schemas fail. Files are bounded at 2 MiB; the output cap measures the exact
ASCII-escaped canonical serialization plus newline used by the atomic writer.
Outputs have mode0600 and never replace an existing file, directory or symlink.
Stdout omits source IDs, study names and category areas. Private artifacts retain
input lineage, scientific limitations and a short plain-language explanation.

## Experimental results and scientific promotion

The experiment envelope records source identities, hashes, observation times,
geometry identity, response/selection/outcome freeze times and reference-review
attestations. Protocol and selection precede outcome freeze; malformed or unknown timezone
offsets, future sources and
invalid declarations are refused. A declaration of external review remains a
**declaration**. It does not prove field truth, authentic selection or independence.

Synthetic or development inputs stay `withheld-development-evidence`; other
permitted reference experiments still say `requires-external-scientific-review`.
No artifact receives scientific validation or decision authority from this runner.
Qualified response design, reference quality, geometry/time/source linkage,
untouched validation and any suitable accuracy estimator remain separate gates.
Existing raster-local benchmark summaries keep their own method and meanings;
this addition does not silently reinterpret them as sampling-adjusted areas.
