# API & Wire Contract Specification

The Earthsignal processing service API is a loopback-only HTTP backend accessed through the authenticated frontend gateway. All API communications follow the strict wire schemas defined in `lib/radar-contract.ts` (Version 1.0).

---

## 1. Gateway Authentication Protocol

Every request sent from the frontend to the backend science service (except `GET /health`) must include four cryptographic gateway headers:

| Header Name | Type | Description |
| :--- | :--- | :--- |
| `X-Earthsignal-User` | `string` | Authenticated collaborator identifier (1–256 printable ASCII characters). |
| `X-Earthsignal-Timestamp` | `string` | Unix epoch time in seconds (`/^[0-9]{1,12}$/`). Clock drift tolerance: $\pm 60$ seconds. |
| `X-Earthsignal-Nonce` | `string` | Unique random string (16–128 URL-safe characters: `/^[A-Za-z0-9_-]{16,128}$/`). |
| `X-Earthsignal-Signature` | `string` | 64-character lowercase hexadecimal HMAC-SHA256 digest. |
| `Idempotency-Key` | `string` | (Required on `POST /api/change-jobs`) Browser gateway:8–100 letters/digits/underscore/hyphen; backend operator protocol:1–128 printable ASCII characters. |

### Signature Construction
The signature is computed over the canonical string:
```
METHOD\nPATH_AND_QUERY\nUSER\nTIMESTAMP\nNONCE\nSHA256(raw_body)
```

- `METHOD`: Uppercase HTTP method (e.g., `GET`, `POST`, `DELETE`).
- `PATH_AND_QUERY`: The exact forwarded path and query string including percent encoding (e.g., `/api/change-jobs`).
- `USER`: Verbatim value of `X-Earthsignal-User`.
- `TIMESTAMP`: Verbatim Unix epoch string from `X-Earthsignal-Timestamp`.
- `NONCE`: Verbatim nonce from `X-Earthsignal-Nonce`.
- `SHA256(raw_body)`: Lowercase hexadecimal SHA-256 digest of the raw request body bytes. For an empty body, this is the hash of empty bytes (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).

```typescript
// Example signing implementation
const canonical = [method.toUpperCase(), pathAndQuery, user, timestamp, nonce, bodySha256Hex].join("\n");
const signatureHex = hmacSha256(gatewaySecret, canonical);
```

---

## 2. API Endpoints

### `GET /health`
Liveness check. Does not require authentication or gateway headers.

**Response (200 OK)**:
```json
{
  "status": "ok",
  "schemaVersion": "1.0"
}
```

---

### `GET /api/change-jobs`
Retrieves a list of jobs visible to the authenticated user (their own submissions plus any pinned prepared studies), along with current science service capabilities.

**Response (200 OK)**: `{schemaVersion:"1.0", jobs: ChangeJob[], capability:{ready,message,maxPixels}}`. See the checked-in Zod contract for the full result shape; actual manifests retain acquisition dates, native grid, coverage, metadata, hashes and selection rationale.

---

### `POST /api/change-jobs`
Enqueues a new radar change comparison. Requires an `Idempotency-Key` header. If the key already exists for the owner with identical parameters, the existing job is returned immediately.

**Request Headers**:
- `Idempotency-Key`: `string` (8–100 letters/digits/underscore/hyphen)
- `Content-Type`: `application/json`

**Request Body (`changeRequestSchema`)**:
```json
{
  "beforeId": "NISAR_L2_PR_GCOV_024_005_A_020_4005_DHDH_A_20260626T125220_20260626T125255_P05023_N_F_J_001",
  "afterId": "NISAR_L2_PR_GCOV_032_005_A_020_4005_DHDH_A_20260930T125217_20260930T125252_P05023_N_F_J_001",
  "bbox": [-114.75, 36.05, -114.74, 36.06]
}
```

**Response (202 Accepted)**:
Returns the newly created job object in state `"queued"`.

---

### `GET /api/change-jobs/{id}`
Fetches status and results for a single job by its ID. Users may only view their own jobs or pinned prepared jobs.

**Response (200 OK)**:
Returns the complete `changeJobSchema` object.

---

### `POST /api/change-jobs/{id}/cancel`
Cancels an active or queued job. Only the owner who submitted the job may cancel it.

**Response (200 OK)**:
Queued jobs become cancelled immediately; running jobs retain their current state with a cancellation-request phase until the worker terminates them.

---

### `GET /api/change-jobs/{id}/artifacts/{name}`
Retrieves a published artifact file from a completed job.

**Allowed Artifact Names**:
- `manifest.json` (application/json)
- `before.png`, `after.png`, `difference.png`, `excluded.png` (image/png)
- `before.tif`, `after.tif`, `difference.tif`, `validity.tif` (image/tiff)

**Response Headers**:
- `Content-Type`: `image/png`, `image/tiff`, or `application/json`
- `Cache-Control`: `private, no-store`
- `X-Content-Type-Options`: `nosniff`

---

## 3. Error Response Format

Errors are returned with structured JSON payloads:
```json
{
  "error": {
    "code": "owner_limit",
    "message": "Outstanding job limit: 2"
  }
}
```

### Common Error Codes

