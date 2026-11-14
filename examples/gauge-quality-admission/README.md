# Two real source-quality abstentions

These public USGS sources are **DEVELOPMENT fixtures**, not independent final
evaluation, flood labels or evidence of forecast accuracy. The station order
09421500 then 03339000 and the window 2 October 2021–30 September 2025 were
declared before retrieval or fitting. Four bounded unauthenticated public GETs
completed on 13 October 2026; the original response bytes and distinct
body-completion receipts are retained under `sources/`. Total response size is
1,952,688 bytes. No pagination, source substitution or additional station search
was used to obtain a favorable model result.

| Source | Retained days | Approval | Separate qualifiers | Frozen policy |
| --- | ---: | --- | --- | --- |
| USGS-09421500 | 1,460 | 1,327 Approved; 133 Provisional | None reported | Withheld: unsupported quality |
| USGS-03339000 | 1,460 | All Approved | 144 ESTIMATED; 7 FORCEINTERPOLATION | Withheld: unsupported quality |

Both sources contain the entire consecutive requested window and one daily mean
discharge series in ft³/s. The unchanged `daily-discharge-policy-v1` development
rules conservatively require completed, approved, unqualified observations.
Approval and source qualifiers are separate fields: approved does not mean
unqualified. All returned days, flags and original statuses survive provider
parsing and vintage capture. Neither case invokes development fitting. This
policy abstention does not establish that qualified data are universally unusable;
using them would require a separately declared and evaluated policy.

Run the offline regression with the existing environment:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. service/.venv/bin/python -m unittest \
  service.tests.test_real_gauge_admission -v
```

The check joins exact source byte hashes, record counts, captured snapshot hashes
and policy hashes in `receipt-summary.json`, and prevents fitting during these
abstentions. It makes no network request. Temporary test ledgers use an explicit
offline fixture reserve; production storage admission remains unchanged.

Receipts describe response completion now, not original publication or historical
availability. Hashes identify retained content; they do not authenticate upstream
timestamps or prove complete revision histories. Current station metadata cannot
prove historical timezone or aggregation configuration. Analytic freeze cutoffs
are recorded separately from response completion; they do not establish prior
policy custody or prospective issuance. No recent predictor capture, ready policy,
point prediction, calibrated interval or scientist-usefulness result is supplied
by these fixtures. Sources follow the [USGS Water Data OGC API](https://api.waterdata.usgs.gov/docs/ogcapi/).
