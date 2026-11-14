# Contributing to Earthsignal

Earthsignal is a private, proprietary repository. All rights are reserved by the repository owner. This document describes internal development workflows, quality standards, and verification guidelines for collaborators. No public license grant or open-source contribution license is created or implied.

---

## Development Environment Setup

### Prerequisites

- **Node.js**: Version `>= 22.13.0` (Native Node runtime, ECMAScript modules enabled).
- **npm**: Standard bundled package manager.
- **Python**: Version `3.12+` for workstation test execution; Python `3.14.4` with system GDAL `3.12.2` for production science runtime.
- **SQLite**: Built-in `node:sqlite` in Node 22+ and Python standard library `sqlite3`.

### Workstation Installation

1. Clone the repository to your local workspace:
   ```sh
   git clone <repo-url> earthsignal
   cd earthsignal
   ```
   *Note: Always use portable relative or repository-root paths in code and documentation; never commit user-specific absolute filesystem paths.*

2. Install Node dependencies:
   ```sh
   npm ci
   ```

3. (Optional) Set up Python test virtual environment for service verification:
   ```sh
   python3 -m venv service/.venv
   service/.venv/bin/pip install -r service/requirements-test.txt
   ```

---

## Verification & Quality Gates

Run checks appropriate to your change before submitting a pull request. The baseline lint command has pre-existing findings; report them separately from regressions.

### Frontend & Gateway Suite
- **TypeScript Typecheck**:
  ```sh
  npm run typecheck
  ```
- **Linter**:
  ```sh
  npm run lint
  ```
- **Node Test Suite**:
  ```sh
  npm test
  ```
  Runs tests in `tests/*.test.ts` verifying catalog contracts, radar gateway HMAC signing, and science workspace state.
- **Production Build**:
  ```sh
  npm run build
  ```

### Science Service Suite
- **Unit & Mocked Science Tests** (Runs on standard workstations without native libgdal):
  ```sh
  service/.venv/bin/python -m unittest discover -s service/tests -v
  ```
- **Host Integration Suite** (Requires system GDAL 3.12.x with NETCDF virtual IO):
  On hosts with native GDAL installed, the native-capable suite verifies bounded transport, numerical calculations and exported masks. Test counts change as the suite grows; report the actual summary and skips from your run. Actual archive streaming is checked separately on the production GDAL3.12 runtime. Avoid claiming passing native GDAL tests on workstations lacking libgdal. [CI](.github/workflows/ci.yml) runs frontend/gateway, Python 3.12 and Ubuntu native-GDAL jobs; that runner is distinct from the production runtime.

---

## Development & Scientific Standards

1. **Documentation Integrity & Real Data**:
   - The application displays verified real data. Do not invent synthetic science observations or bypass catalog validation.
   - Do not claim scientific reproduction has passed without verified coordinator acceptance.
2. **Security & Redaction**:
   - **Never commit secrets, tokens, or credentials.**
   - Redact all session cookies, passwords, Earthdata `.netrc` contents, and `EARTHSIGNAL_GATEWAY_SECRET` keys from commit logs, issue discussions, and PR descriptions.
3. **Architecture Boundaries**:
   - The frontend communicates with the science service exclusively via the HMAC-authenticated loopback gateway. Never expose raw backend exceptions or unsigned endpoints to the browser.
   - Keep source processing and native-raster publication in the science service. Browser analytics and presentation calculations must preserve quantities, masks, support and provenance; keep their logic independently testable.

---

## Submitting Pull Requests

1. Create a focused feature or bugfix branch.
2. Ensure all relevant test suites pass locally.
3. Complete the pull request template checks.
4. Keep PR descriptions focused on implementation evidence and verified test results.

## Choose the right contribution path

| You found… | Start with… |
|---|---|
| A broken control, processing error or export problem | [Bug report](https://github.com/meowtappeparlechat/earthsignal/issues/new?template=01-bug-report.yml) with reproduction steps and environment. |
| A suspicious value, comparison, forecast or explanation | [Scientific discrepancy](https://github.com/meowtappeparlechat/earthsignal/issues/new?template=02-scientific-discrepancy.yml) with the exact claim, quantity, source/version, dates/support and reference or counterexample. |
| A workflow improvement or new scientific method | [Feature/research proposal](https://github.com/meowtappeparlechat/earthsignal/issues/new?template=03-feature-request.yml) with the decision it helps and a falsifiable acceptance check. |
| A vulnerability or credential exposure | Follow [private security reporting](SECURITY.md). |

Issue forms guide the report; they are not immutable evidence records or an access-control boundary. [GitHub's form schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema) documents required-field enforcement for public repositories; do not assume the private repository enforces every field. Link original manifests and record missing information explicitly.

For documentation-only changes, check relative links, image captions and source claims; application builds are needed when code or build inputs change. For scientific changes, include the measured quantity, actual support, quality masks, independent reference/baseline and uncertainty. Report limitations and inherited failures separately. See the [docs hub](docs/index.md) and [citation guidance](CITATION.md).
