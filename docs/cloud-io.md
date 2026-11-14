# Faster satellite reads, with the same science

Earthsignal reads small windows of satellite files. It does not need to download
a whole NISAR granule to analyze a patch. This round improves reuse of bytes
already read, bounds cache bookkeeping, and makes that behavior measurable.

The October 2026 cloud-native proposal supplied useful ideas, but its diagnosis
was not a measurement of this application. Its FITS, battery telemetry and
million-point chart examples are not current Earthsignal workloads. No new
reader framework, four-worker pool, analytical resampling or chart decimation
is introduced here.

## Audit and scope

Here, F is remote granule size, C is a bounded requested range, P is crop pixels,
M is inspected metadata, and N is the already bounded history length.

| Path | Existing behavior and resource scaling | Action |
|---|---|---|
| `service/range_reader.py`: `RemoteAsset.fetch` | Range-only HTTP; at most 8 MiB per request; 16 MiB raw cache per asset. Previously exact keys only and no entry-count limit. Memory does not scale with F. | Reuse one fully containing validated interval; cap cache at 256 entries as well as 16 MiB. |
| `service/processing.py`: `inspect_metadata` | h5py reads through bounded seekable `RangeFile`; metadata and transport cache cost O(M + C), not a whole-granule array. | Keep driver; share the improved per-asset cache with GDAL reads. |
| `service/processing.py`: `process_job` | GDAL `ReadAsArray(*window)` reads power and quality windows. Numerical work and crop arrays O(P), capped at one million pixels. Native inputs are never analytically warped. | Keep math, masks, grid checks, hashes and algorithm version. Add optional aggregate I/O diagnostics to new manifests. |
| `service/processing.py`: `lookup_source` | Exact-ID catalogue JSON limited to 2 MiB. | Keep bounded metadata reads; a catalogue response is not a science granule. |
| `service/observatory/net.py` and provider adapters | Allowlisted bounded response bodies, transfer accounting and explicit provider failures; gauge requests bounded to 2,000 records. | No speculative CSV/Parquet migration. |
| `lib/history-chart.ts` | Exact observations and explicit missing-date gaps, O(N) display input. | Preserve dates, gaps and source values. Downsampling requires a demonstrated display bottleneck and separate visual semantics. |

The new cache lookup costs at most 256 interval comparisons. It neither combines
partial overlaps nor fetches extra bytes in anticipation of a later request.
Hits update LRU order without adding a second copy to the cache. EOF-clipped
intervals are stored by their actual bounds. Cache lifetime remains one asset
inside one processing job; ownership and authentication boundaries are unchanged.

Existing source-length, ETag, response-range and encoding checks still apply to
upstream reads. An observed source error prevents further cache use. A cache hit
does not contact the provider to check freshness; this was already true for exact
hits. Raw cache storage is bounded, but response assembly, returned slices, native
libraries and crop arrays also use memory: 16 MiB is **not** a process RSS limit.

## Read diagnostics

New radar manifests extend `processing.sourceMetadata` with optional `rangeIo`:

- `schemaVersion: "1.0"`, `cachePolicy: "contained-range-lru-v1"`.
- `assets`: before/after aggregate snapshots in that order.
- Each snapshot records logical fetch calls, requested bytes, exact/containing
  hits, cached bytes served, opener attempts, received body bytes, elapsed fetch
  seconds and current cache entries/bytes.

No URLs, byte offsets, cookies, credentials or raw exception messages are recorded.
Counters saturate at a fixed integer maximum. Elapsed time includes lock waits;
it is not CPU time. Opener attempts are calls to `opener.open`, **not** all HTTP
transactions: redirects and authentication can create additional round trips.
For broken chunked responses, Python can discard payload before exposing it.
`body_bytes_received` counts exposed payload; `unobserved_bytes_charged` reserves
the remaining validated interval conservatively. `body_bytes_charged` reconciles
with the shared transfer budget. Successful reads have zero unobserved charge.
Source identifiers, extracted-input hashes and scientific
algorithm version retain their existing meanings. Older manifests remain valid.

## Reproduce the checks

Offline, with the existing service environment:

```sh
PYTHONDONTWRITEBYTECODE=1 service/.venv/bin/python -m unittest service.tests.test_range_cache service.tests.test_processing -q
service/.venv/bin/python scripts/benchmark-cloud-io.py
```

The synthetic trace exercises 259 reads, including nested intervals. Its output
hash must match the retained baseline; it demonstrates reuse, not real-world
latency. To compare a trusted earlier transport implementation without changing
the checkout, use `--reader-file /absolute/path/to/old-range_reader.py` in this
offline mode.

For an explicit live reproduction, run the script from each **frozen whole-code
checkout** in a fresh process on the science host. Supply a retained radar
manifest, a server-side netrc path, and a new operator-owned scratch directory:

```sh
python scripts/benchmark-cloud-io.py --manifest /path/to/retained/manifest.json --netrc /path/to/earthdata.netrc --output-dir /path/to/new-scratch-result
```

The runner refuses an existing output directory, uses the normal authenticated
allowlisted processor and its crop/transfer limits, and never opens a job database.
Operators should run it while the queue is idle, under the same resource limits
as a worker, with a 20-minute subprocess timeout. Do not use a live result path
as scratch storage. Errors return a sanitized code; partial scratch outputs stay
outside published artifacts and require operator cleanup.

The report compares source IDs, grid/crop, statistics, coverage, algorithm,
extracted-input hashes and all eight non-manifest artifact hashes. A mismatch
returns exit 2. The manifest itself contains an execution timestamp and optional
performance diagnostics, so byte-identical manifests are not expected. Reports
also include whole-process peak RSS, wall/CPU time and phase durations. RSS
includes imports and native allocations but excludes other services; compare it
with systemd `MemoryPeak` for the whole benchmark cgroup. No `tracemalloc` claim
stands in for native/process memory measurement.

## What would justify a larger change?

Measure several products and crop sizes first. Repeated overlapping reads may
justify tested coalescing; expensive repeated metadata discovery may justify a
pinned virtual index. Either needs immutable source binding, compatible filters,
auth/ownership protection, cancellation/budget tests and scientific parity.
More workers need measured concurrent memory and latency on the shared host.

[h5py threading](https://docs.h5py.org/en/stable/threads.html),
[h5py file/cache options](https://docs.h5py.org/en/stable/high/file.html),
[h5coro's supported reader](https://github.com/SlideRuleEarth/h5coro) and
[VirtualiZarr](https://virtualizarr.readthedocs.io/en/stable/) explain why changing
libraries or setting universal cache values is not automatically an improvement.
Visualization subsampling would remain separate from scientific calculations;
missing observations must not disappear into an interpolated line.