| Status | Code | Cause |
| :--- | :--- | :--- |
| `400` | `invalid_request` | Malformed parameters, identical before/after IDs, or invalid bbox coordinates. |
| `400` | `idempotency_required` | Missing or invalid `Idempotency-Key` header. |
| `401` | `unauthorized` | Missing, malformed, or invalid gateway headers/signature. |
| `401` | `stale_signature` | Request timestamp difference exceeds $\pm 60$ seconds. |
| `401` | `replay` | Nonce already recorded and used. |
| `404` | `not_found` | Job ID does not exist, does not belong to owner, or has expired. |
| `409` | `idempotency_conflict` | Idempotency key already used with different request parameters. |
| `413` | `body_too_large` | Request body exceeds 16 KB. |
| `429` | `owner_limit` | Owner already has maximum allowed active jobs (default: 2). |
| `429` | `daily_limit` | Owner reached 24-hour rolling submission limit (default: 5). |
| `429` | `queue_full` | System queue limit reached (default: 8). |
| `503` | `processing_unavailable`| Science runtime or Earthdata credentials unavailable. |
| `503` | `storage_limit` | Server disk free space below 3 GiB reserve or 1 GiB storage budget. |

The browser authenticates using `/api/auth/login`, `/api/auth/session` and `/api/auth/logout`. Login/logout and job mutations require the exact configured Origin. Auth errors use `{error:string}`; gateway errors use `{error:string,code:string}`; science errors use `{error:{code,message}}`. Never send the HMAC secret to the browser.
# Native analytical endpoints

`POST /api/change-jobs/{id}/analysis` uses the same collaborator session, exact-Origin protection and signed upstream identity as processing jobs. The native session guard denies a POST with a missing or wrong Origin as401 before gateway validation; direct gateway validation returns403. Both paths deny the request before scientific processing. The job must be visible and completed. Body: optional `polygon` (one simple closed GeoJSON exterior ring, at most 65 coordinates), `point` (`[longitude,latitude]`), `transect` (two WGS84 endpoints), and `thresholdDb` (0.1–30; default3). Omitted/null polygon selects the full native crop. Response follows `lib/analysis-contract.ts`: region summaries, common-population histograms, optional point/transect samples, grounded insights and provenance. No-data statistics are null. Up to128 profile samples, at most1,000,000 native pixels, one concurrent analytical read; busy requests receive429. No remote science download is triggered.

`GET /api/change-jobs/{id}/annotations` lists the signed owner's annotations. `POST` appends `{label,note,polygon?}`; note1–1000 characters, at most100 entries per owner/job. Allowed labels: `water-change`, `vegetation-change`, `surface-change`, `artifact`, `uncertain`. Entries have append-sequence versions and `unverified-human-annotation` status. Access to a shared prepared study does not expose another owner's notes. Annotation rows follow job expiry through their foreign key.

`GET /data/water-history.json` serves a reproducibly generated public historical gauge dataset with pinned source identity, missing dates and observed daily values. Client-side temporal analysis uses `lib/water-history.ts`; exports preserve the historical cutoff, model version, validation predictions and source hash. No additional credentials or paid model API are required.

## Decision observatory contracts (version 1.0)

The existing change-job/analytics/annotations interfaces stay compatible. New contracts live in `lib/observatory-contract.ts` and equivalent `service/assessment_validation.py`. Every gateway request requires a verified collaborator; science independently verifies HMAC and owner scope. Idempotency applies to collection POSTs and is owner-specific across job kinds.

| Web interface | Behavior |
| --- | --- |
| GET `/api/sources` | Source capabilities plus independently enabled assessment domains/scenarios. Discovery access is not measurement availability. |
| POST `/api/assessments` | Versioned domain/question, bounded exact Polygon/MultiPolygon with holes, dates/options; requires `Idempotency-Key`; returns 202. |
| GET `/api/assessments`, `/:id` | Owner history/status/result; results can be partial or unavailable with documented missing evidence. |
| POST `/api/assessments/:id/cancel` | Cancel queued/running job. |
| GET `/api/assessments/:id/brief` | Deterministic claim-linked brief. |
| GET `/api/assessments/:id/artifacts/:name` | Only manifest-listed verified exports; private/no-store. |
| POST `/api/assessments/:id/snapshot` | Immutable compact evidence/brief manifest, separately owner-scoped; does not renew raster expiry. |
| GET `/api/assessment-snapshots`, `/:id` | Creator's saved compact snapshots. |
| POST `/api/scenarios`; GET `/api/scenarios`, `/:id` | Parent must be completed, unexpired and owned; bounded thresholds/footprints/options with explicit assumptions. |
| POST `/api/scenarios/:id/cancel`; GET `/:id/artifacts/:name` | Shared queue/cancellation and protected exports. |
| GET `/api/assistant` | Configuration readiness and canonical public explanation registry; not a provider-capacity guarantee. |
| POST `/api/assistant` | `schemaVersion`, `publicAIOptIn:true`, public question, approved evidence IDs and exact `previewHash`; strict public-only outbound payload. |
| GET `/api/places?q=public-name` | Authenticated public place lookup, bounded/cached/manual queries; no autocomplete or private geometry transmission. |

Assessment job states remain queued/running/failed/cancelled/completed. Completed means atomic technical publication; scientific outcome is separately complete/partial/unavailable. Private inputs, notes and result artifacts cannot be submitted as authoritative evidence or as assistant context.

Optional assessment `rasters` lists at most two quantities with four required layers, native grids, per-date/common coverage, exact masks and hashes. PNGs alone are reprojected for display; analytical differences use the recorded common grid/population. Scenario `outputs` retain quantities/units and explicit user assumptions; unknown costs/effects are null and rankings require weights. ForecastResult is a versioned contract and research evaluator, not an activated current gauge forecast endpoint.

### Confirmed photo-location discovery

`GET /api/scenes` retains its existing preset `region`, `product`, `start` and
`end` parameters. Optional `point=longitude,latitude` overrides the region's
spatial point, using validated decimal WGS84 degrees. It does not accept an image
or EXIF payload. Custom point responses are private/no-store; at most24 ASF
records are returned. A successful catalog response establishes record
availability, not native-analysis compatibility or complete geographic coverage.
See [photo workflow](photo-location.md) for explicit confirmation and privacy.
