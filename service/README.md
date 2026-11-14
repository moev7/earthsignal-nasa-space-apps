# Earthsignal processing service

The FastAPI/uvicorn Python backend accepts only HMAC-authenticated gateway requests. It queues work immediately; one separate worker performs official NISAR GCOV Frequency A HHHH gamma0 comparisons. It does not generate an example science result. Source compatibility and mask semantics must be verified from the science file before results become visible.

The canonical wire schema is `../lib/radar-contract.ts`. Paths are identical behind the gateway: `GET/POST /api/change-jobs`, `GET /api/change-jobs/{id}`, `POST /api/change-jobs/{id}/cancel` (also DELETE on the job), and authenticated `GET /api/change-jobs/{id}/artifacts/{name}`. GET `/health` returns nonsensitive liveness only. The list response includes `capability.ready/message/maxPixels`; absent Earthdata configuration or required GDAL drivers disables submissions with 503. Existing idempotency records remain available. A successful POST returns 202 with a queued job, with no synchronous science work.

## Pinned runtime and deterministic checks

Production target verified by coordinator: **Ubuntu 26.04.1**, system **Python 3.14.4**, matching **libgdal/python3-gdal 3.12.2+dfsg-1build2**, apt **NumPy 2.3.5**, **Pillow 12.1.1**, **h5py 3.15.1**. Native libraries are installed by the coordinator. Use a system-site-packages virtual environment rather than compiling GDAL on the 1 GiB server. The service requires GDAL 3.12.x and verifies NETCDF virtual IO, GTiff and MEM drivers. GDAL earlier than 3.13 needs NETCDF rather than HDF5 for GCOV georeferencing; [ASF's GCOV access guidance](https://nisar-docs.asf.alaska.edu/gdal/). The processor always uses NETCDF explicitly and fails closed when metadata/georeferencing are incomplete.

From `/opt/earthsignal` on the production host:

```sh
python3 -m venv --system-site-packages service/.venv
service/.venv/bin/pip install -r service/requirements-production-tests.txt
service/.venv/bin/python -m unittest discover -s service/tests -v
service/.venv/bin/python -m compileall -q service -x 'service/.venv'
```

`requirements-production-science.txt` records the apt science versions; it is an inventory, not a request to rebuild GDAL with pip. `requirements.txt` pins FastAPI 0.118.0, uvicorn 0.38.0 and tested transport dependencies. Production tests add pinned httpx via `requirements-production-tests.txt`; serving needs only `requirements.txt`. `requirements-local-lock.txt` records the complete tested workstation environment. Local test science versions are recorded separately because this workstation supplies Python 3.12, not the deployed 3.14 runtime.

For numerical/queue/auth checks without libgdal:

```sh
python3.12 -m venv service/.venv
service/.venv/bin/pip install -r service/requirements-test.txt
service/.venv/bin/python -m unittest discover -s service/tests -v
```

These tests use analytical arrays and mocked transport for unit verification. They do not establish actual Earthdata authorization, GDAL remote-HDF5 interoperability, or an independently reproduced study. Actual processing requires the production runtime and authorized Earthdata account, and should be checked on a small real crop before activation.

## Authorization

Every science/API/artifact call requires `X-Earthsignal-User`, `X-Earthsignal-Timestamp` (Unix seconds), `X-Earthsignal-Nonce` (16–128 URL-safe characters), and `X-Earthsignal-Signature` (SHA256 HMAC hex). Canonical bytes are UTF-8:

```
METHOD\nPATH_AND_QUERY\nUSER\nTIMESTAMP\nNONCE\nSHA256(raw_body)
```

The final body digest is hexadecimal; there is no trailing newline. Sign the actual forwarded path and query, including percent encoding. A new nonce is required for each request, including retries; retry POST with the same owner-scoped `Idempotency-Key`. Timestamp tolerance is ±60 seconds. SQLite retains nonces beyond their validity window and rejects replay after restart. Gateway secret must have at least 32 bytes. No cookie or user-supplied unsigned identity is accepted. Credentials, signed URLs and raw GDAL/HTTP exceptions are never returned or logged.

Safe environment overrides: `EARTHSIGNAL_MAX_PIXELS` 1..1000000, `QUEUE_LIMIT` 1..8, `OWNER_OUTSTANDING` 1..2, `OWNER_DAILY` 1..5, `WALL_SECONDS` 1..1200, `TRANSFER_BYTES` 1..536870912, `STORAGE_BYTES` 100663297..1073741824, `RESERVE_BYTES` 3221225472..1099511627776, `EXPIRY_SECONDS` 1..604800, `LEASE_SECONDS` 5..60 (all names have the `EARTHSIGNAL_` prefix). Limits cannot increase beyond approved hard caps; the worker always processes one active job. API runs one uvicorn process with a concurrency/backlog bound of 16.

Queue defaults: 8 queued; 2 outstanding per owner; 5 submissions per rolling 24 hours. At most one running job, atomic FIFO claim, WAL durable state, 60-second heartbeats/leases, 20-minute monotonic wall-clock bound. Ordered source IDs+bbox+algorithm identify a cache entry; another owner receives a separate job and artifact directory, never ownership of the original. Cache copies require storage capacity. Prepared successful studies are visible to all authenticated collaborators and pinned, but cancellation remains owner-only. Unpinned completed/failed jobs expire after seven days. Cancelled jobs retain a status history.

## Science and limits

Before and after must have distinct chronological dates and the same track/frame/direction/observation mode/release/provisional collection. ASF discovery is exact-ID lookup, not a URL supplied by a client. All HTTPS asset and redirect destinations use exact official allowlists. Range transport refuses non-206/full-file responses, unlimited reads, oversized ranges, changing ETags/lengths and unsafe redirects. One 512 MiB budget covers both files and ancillary metadata. No full-granule fallback or automatic auth-failure retries occurs.

Native grids require matching CRS/resolution and integer-aligned origin. Crops use common native cells, at most 1,000,000 pixels, with positive finite gamma0 and verified valid-subswath mask intersection. No scientific resampling or smoothing is used. The difference is `10*log10(after/before)`. Statistics and area refer to native common-valid cells. PNG display alone is warped to Web Mercator; before/after share a stretch, difference is symmetric, and excluded pixels have a separate overlay. Manifest hashes identify the cropped source arrays/masks/metadata, not downloaded full granules. The producer's [GCOV schema1.5 specification](https://github.com/isce-framework/isce3/blob/v0.25.13/python/packages/nisar/products/XML/L2/nisar_L2_GCOV.xml) documents the valid-samples subswath mask: positive subswath IDs included, zero and fill255 excluded; this is not a layover/shadow mask.

Algorithm `gcov-hhhh-v3` supports verified mask schemas1.5.0 and1.6.0 only. Both require `inputDataExceptionMask`. Schema1.5 has a uint8 anomaly map without a fill attribute: code0 retained, code2 (sample slip) excluded, unknown codes rejected. [Schema1.6](https://github.com/isce-framework/isce3/blob/127452609bb9b3bdf3f7a2bf1cdf49c493b49441/python/packages/nisar/products/XML/L2/nisar_L2_GCOV.xml) has a uint16 map with fill65535 and channel focus bits: require HHbit256, no low-byte anomaly, and exclude fill. The processor validates type, shape, projection and attributes against the selected schema before reading crop values. Receive-only flags, when supplied, must be false. Extracted-input hashes include the versioned quality map canonicalized to uint16. A bounded live metadata probe confirmed the actual June26 LakeMead product uses schema1.5 and the documented uint8 anomaly definition; this is metadata evidence, not a completed comparison.

Worker results are staged, validated against the shared manifest, fsynced and renamed on the same filesystem before a completed DB state is committed. Partial outputs never appear in API results. Restart marks interrupted jobs failed and removes their staging/orphan publication. The worker lock prevents a second process from resetting active work. One-second polling terminates the entire subprocess group on cancellation/time/storage limits. The root directory must have 3 GiB free reserve; summed staging/results stay within a 1 GiB budget checked at admission and during work. Each job reserves 96 MiB before claim; its isolated process has an 8 MiB hard per-file limit and publication accepts only the nine bounded artifacts plus two small IPC files. A single worker and bounded artifact set keep managed staging/results below the 1 GiB ceiling. A filesystem quota provides additional enforcement against unexpected external writes; storage monitoring does not constrain unrelated processes. No automatic deletion outside this service's managed staging/results occurs.

## Deployed service

Coordinator provisions dedicated `earthsignal` user/group; immutable code at `/opt/earthsignal/service`, writable state `/var/lib/earthsignal` mode 0700, config `/etc/earthsignal/service.env` mode 0640 root:earthsignal, and Earthdata `/etc/earthsignal/earthdata.netrc` mode **0600 earthsignal:earthsignal**. No credentials are included in this repository. EARTHSIGNAL_GATEWAY_SECRET must match the gateway secret; coordinator owns provisioning.

The coordinator installed the slice/API/worker units under `/etc/systemd/system/`; both services are enabled and running. The combined slice has **MemoryMax=384M**, **MemorySwapMax=0**, **CPUQuota=50%** and TasksMax=32. API listens on **127.0.0.1:8030**. Worker and API share the slice rather than each claiming384MiB. nginx serves `https://nasa.r8volt.com` with a Let's Encrypt certificate, HTTP redirect, Certbot timer and nginx renewal hook. Existing services were preserved. Public signed GET returns200 with the canonical schema; anonymous API returns401, replay/tampering returns401. The gateway identifies itself as `Earthsignal-Gateway/1.0`; Cloudflare configuration was left to the user. Earthdata netrc is configured server-side with the prescribed owner and0600 permissions; no credentials are included in source or manifests. This deployment was coordinator-operated; the service writer made no remote changes.

## Prepared actual study

With the worker running and Earthdata readiness available, select only an existing Lake Mead or Tehran region and an explicit small bbox:

```sh
service/.venv/bin/python -m service.prepare_study --region lake-mead --bbox -114.75 36.05 -114.74 36.06 --owner PREPARED_OWNER_ID
```

The CLI queries at most 24 public GCOV candidates, resolves exact IDs, and considers at most three compatible chronological pairs. It writes a selection rationale under `/var/lib/earthsignal/selection` **before** each enqueue, retains science incompatibility/mask/empty-overlap rejection reasons, and deliberately tries the next bounded candidate only for those science failures. Earthdata auth/configuration, network, transfer, runtime or storage gates stop immediately. Publication attaches selection rationale and prior rejection reasons to the manifest sourceMetadata; only successful nonempty science verification permits pinning. The region label does not alter the bbox. Provisional collection is verified against exact ASF catalog plus the official archive directory; the HDF5 granule ID, nominal processing type and release must agree. No HDF5 maturity field is invented: PR denotes nominal production, and maturity authority remains the catalog/archive. Discovery incompatibility, missing credentials, unknown mask or failed processing produces no prepared result. Re-running an identical request reuses the persisted rationale and owner idempotency record; failed requests require a new deliberate selection/job. Independently reproduce the actual crop/artifacts and compare native counts/statistics/hashes before reporting the study verified. That real-data acceptance remains coordinator-owned.
