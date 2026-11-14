# Meteomatics historical weather context

Meteomatics adds optional daily precipitation and mean air-temperature context
to assessments in the advanced workspace. Select **Meteomatics** under **Data
sources and advanced settings**. Other explicitly selected sources continue to
run normally. The default source selection does not call this credentialed API.

The adapter requests `source=ecmwf-era5` and labels the result as enhanced
downscaled ERA5 reanalysis estimates. These are model-based historical values
at one sampled location, not weather-station measurements, an average over the
selected area, or evidence that weather caused satellite-observed change.

## Dates and missing data

The first increment covers at most the latest 31 completed UTC days within the
requested period. Longer periods and current/future days are explicitly reported
as omitted. This source does not supply forecasts.

For each displayed date D, the API is queried at midnight D+1. The
`precip_24h:mm` and `t_mean_2m_24h:C` values represent the preceding 24 hours.
The exact sampled coordinate, source, retrieval time and response hash accompany
the saved evidence. Missing dates and provider reserved values stay missing;
they never become zero precipitation or zero temperature.

Historical data can arrive late or change. Cached responses have a finite
lifetime, including responses with missing values. A newly fetched revision
does not rewrite a previously saved assessment.

## Private configuration

The Python science service reads these server-only environment variables:

```dotenv
EARTHSIGNAL_METEOMATICS_USERNAME=<participant API username>
EARTHSIGNAL_METEOMATICS_PASSWORD=<participant API password>
EARTHSIGNAL_METEOMATICS_VALID_UNTIL=<UTC ISO timestamp>
```

Use the private science-service environment file described in
[deployment.md](deployment.md). Do not add these values to the web environment,
browser code, Git, source manifests, or exported results. The example deployment
file contains placeholders only. The local participant configuration is stored
in the Git-ignored `.earthsignal/meteomatics.env` with mode `0600`.

Missing, incomplete or expired configuration withholds this source and reports
the reason. Existing assessments and other providers remain usable. No API
retry, alternate model, paid fallback, or account change is attempted.

For a local science-service launch, load the private configuration into that
process's environment before using the existing service startup command:

```sh
set -a
. .earthsignal/meteomatics.env
set +a
```

The private file is not loaded by the web frontend. Production activation needs
the same variables provisioned in the private science-service configuration and
a reviewed service release; the local integration does not deploy itself.

## Request and storage controls

The app reserves a conservative maximum of 500 attempted calls per UTC day,
30 per rolling minute and one active call across processes sharing its data
root. Failed attempts consume allowance. Provider account limits and usage
outside Earthsignal still apply; a provider rejection stops the call.

The private normalized cache retains at most 32 responses for one hour, with
original response hashes and retrieval times. It stores neither credentials
nor the provider's account-identifying response field. The SQLite database is
capped at 512 KiB, with a conservative 2 MiB state/journal storage envelope.
Shared storage capacity and the existing disk reserve are checked before use.
Insufficient capacity withholds the optional source rather than relaxing limits.

Authenticated requests have a fixed HTTPS destination, reject redirects, share
the assessment's transfer/request/time budgets, and admit at most 256 KiB per
response. The existing credential-free transport remains unchanged.

## Provider references

