# Local USGS observation vintages

`service/observatory/vintages.py` records observations actually received by this
service. It establishes a local receipt history from the first capture onward.
It does **not** establish USGS publication times, pre-ledger availability,
forecast skill, accuracy, completed daily intervals, or E5 completion. E1–E6
field benchmarks and usefulness evidence remain separate and incomplete.
No network requests, annotations, private areas, or existing forecasts are
modified by this component. Provider/worker integration belongs to the
coordinator.

## API

```python
from pathlib import Path
from service.observatory.vintages import ObservationVintageLedger, VintageError

ledger = ObservationVintageLedger(
    root=Path('/var/lib/earthsignal/vintages'),  # existing directory
    owner=trusted_authenticated_owner,          # trusted service value, never exported
    storage_root=Path('/var/lib/earthsignal'),   # root must be inside this directory
    storage_bytes=config.storage_bytes,
    reserve_bytes=config.reserve_bytes,
)
identity = {
    'station': 'USGS-12345678', 'timeSeriesId': 'series-1',
    'parameter': '00060', 'statistic': '00003', 'unit': 'ft^3/s',
}
receipt = ledger.capture(
    identity,
    [{'date': '2026-01-01', 'value': 10.0, 'quality': 'Provisional',
      'qualifiers': ['Estimated']}],
    station_time_properties={
        'country_code': 'US', 'time_zone_abbreviation': 'PST',
        'uses_daylight_savings': 'Y',
    },
    response_hash=actual_response_sha256,
    metadata_hash=actual_station_metadata_response_sha256,
    received_at='2026-01-04T12:00:00Z',
)
snapshot = ledger.as_of(
    identity, '2026-01-04T12:00:00Z', start='2026-01-01', end='2026-01-03',
)
```

Constructor signature:

```python
ObservationVintageLedger(root, owner, *, storage_root=None,
    storage_bytes=1024**3, reserve_bytes=3*1024**3,
    max_versions=100_000, max_bytes=32*1024**2)
```

`root` and `storage_root` must be existing absolute directories; parent
traversal and a symlink at either supplied directory are rejected. Known ledger
files must be regular files with one hard link. DB, WAL, SHM, and lock are
managed at mode `0600` independently of caller umask; unrelated files and the
process umask are untouched. They have fixed names, independent of owner/series inputs. The coordinator supplies a trusted filesystem location
and authenticated owner; this class does not authenticate callers or protect
against an actor that can modify the directory/SQLite files directly.

`capture(identity, records, *, station_time_properties, response_hash,
metadata_hash, received_at)` returns `policyVersion`, normalized `receivedAt`,
`insertedVersions`, and `unchangedRecords`. The entire batch is atomic.

`as_of(identity, issue_time, *, start, end)` returns `policyVersion`,
`availabilityBasis: 'local-receipt-only'`, `identity`, normalized `issueTime`,
`start`, `end`, `calendarDays`, `unknownDays`, `observations`, and `snapshotHash`.
Dates are inclusive and a query covers at most 2,000 calendar days. Unknown
calendar days are counted but have no synthetic observation entries. Explicit
nulls **are** recorded entries and are distinct from unknown gaps.

Each observation exports:

| Fields | Meaning |
| --- | --- |
| `identity`, `date`, `value`, `quality`, `qualifiers` | Exact resolved day and its data quality; null remains null |
| `stationTimeProperties`, `stationPropertiesHash` | Bounded metadata captured with this revision; no historical metadata inference |
| `revision`, `receivedAt` | Per-owner/full-identity/day revision number and its first local receipt |
| `firstReceivedAt` | First local receipt of **any** recorded state for that owner/identity/day |
| `sourceResponseHash`, `sourceMetadataHash` | Source-byte lineage of this revision's first receipt |
| `contentHash`, `versionHash` | Canonical semantic content and complete exported version hashes |

There is no owner field, owner-derived hash, global sequence, database path,
request URL, or cross-owner count in exports. Owner filtering is in every read
and write. Identical histories belonging to different owners can yield identical
exports, without sharing stored rows.

## Input and revision policy

Identity has exactly the five fields shown above. Station is `USGS-` followed
by 8–15 ASCII digits. Parameter/statistic/unit are fixed at `00060` / `00003` /
`ft^3/s`. Time-series identifiers are 1–128 ASCII characters matching
`[A-Za-z0-9][A-Za-z0-9_.:@-]*`, excluding `..`. The trusted authenticated owner
uses the shared signed-principal contract: 1–256 ASCII characters with codes
33–126. It is an opaque parameterized SQL value, never a filesystem path or SQL
expression, and is never exported. Boolean/numeric principals, whitespace,
control characters and additional identity fields are rejected.

