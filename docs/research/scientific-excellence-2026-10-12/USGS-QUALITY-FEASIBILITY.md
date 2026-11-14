# Live daily-discharge quality feasibility — 13 October 2026

The existing experimental `daily-discharge-policy-v1` accepts only literal
Approved/approved observations with empty qualifiers. That restriction applies
separately to development, required predictors and later scoring outcomes. The
policy is still offline; this audit neither activates it nor changes approved
quality assertions in the deployed observatory.

Two selected public stations were checked for parameter00060, statistic00003,
unitft³/s, requested6–12October2026. The four saved responses contain19,387bytes.

| Station | Matching returned dates | Approval | Qualifier | v1 quality eligibility |
| --- | --- | --- | --- | --- |
| USGS-01646500 | 6–11October2026, six days | All Provisional | All null | 0/6 |
| USGS-03339000 | 6–11October2026, six days | All Provisional | All null | 0/6 |

The [official v1 daily schema](https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/schema?f=html)
separates approval status from qualifiers such as ice/estimated observations.
The [USGS provisional statement](https://waterdata.usgs.gov/provisional-data-statement/)
explains that these observations are preliminary and can receive substantial
revisions. This supports a qualified experimental predictor policy as a future
option; it does not justify calling preliminary values approved or asserting
forecast accuracy. Twelve observations at two stations do not establish a
population-wide availability rate. Six days are also insufficient for the v1
1460-day development requirement; quality rejection is not the first freeze
failure for these short windows.

The returned final day is11October. Its absence on12October was kept unknown.
Two additional bounded requests show that a query ending on11October returns
that day with both date-only and end-of-day UTC bounds. Two further controlled
queries for6–7October return exactly those two dates using either`datetime` or
`time`. These samples **do not establish a query endpoint or ignored-parameter
bug**. The [migration guide](https://api.waterdata.usgs.gov/docs/ogcapi/migration/)
uses `time`, while [getting-started examples](https://api.waterdata.usgs.gov/docs/ogcapi/)
also use `datetime`; actual bounded checks resolve the relevant behavior here.
No provider code was changed based on an unproven hypothesis.

`last_modified` is a database refresh field and need not indicate that the
measurement changed. It is not an authentic original-publication instant or a
measured latency. The initial delegated report overclaimed those semantics,
assigned unsupported identical exact receipt timestamps to four sequential
responses, and did not supply its claimed offline reproducer. That report was
rejected; raw responses remain unchanged. The improved offline correction timed
out without writing files, so the coordinator completed deterministic reanalysis
without replaying network requests or changing provider accounts.

The corrected checker calls the actual v1 quality predicate and pinned station-day
resolver, validates station/parameter/statistic/unit, finite nonnegative values,
date limits, no pagination, one series and saved source hashes. It makes no
network, vintage, fitting or publication calls. Per-request receipt timestamps
from the first capture are explicitly unverified and are not used asreceivedAt.
Independent root query probes preserve distinct start/body-completion instants;
those describe these new requests, not historical availability.

Reproduction from preserved local evidence:

```sh
PYTHONPATH=. service/.venv/bin/python outputs/usgs-quality-20261013/check_offline.py
```

Two independent executions produced the same corrected audit SHA256:
`5fdaa208601370b5c6455f488aff8dd9a6d7c09c43f37985ec7daa59998053b7`.
The raw responses and scripts are in ignored local outputs; this document is a
traceable summary, not a remotely packaged reproduction bundle. Saved hashes
prove byte continuity, not timestamp authenticity or upstream completeness.

| Saved raw response | Bytes | SHA256 |
| --- | ---: | --- |
| Location01646500 | 4417 | `c4e3cf0a284980be8dd6404c596fd8b98e328f7827c49dad63975d0d1513509b` |
| Location03339000 | 3728 | `c88caf8e149653a50443315d79f93c126b20dd7cfa85729aa3e702f256322426` |
| Daily01646500 | 5633 | `0621a09d811d02985dd3b83f65e88d98a53f5b94262f1e1249e8da1be86dfdca` |
| Daily03339000 | 5609 | `12480bd5a3d612f4270dc661e33a19316e2e4eed23adbd560c4e509d14482ed5` |

Next useful experiment: keep v1 immutable; develop a separately versioned,
explicitly provisional predictor experiment with approved development/calibration
and approved later scoring outcomes. Preserve every issued attempt and revision,
compare matched baselines, and measure revisions/interval performance/utility
before connecting it to operational forecast publication. Current calibrated
bands cannot be assumed to account for provisional-input revision error. E5 and
actual scientist usefulness remain incomplete.

## Fixed historical admission experiment — 13 October

Before inspecting results, the next audit fixed station order USGS-09421500 then
USGS-03339000 and the 1,460-day window 2 October 2021–30 September 2025. Four
unauthenticated public USGS GETs returned 1,952,688 bytes in total; each response
has its own actual body-completion receipt. Complete original public response
bytes, receipt hashes and an independently reproduced compact summary are now
packaged in [the development fixtures](../../../examples/gauge-quality-admission/README.md).

| Station | Returned/consecutive days | Approval | Qualifiers | Actual strict freeze |
| --- | ---: | --- | --- | --- |
| USGS-09421500 | 1,460; no gaps | 1,327 Approved; 133 Provisional | None reported | Withheld: unsupported quality |
| USGS-03339000 | 1,460; no gaps | All Approved | 144 ESTIMATED; 7 FORCEINTERPOLATION | Withheld: unsupported quality |

Coordinator replay used the actual provider, vintage ledger and unchanged
`freeze_policy` function. Every date, source approval and qualifier was retained;
both sources withheld before fitting. A separate test prevents fitting calls
during each abstention and joins the raw response, captured snapshot and policy
hashes. This is a conservative policy result, not a universal judgment that
estimated observations cannot support useful science. The window was not shifted
and flags were not removed to manufacture a ready development model. Neither
station supplies a ready policy or new issued prediction in this experiment.

The separately versioned provisional-input point module now has an offline
[compute/score runner](../../forecast-policy.md#separate-provisional-input-point-experiment).
It requires trusted input and experiment pins, retains original statuses and
later truth revisions, and exports no inherited uncertainty bands or operational
publication. A saved three-row receipt exercises real-input withholding; its
one-second later analytic cutoff in the CLI regression is not a new retrieval
or prospective issuance. A synthetic ready fixture checks the computation and
scoring boundary without invoking fitting or calibration during those phases.

Current metadata remains insufficient proof of historical station configuration.
Body receipt times do not establish original publication or complete revision
availability. The public cases are consumed development evidence; independent
evaluation, operational prediction skill and the mixed-team usefulness pilot
remain outstanding.

## Separate older-window trial and source-profile follow-up

After preserving both failures above, trial2 explicitly declared one older
window at USGS-09421500: 2 October 2020–30 September 2024. Its purpose was to
test approval lag/support, not select a station or period by forecast metrics.
Two public responses completed at2026-10-13T10:55:12.081014Z and
10:55:13.585840Z, totaling983355bytes. The source still contains1460consecutive
finite observations, now all Approved, but348carry `REVISED` flags. The unchanged
v1 policy withheld asunsupported_quality. It stopped after those two queries;
the conditional recent-predictor capture was not executed and no points issued.

Raw daily SHA256 is
`3407c978648e7005dacc9c83be40b4a2b5f53c5c63fc852f5e50f7a55788cf9d`;
snapshot pin is
`72d15f74ec277c700e33af07fc695e23059974626300b274c5c294eeb74e0af8`;
policy pin is
`48ab42775e6b1132b8e91400113a0c816bcf33ccc92ae32cbab42c5149a91f5a`.
Ignored local outputs retain the raw responses, receipts, original snapshot and
policy. Independent Luna first verified the raw/data joins but could not rerun
strict validation in global Python without NumPy. A separate accepted check in
the existing project virtualenv strictly validated and reproduced the policy
with fitting entry points blocked. The earlier partial result remains qualified.

The [current v1 daily schema](https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/schema)
defines approval as processing/publication status, describes qualifiers only
generally, and warns that a refreshed `last_modified` does not necessarily mean
the measurement changed. The [USGS revision memorandum](https://water.usgs.gov/water-resources/memos/memo.php?id=2049)
documents revisions to approved time-series data and notes that downstream
computed values can carry revision qualifications even when their value remains
unchanged. These sources do not supply a complete daily-specific dictionary or
uncertainty weights for `REVISED`, `ESTIMATED` and `FORCEINTERPOLATION`. The
migration page's peak-code mapping is not transferred automatically to daily data.

The practical next step is descriptive source inspection: exact stored approval
labels and flags, overlapping counts, numeric/null/missing populations and a
bounded label preview. It supplies neither an accuracy score nor an eligibility
decision. Full-file profiles require explicit byte/hash/schema/identity checking;
compact metadata cannot substitute for the protected original. The existing
approved-only v1 and provisional point policies remain unchanged. A future
revision-aware scientific policy requires its own declared rules and evaluation.