- [Models and data sources](https://www.meteomatics.com/en/api/request/optional-parameters/data-source/)
- [Accumulated precipitation and right-aligned intervals](https://www.meteomatics.com/en/api/available-parameters/weather-parameter/precipitation/)
- [Temperature interval parameters](https://www.meteomatics.com/en/api/available-parameters/weather-parameter/temperature/)
- [Reserved missing values](https://www.meteomatics.com/en/api/response/reserved-values/)
- [JSON response structure](https://www.meteomatics.com/en/api/response/json/)

## Initial live compatibility check

On 14 November 2026, an authenticated direct request with explicit
`source=ecmwf-era5` returned HTTP 200 and JSON version 3.0 for both parameters at
Tehran (35.6892, 51.3890) and Lake Mead (36.05, -114.75). Each parameter/location
returned three finite daily endpoints, 2–4 June 2025 at 00:00 UTC, corresponding
to the displayed UTC days 1–3 June. This establishes API compatibility for
these small samples; it does not validate local weather accuracy or worldwide
coverage. Raw response SHA256:
`14cd1707b9c9bf987c03844c5a0711cb580ddcfc70b42330ef9330d39aa2d0c0`.

The implemented adapter was then checked with separate three-day calls for
each location, preserving the default 3 GiB disk reserve. Each produced two
series with three finite values, used one API request (567 and 565 transferred
bytes respectively), and reused the private cache with zero network requests.
Credentials were absent from serialized output and the direct-observation count
remained zero. Both resulting five-artifact assessments passed Python manifest
validation and the frontend TypeScript schema.

Independent review identified the misleading unavailable heading on context-only
results and inconsistent shared chart captions. The final integration reports
finite weather context as a partial result, keeps direct measurement support
withheld, and uses estimate labels in weather charts and source-value tables.

Validation: 66 focused Python tests passed, with one existing explicit live test
skipped; 39 relevant TypeScript tests and `tsc --noEmit` passed. Scoped ESLint
reported no errors and one pre-existing unused-import warning in the workspace.
The design scan reported only two existing palette advisories. Changed tracked
and untracked source files were checked for the participant credentials; none
contained them.

The last live repeat was withheld when free disk fell below the unchanged 3 GiB
reserve. Final partial-result formatting was verified by an offline replay of
the previously verified normalized live responses, then validated by both the
Python and TypeScript contracts. This replay made no API calls and did not
relax the live storage gate. Production activation was subsequently authorized
and verified separately, as recorded below.

Implementation used pooled Codex `gpt-6.1-sol`; the bounded independent review
used pooled Codex `gpt-6-luna`. Gemini's visible Argon High consultation informed
the temporal, point-support and cache checks. Its suggested `model=` syntax and
output-resolution assumption were rejected against the primary API contract.

The owned orchestration team records a metadata limitation: adding the reviewer
role advanced its revision after initial discovery/design and implementation.
Earlier receipts are therefore historical to its final revision, and the
coverage audit must not be interpreted as a fully ordered current-revision
workflow. Actual job acceptance, source checks and test receipts were retained;
no timestamps or contributions were fabricated to fill the gap.


## Production activation — 14 November 2026

Deployed to **https://nasa.r8volt.com** with web release
`20261114T080625Z-meteomatics-df3b2517` and science release
`meteomatics-20261114`. The release records its base commit and uncommitted
source status explicitly. This rollout includes the session's public spacing
fixes and historical-weather integration.

Only three existing runtime files changed (`config.py`, `observatory/engine.py`,
`observatory/sources.py`), plus the new `observatory/meteomatics.py`. The package
was pinned against the actual production inventory. Private participant settings
were added only to the science-service environment, with a root-only backup.
Existing limits and other service settings were retained.

- Production-runtime regression checks: 66 tests passed, one existing live opt-in
  test skipped; 13 Linux source-exchange/recovery checks passed.
- Independent deployment review: pooled Codex `gpt-6-luna`, no blocking findings.
- Atomic service activation rehearsed the previous source before final admission;
  no database was restored. The previous web release remains available.
- Real signed private assessment `936b170134e5439c8067b819bc3ecb94` completed with
  two three-day modeled series, partial outcome, Derived claims and direct
  measurement support withheld. Duplicate submission reused the same job;
  another owner received 404. Credentials were absent from its serialized result.
- An actual service-user adapter cache check made zero network requests and
  transferred zero bytes. The processing queue was empty after verification.
- Web, API and worker are active. The science slice remains 384 MiB and half a
  CPU; web remains 192 MiB and half a CPU, with zero swap for both.
- The retained prepared study and all five public dataset manifests match their
  pre-deployment hashes. Public story/workspace/session endpoints return 200;
  protected source/assessment endpoints return 401 anonymously.
- The new public story spacing stylesheet was retrieved through HTTPS and its
  SHA256 matched the built artifact.

Local operator receipts are in
`outputs/releases/meteomatics-20261114/`: `activation-result.json`,
`production-weather-check.json`, `production-final-check.json`,
`production-qa-fixtures.log` and `atomic-checks.log`. They contain no participant
credentials. No purchase, account change, resource-limit increase or unrelated
service change was made.

Final orchestration audit flags remained `delivery_without_independent_check`,
`historical_accepted`, `time_order_violation` and `workflow_incomplete`. These
metadata gaps are preserved explicitly. The actual accepted deployment-review
job is `544120152aa54dc49778f6b2845cfb48`; the production checks and pinned
activation receipts above remain the evidence for this rollout.