A batch contains 1–2,000 **actual observed**, caller-resolved unique dates. Do
not submit a calendar-padded provider display series: the ledger cannot determine
whether a supplied null was synthesized. Duplicate dates, even equal-value
duplicates, are rejected; the provider must apply its frozen duplicate policy
first. Mixed approval status remains a bounded quality label, not an invented
approval. Records require exactly `date`, `value`, `quality`, with optional
`qualifiers`; other keys are rejected.

Values are null or finite nonnegative Python int/float (boolean rejected).
Numbers normalize to binary64; an integer not exactly representable as binary64
is rejected rather than rounded. Negative zero normalizes to positive zero.
Quality is 1–256 printable ASCII characters. Qualifiers are a list of at most
16 strings, each 1–64 printable ASCII characters; duplicate qualifiers are
removed and sorted. Control characters, angle brackets, and backslashes are
rejected in these text fields. Labels are stored as data and must be rendered
as text by consumers.

Station time properties allow only `country_code`, `time_zone_abbreviation`,
and `uses_daylight_savings`. Each can be missing, null, or a 1–32-character
bounded string. Unknown metadata is preserved, never filled with UTC or a
location guess. Actual station-day interval resolution remains the separate
`gauge_time.py` policy. Missing and explicit-null properties remain distinct.

Dates must be canonical, real Gregorian `YYYY-MM-DD` strings. Receipts/issues
are timezone-aware `datetime` objects or strict RFC3339 strings with full
seconds, optional 1–6 fractional digits, and `Z` or `±HH:MM` offsets. Invalid
offsets, naive timestamps, leap seconds, and unknown-offset `-00:00` are rejected.
Accepted times normalize to UTC `YYYY-MM-DDTHH:MM:SS.ffffffZ` before comparison.

Receipt ordering is per owner/full identity and persists over restart:

- A receipt earlier than the last successful capture is rejected, even for an
  unchanged response or previously unseen day. The service must supply actual
  local receive times; no backdating/backfill of availability is permitted.
- Equal timestamps permit identical overlap and disjoint new dates. A changed
  existing day at the same series receipt time rejects the whole batch; arrival
  order never chooses a winner for such a tie.
- Semantic comparison uses identity, date, normalized value, exact quality,
  normalized qualifiers, and station time properties. A→B→A is three versions.
  Same-value quality/qualifier changes, metadata changes, and explicit-null
  withdrawals are revisions. Omitted dates do not delete any previous record.
- Semantically unchanged repeats add zero versions and do not rewrite receipt
  timestamps or source hashes. Only the series receipt watermark advances.
  There is deliberately no unbounded audit log of identical refetches.
- Source-response-byte or metadata-response-byte hash changes **alone** do not
  constitute semantic revisions. Dynamic response headers can differ. Original
  lineage is retained for an unchanged state; station properties have their own
  canonical hash. Both supplied source hashes must be lowercase SHA-256 hex;
  verifying them against actual upstream bytes is the caller's responsibility.

ASOF selects the latest revision received **at or before** issue time for each
owner/identity/date. Later revisions and later station metadata cannot affect
an earlier snapshot. Local receipt eligibility alone does not prove observation
interval completion or forecast publication eligibility.

## Reproducing hashes

Canonical JSON uses Python `json.dumps(value, sort_keys=True,
separators=(',', ':'), ensure_ascii=True, allow_nan=False)` encoded as UTF-8;
hashes are lowercase SHA-256. This is an application convention, not a claim of
RFC 8785 numeric formatting.

- `stationPropertiesHash`: hash of `stationTimeProperties`.
- `contentHash`: hash of `{identity,date,value,quality,qualifiers,stationTimeProperties}`.
- `versionHash`: hash of the complete observation dictionary excluding only `versionHash`.
- `snapshotHash`: hash of the complete snapshot excluding only `snapshotHash`.

Reads check the stored version hash and reject corrupt/malformed records with
sanitized errors. Returned snapshots are detached dictionaries; changing them
cannot alter the database. Revision rows also have SQLite update/delete rejection
triggers. This detects accidental corruption; it is not a signature against an
actor with direct database access.

## Storage admission and failures

