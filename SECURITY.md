# Security Policy

## Supported Versions

Only the current production branch and actively deployed release of Earthsignal receive security updates.

| Branch / Release | Supported |
| :--- | :--- |
| `main` (current production) | :white_check_mark: |
| Older commits / prototypes | :x: |

---

## Reporting a Vulnerability

If you discover a security vulnerability or accidental credential exposure in Earthsignal:

1. **Do not create a public GitHub issue, discussion, or pull request.**
2. Report the vulnerability **privately and directly to the repository owner / project coordinator** through private administrative channels.
3. Include detailed reproduction steps, affected files, and potential impact.
4. Allow sufficient time for remediation before discussing any findings.

---

## Security Architecture & Safeguards

Earthsignal enforces strict technical controls across authentication, network boundaries, and scientific execution:

### 1. Collaborator Authentication & Storage
- **No Public Registration**: All collaborator accounts are provisioned exclusively by authorized operators via local CLI administration (`scripts/collaborator.mjs`). Public signup is disabled by design.
- **Password KDF**: Passwords are hashed using scrypt adhering to OWASP guidelines:
  - Parameters: $N = 16384$ ($2^{14}$), $r = 8$, $p = 5$ (16 MiB memory footprint), 64-byte key.
  - Constant-time verification (`crypto.timingSafeEqual`) on both valid and invalid attempts to prevent timing attacks.
  - Minimum password length of 15 characters required. Use separate passwords from SSH/Earthdata; password reuse is not detected.
- **Opaque Sessions**:
  - Session tokens are 32-byte cryptographically secure random values (43 base64url characters).
  - Only the SHA-256 digest of the session token is stored in the local SQLite database (`/var/lib/earthsignal-web/auth.sqlite3`).
- **Cookie Hardening**:
  - In production, session cookies use the `__Host-earthsignal-session` prefix with attributes: `Path=/`, `HttpOnly`, `SameSite=Lax`, and `Secure`.
  - Absolute session expiration: 7 days; idle session expiration: 24 hours.

### 2. Request Integrity & CSRF Protection
- **Exact-Origin Enforcement**: State-changing authentication and gateway requests validate the HTTP `Origin` header against `EARTHSIGNAL_PUBLIC_ORIGIN` (configured as `https://nasa.r8volt.com`). Cross-origin requests are rejected immediately.
- **Rate Limiting**:
  - Global login attempt rate limit: 30 attempts per 60 seconds.
  - Per-username login attempt limit: 5 attempts per 15 minutes across 256 hashed buckets.
  - Scrypt derivation concurrency queue: one active hash and at most4 waiting operations to protect server CPU/memory.
  - Request body limits: strictly capped at 4 KB with a 5-second streaming timeout.

### 3. Backend HMAC Gateway
- **Loopback Isolation**: The FastAPI science processing service binds strictly to loopback (`127.0.0.1:8030`). It rejects browser cookies and accepts only HMAC-SHA256 signed requests from the frontend gateway.
- **Signature Canonicalization**:
  ```
  METHOD\nPATH_AND_QUERY\nUSER\nTIMESTAMP\nNONCE\nSHA256(raw_body)
  ```
- **Replay Protection**:
  - Gateway timestamp tolerance is capped at $\pm 60$ seconds.
  - Nonces (16–128 characters) are recorded in SQLite and rejected on reuse, persisting across service restarts.
- **Shared Secret**:
  - `EARTHSIGNAL_GATEWAY_SECRET` requires at least 32 bytes and is never transmitted over untrusted networks or logged.

### 4. Credential & Data Redaction
- Earthdata download credentials reside in `/etc/earthsignal/earthdata.netrc` (mode `0600`, owned by `earthsignal:earthsignal`) and are never checked into git, emitted in error responses, or exposed to the frontend.
- When filing issue tickets or pull requests, **always redact all tokens, secrets, IP addresses, and session cookies**.
