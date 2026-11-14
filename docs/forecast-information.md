# Pinned gauge information sets

`service.observatory.forecast_information.forecast_information` implements an
information-set and target-timing prerequisite for [E5](research/scientific-excellence-2026-10-12/BENCHMARKS.md).
It does not produce predictions, evaluate skill, establish publication readiness,
or satisfy the full operational forecasting-policy gate.

```python
from service.observatory.forecast_information import forecast_information

result = forecast_information(
    captured_snapshot,
    expected_snapshot_hash=trusted_stored_snapshot_hash,
    issue_time=recorded_issue_instant,
    horizons=(1, 3, 7),
)
compact_report = result['report']
```

The snapshot is exactly the `ObservationVintageLedger.as_of` schema described in
[gauge-vintages.md](gauge-vintages.md). `issue_time` accepts an aware `datetime` or
strict RFC3339 timestamp; its normalized UTC microsecond instant must equal the
snapshot issue time. The external SHA-256 pin is mandatory and must come from
trusted capture/storage. Reading a pin from an untrusted snapshot, or recomputing
one after modifying input, does not establish authenticity. A snapshot self-hash
only verifies internal integrity; neither hash proves that local receipts are
true or represent complete historical upstream information.

`validate_gauge_snapshot(snapshot, expected_issue_time=None)` is the reusable,
strict schema/integrity validator. It accepts arbitrary real issue instants,
independent of a particular capture receipt, and returns `None` on success.
`validate_gauge_vintage(value, request, processed_at)` additionally retains the
capture receipt's exact canonical issue equality, policy and count bounds,
request start/end equality, and processing-time check. Neither validator reads
mutable ledger state.

Structural errors raise sanitized `ValueError` messages without input, SQL or
filesystem diagnostics. The bounds remain inclusive 1–2000 calendar days and
at most one ordered source record per date; records must carry the existing full
identity, version/content/station/source hashes, quality/qualifiers, station-time
properties, revision and canonical receipt lineage. Nonfinite, negative,
boolean or unsupported numeric values are rejected. Explicit null values are
valid withdrawals. There is an 8192-byte canonical JSON record ceiling and a
`2000 * 8192 + 8192`-byte snapshot ceiling; current strict field and collection
limits already constrain valid payloads below those defensive byte ceilings.

The result is a detached JSON-compatible dictionary with three sections:

| Section | Contents |
| --- | --- |
| `ledger` | One entry per supplied snapshot record: the full original `record`, `status` (`retained` or `excluded`), stable exclusion `reason` or null, and compact `stationDay` resolution with pinned metadata/registry/rule provenance. |
| `points` | Only retained records, in canonical actual-date order, with `date`, `value`, `quality`, `qualifiers`, `versionHash`, and `interval`. Zero and singletons remain actual observations. |
| `report` | Compact method/issue/snapshot/information identity; range, counts and reasons; latest retained date; station-time provenance; and at most seven target attempts. Suitable for later engine/UI integration. |

All sections and nested mutable values are detached from the caller, from each
other and from subsequent calls. The ledger preserves the version available for
every attempted date in the supplied snapshot, including all its source hashes.
It is not a copy of every historical revision in the underlying database: those
versions remain in the immutable vintage ledger. Missing calendar dates are
counted as `unknownCalendarDays`, never padded with invented records or values.

For every supplied record, `gauge_time.station_day` resolves its own stored
station-time properties under the reviewed pinned USGS registry and NIST rule
version. A nonnull record is retained only if its station day resolves and its
whole interval has completed at issue. Exclusion precedence is:

1. `null_withdrawal` for an explicit null, even if its timing also cannot resolve.
2. `unresolved_station_time` for a nonnull record whose station day is withheld.
3. `incomplete_at_issue` for a resolved nonnull day ending after issue.

Quality and qualifiers survive unchanged; this prerequisite does not invent a
quality-based selection policy or interpolate. Completion at exactly issue is
allowed. Resolved spring/fall intervals retain 23/25-hour durations. The existing
station-day rule's country, timezone/DST and 2007–2026 review bounds apply. Current
station metadata still cannot prove historical station configuration.

`report` uses `method="gauge-forecast-information-v1"`. Its keys are:

| Keys | Meaning |
| --- | --- |
| `status`, `reason` | `resolved` with null reason for a retained uniform metadata set; `withheld` with `no_eligible_day` or `mixed_station_metadata` otherwise. Resolved information does not imply that any target is future. |
| `issueTime`, `snapshotHash`, `informationHash`, `availabilityBasis`, `identity`, `start`, `end` | Canonical issue, externally pinned source identity, output digest, local-receipt basis, full station-series identity and inclusive calendar range. |
| `counts` | `calendarDays`, `attemptedRecords`, `retainedRecords`, `excludedRecords`, `unknownCalendarDays`, `nullWithdrawals`, `unresolvedStationTime`, `incompleteAtIssue`. Exclusions plus retained equal attempted; unknown plus attempted equal calendar. |
| `exclusionReasons`, `latestRetainedDate` | Stable reason counts and latest actual retained date, or null if none. |
| `stationTime` | `ruleVersion`, ordered `registryHashes`, `registrySource`, `dstRuleSource`, `minYear`, `reviewCeiling`, `retainedMetadataCount`, and uniform `properties`, `stationPropertiesHash`, `metadataHash` (null when no unique retained metadata). No per-record metadata array is exported in the report. |
| `timingAttempts` | Unique ascending requested horizons with `horizonDays`, `status`, `reason`, `timingEligible`, `observationCutoff`, `targetInterval`, `lagHours`, `leadStartHours`, `leadEndHours`, `ruleVersion`. |
| `limitations` | Explicit boundaries on local receipts, externally trusted pins, historical station configuration, and forecast/publication/E5 claims. |

Horizons must be a list/tuple containing 1–7 entries, each an integer 1–7;
booleans are rejected. Duplicates collapse and order canonicalizes. Every target
is the latest actual retained date plus the requested calendar horizon, resolved
through `gauge_time.forecast_timing`. `timingEligible` is true only for a whole
future interval whose start is **strictly after** issue. A target starting exactly
at issue is `partly_elapsed` and ineligible. Expired targets remain expired;
there is no advance to a later date. Unresolved target timing is withheld.

If no day is eligible, or retained station-time properties have differing hashes,
every requested horizon has an explicit withheld attempt with null target/lead
fields. Mixed metadata never selects a preferred timezone. Null or unresolved
excluded metadata does not disqualify otherwise uniform retained days. The report
does not expose the primitive's `publicationEligible` field or its local-file
diagnostics. It uses bounded stable reason codes instead.

To verify the output digest, copy the complete result, remove only
`result['report']['informationHash']`, and call `vintages.canonical_hash` on that
complete three-section result. The compact report alone cannot reproduce this
hash: regenerate the internal ledger/points from the pinned snapshot when
validating an exported report. Frozen old as-of information remains byte-identical
after later receipt revisions when inputs and pinned timing rules are unchanged.

The focused tests are synthetic contract checks, not real historical availability
receipts or an accuracy benchmark. Run them with the existing service environment:

```sh
PYTHONDONTWRITEBYTECODE=1 service/.venv/bin/python -m unittest \
  service.tests.test_forecast_information service.tests.test_vintages \
  service.tests.test_vintage_integration service.tests.test_gauge_time \
  service.tests.test_forecast_archives
```

E5 still requires a frozen issue/quality/model/calibration/selection/abstention
policy, identical information-set comparisons against the specified baselines,
an untouched policy-evaluation period or prospective evidence, all attempt and
failure accounting, task-specific utility/error acceptance, publication rates
and conditional skill, and appropriate handling of dependent targets. This
module leaves the current and frozen forecasting bodies unchanged.

## Workspace integration

New `observatory-1.5.0` assessments that capture a gauge snapshot attach the
compact `forecastInformation` report. The worker pins its own trusted ledger
read; manifest validation regenerates the report from that frozen snapshot,
checks a16KiB limit, and compares canonical JSON with types preserved. A boolean
cannot masquerade as a numeric count. Archived1.4 results remain readable without
adding or rewriting this report; historical v2/v3 forecast bodies are unchanged.

The existing receipt disclosure inside recorded history presents complete,
excluded and unknown-day counts and target timing. This report does not promote
the neighboring revised-data retrospective model evaluation to prospective
skill. Microsecond issue gates use integer arithmetic in the web contract;
displayed lead checks preserve the backend's seconds-before-hours floating
operation order. Missing observation cutoffs, inconsistent horizons, metadata
and reason/status combinations are rejected. An unresolved future date beyond
the reviewed window keeps its attempted date with null interval fields.

The real frozen USGS example has three June2025 observations received in
October2026. Its new report reproduces all three retained days and every target
as expired; receipt dates are never backdated. See the
[example](../examples/gauge-vintage-receipt/README.md).

One isolated macOS/Python3.12 test captured and evaluated2000 synthetic records:
maximum RSS66,355,200B, peak memory footprint48,481,280B, elapsed0.82s. Its compact
report was below8KiB. This is one standalone fixture, not a live concurrency,
maximum text-payload or production memory guarantee.