The ledger uses local SQLite WAL with `synchronous=FULL`; every API operation
holds the fixed-file advisory lock. Concurrent ledger lock contention fails
explicitly instead of waiting indefinitely. SQLite lock/checkpoint operations
have a five-second busy timeout. Coordinator integration should handle explicit
availability failures without inventing receipts or automatically pruning data.
This is a local-filesystem design; network-filesystem locking is unverified.

The total version ceiling is 100,000 **across all owners and identities**. A
caller can lower it or the byte ceiling for resource tests, never raise the hard
limits. Count admission and inserts share `BEGIN IMMEDIATE`. Storage normally
fills before 100,000 versions; the row ceiling is not a promise of that capacity.

For byte limit `B` (at most 32 MiB), the database page cap is:

```text
P = floor((B - 128 KiB) / (2 * 4096 + 24))
peak envelope = P * 4096 (DB) + P * (4096 + 24) + 128 KiB (WAL/SHM overhead)
```

Cache spilling is disabled and the cache is 32 MiB, exceeding the capped database
size. A dirty page is emitted to WAL once at commit. WAL is checkpointed/truncated
before a transaction; pinned external readers that prevent truncation cause an
explicit failure. This reserves space for the whole capped DB and a full
transaction's WAL together, rather than treating the DB size alone as the limit.
The 128 KiB allowance covers the WAL header and WAL-index/SHM allocation.
Initialization follows the same envelope.

Preflight reserves the *remaining full ledger envelope* against summed files
under `storage_root` and free disk minus `reserve_bytes`. It repeats before
commit. The scan is bounded at 100,000 directory entries and refuses symlinks
or inaccessible directories. Existing DB/WAL/SHM sizes are checked against the
byte ceiling. SQLite's page limit independently rejects growth during a batch;
`SQLITE_FULL` or the final admission failure rolls back all inserted versions
and the receipt watermark. No history is pruned, overwritten, vacuumed, or
silently deleted. Checkpointing removes transient WAL frames after merging
committed pages; it does not remove observation history.

The lock coordinates this component's instances. Other service writers must
coordinate their own shared reservations: the scan cannot atomically stop an
unrelated process from consuming shared storage/free disk or directly changing
ledger files. A filesystem quota supplies enforcement against unrelated writes.
Conservative read admission also requires the remaining envelope/free reserve,
because opening WAL may create shared-memory state.

`VintageError.code` is one of `invalid_input`, `receipt_order`, `receipt_tie`,
`version_limit`, `storage_limit`, `ledger_unavailable`, `schema_mismatch`.
Messages contain no submitted inputs, owner, SQL text, or paths. Capture returns
no success receipt on failure. No automatic retries, deletion, migration, or
provider fallback is implemented.

## Checks

Run `service/.venv/bin/python -m unittest service.tests.test_vintages -v`.
Synthetic tests cover permutations, caller-resolved equal duplicates, A→B→A,
unchanged refetches, quality/qualifier/metadata revisions, null withdrawals,
old-issue freezing, owner/station/series isolation, unknown omitted days,
canonical hashes, aware timestamps, restart, row/disk/shared-storage admission,
rollback after inserts, real SQLite page exhaustion, immutable SQL rows, and
a full 2,000-day capture/revision with live WAL/SHM envelope checks, private
file modes under both permissive and restrictive umasks, concurrent lock
contention, and an actual pinned external WAL reader. These are
storage/availability-policy tests, not measured field accuracy or useful forecasts.


The bounded implementation run on 2026-10-12 used Python 3.12.15 / SQLite
3.54.0. The focused ledger suite has **24 tests**; running it with the existing
gauge-time and provider suites produced **64 passing tests**. A separate
synthetic measurement captured two 2,000-day states (4,000 versions), then read
2,000 ASOF days in 0.241 s; process peak RSS was 50.47 MiB. Observed live
post-commit files totaled 6,281,752 bytes: DB 2,998,272; WAL 3,250,712; SHM
32,768; lock 0. This is one local measurement, not a worst-case memory/runtime
bound, throughput guarantee, provider benchmark, or scientific accuracy result.

## Processing file envelope

A scoped, ledger-enabled assessment may write a shared ledger file under a
32 MiB subprocess file envelope. Radar, scenario and unscoped jobs retain the
8 MiB envelope. The ledger independently caps its total DB/WAL/SHM storage at
32 MiB and each SQLite data/WAL file below that size. Published artifacts still
have the separate **8 MiB per-file** validation in `Worker.publish`; shared
storage, reserved disk, job runtime and transfer limits remain unchanged.
This avoids prematurely exhausting the archive at the export-file boundary.
