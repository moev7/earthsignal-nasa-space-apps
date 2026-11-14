# Operations, Maintenance & Disaster Recovery

This guide covers routine operational maintenance, collaborator administration, secret rotation, backups, and disaster recovery procedures for Earthsignal Observatory.

---

## 1. Collaborator Administration

User accounts for Earthsignal are managed locally via the collaborator administrative CLI:

```sh
# On the server, run as the web service account; prompt hides the password.
sudo -u earthsignal-web env EARTHSIGNAL_AUTH_DB=/var/lib/earthsignal-web/auth.sqlite3 \
  node /opt/earthsignal/admin/scripts/collaborator.mjs provision username
# Substitute reset username, disable username or list for the command.
# --stdin accepts a password-manager pipe without placing the password in argv.
```

The DB path is required and has no fallback default. Passwords require15 characters. Never type passwords inside shell commands such as echo; those enter shell history. Locally, set an absolute private DB path then use `npm run collaborator -- provision username`. The CLI does not implement --help; see its usage comments.

### Account Policy & Security Rules
- **No Public Signup**: Collaborators are provisioned directly by system operators.
- **Password Strength**: Minimum 15 characters required. Passwords are derived with scrypt ($N=16384, r=8, p=5$).
- **Independent Passwords**: Keep app passwords separate from SSH/Earthdata. Reset creates a new salt/hash; reuse is not detected.
- **Session Invalidation**: Resetting a password immediately purges all active sessions for that user across devices (`DELETE FROM sessions WHERE user_id = ?`).

### Password Reset Procedure
When an operator resets a collaborator password:
1. Operator runs the collaborator command (or coordinator reconciliation script).
2. The user's row in `/var/lib/earthsignal-web/auth.sqlite3` is updated with a freshly generated salt and scrypt hash.
3. All existing session tokens in the `sessions` table are deleted atomically.
4. The user is issued a temporary or new random passphrase through a secure out-of-band channel.

---

## 2. Key & Credential Rotation

### Gateway Secret Rotation (`EARTHSIGNAL_GATEWAY_SECRET`)
The shared secret links the web gateway and science backend. It must contain at least 32 bytes (64 hexadecimal characters recommended).

1. Generate a new cryptographic key:
   ```sh
   openssl rand -hex 32
   ```
2. Update `/etc/earthsignal/service.env`:
   ```env
   EARTHSIGNAL_GATEWAY_SECRET=<NEW_HEX_KEY>
   ```
3. Update `/etc/earthsignal/web.env`:
   ```env
   EARTHSIGNAL_GATEWAY_SECRET=<NEW_HEX_KEY>
   ```
4. Restart both services synchronously to minimize transient signature rejections:
   ```sh
   sudo systemctl restart earthsignal-api.service earthsignal-web.service
   ```
5. Verify health:
   ```sh
   curl -s http://127.0.0.1:8030/health
   ```

### Earthdata Credentials Rotation (`/etc/earthsignal/earthdata.netrc`)
If NASA Earthdata credentials change:
1. Edit `/etc/earthsignal/earthdata.netrc`:
   ```netrc
   machine urs.earthdata.nasa.gov login <NEW_USER> password <NEW_PASSWORD>
   ```
2. Confirm permissions remain strictly `0600`:
   ```sh
   sudo chown earthsignal:earthsignal /etc/earthsignal/earthdata.netrc
   sudo chmod 0600 /etc/earthsignal/earthdata.netrc
   ```
3. The science worker re-reads `.netrc` per range request session; restarting `earthsignal-worker.service` is recommended but not strictly required.

---

## 3. Database Maintenance & Backups

Both SQLite databases (`jobs.sqlite3` and `auth.sqlite3`) operate in WAL mode. Never perform raw file copies while services are actively writing.

### Online Atomic Backups
Use SQLite's online backup API or command line tool to create consistent snapshot files:

```sh
# Backup Collaborator Authentication DB
sudo install -d -m 0700 -o earthsignal-web -g earthsignal-web /var/backups/earthsignal-web
sudo -u earthsignal-web sqlite3 /var/lib/earthsignal-web/auth.sqlite3 \
  ".backup '/var/backups/earthsignal-web/auth-$(date +%Y%m%d).sqlite3'"

# Backup Radar Jobs DB
sudo install -d -m 0700 -o earthsignal -g earthsignal /var/backups/earthsignal-science
sudo -u earthsignal sqlite3 /var/lib/earthsignal/jobs.sqlite3 \
  ".backup '/var/backups/earthsignal-science/jobs-$(date +%Y%m%d).sqlite3'"
```

### WAL Checkpoints
Under normal operations, SQLite automatically manages WAL checkpoints. If the `-wal` file grows large, an operator can manually checkpoint it:

```sh
sudo -u earthsignal sqlite3 /var/lib/earthsignal/jobs.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"
sudo -u earthsignal-web sqlite3 /var/lib/earthsignal-web/auth.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"
```

---

## 4. Resource Allocation & Result Retention

The system enforces automated pruning and quota controls:

| Parameter | Value | Enforcement Mechanism |
| :--- | :--- | :--- |
| **Queue Limit** | 8 jobs | Rejects admissions with `429 queue_full`. |
| **Owner Outstanding** | 2 jobs | Rejects submissions with `429 owner_limit`. |
| **Owner Daily Limit** | 5 jobs / 24h | Rejects submissions with `429 daily_limit`. |
| **Processing Wall Time**| 1200 seconds | Worker kills child process group on expiration. |
| **Transfer Limit** | 512 MiB | Aborts range reading if combined download exceeds budget. |
| **Managed Storage** | 1 GiB | Fails jobs before claim or during execution if results/staging exceed budget. |
| **Disk Reserve** | 3 GiB | Requires at least 3 GiB free space on root filesystem before admitting work. |
| **Unpinned Retention** | 7 days | Jobs without `prepared=1` expire after 604,800 seconds and are purged. |
| **Pinned Studies** | Indefinite | Successful prepared studies (`prepared=1`) are preserved permanently. |

### Automated Cleanup Lifecycle
Every time the worker completes a job cycle (`run_one`):
1. `store.cleanup()` deletes expired jobs where `prepared = 0 AND expires <= now`.
2. Storage directories in `/var/lib/earthsignal/staging` and `/var/lib/earthsignal/results` that no longer correspond to active or completed jobs are purged via `shutil.rmtree`.
3. Interrupted jobs from previous crashes are transitioned to `failed` (`code: interrupted`), and their staging directories are cleared.

---

## 5. Rollback Procedures

Web releases live under `/opt/earthsignal/web/releases`; the service follows the `current` symlink. Choose an existing verified previous release, then activate it atomically:

```sh
cd /opt/earthsignal/web
previous=releases/REPLACE_WITH_VERIFIED_PREVIOUS_RELEASE
# Confirm the chosen release exists before switching.
test -f "$previous/server.js"
ln -s "$previous" current.rollback
mv -Tf current.rollback current
systemctl restart earthsignal-web.service
curl --fail --silent http://127.0.0.1:3040/api/auth/session
```

The deployment script performs this rollback automatically when its local health check fails. Keep the current and previous releases until browser/API checks pass. Matching operator CLI/auth-source changes and science-service deployments require their own verified rollback; never overwrite either SQLite database or the credential files while reverting code.

Inspect relevant service logs after recovery:

```sh
journalctl -u earthsignal-web -n 50 --no-pager
journalctl -u earthsignal-worker -n 50 --no-pager
```

## Incremental observatory activation

Set `EARTHSIGNAL_ASSESSMENT_DOMAINS=water,fire,ecology,urban` in the science environment to admit new jobs for selected domains; omit any domain to suspend its new submissions. `EARTHSIGNAL_SCENARIOS_ENABLED=true` independently enables scenarios. Omitted flags default off in production environment loading. History, cancellation, existing radar work and protected completed downloads remain available when submissions are disabled. Migration adds a default-radar kind column and snapshot table without rewriting original measurements.

The optional Gemini connection belongs only in `/etc/earthsignal/web.env`: `EARTHSIGNAL_GEMINI_API_KEY`, `EARTHSIGNAL_GEMINI_FREE_TIER=true`, `EARTHSIGNAL_ASSISTANT_DB=/var/lib/earthsignal-web/assistant.sqlite3`. The quota file is private and persistent: one concurrent call, at most5 per owner/20 globally in24h,30sec timeout, bounded JSON and no automatic quota retries or paid fallback. Configuration readiness does not guarantee provider availability. Set FREE_TIER=false to disable calls without losing reviewed explanations. Never put the key in browser variables, manifests or repository history.

Named public-place search obeys one global concurrent request/one-second admission, cache and identifying user agent. `EARTHSIGNAL_PLACE_SEARCH_URL` allows the operator to select a supported HTTPS Nominatim endpoint without a client update; do not send private addresses/precise private areas.

Before science code activation: snapshot the jobs database using SQLite backup, record the9 retained radar-artifact hashes, stop/drain the worker, back up code separately from its venv, install tested source and restart. Keep an old source tree and web release for code rollback. Do not restore a stale database over newly submitted jobs; additive schema is compatible with old radar rows. Check native exports, anonymous/cross-owner denial and resource limits before incrementally enabling domains. Frozen pilots, non-US transfer checks and12 real formative user sessions remain separate acceptance gates; automated reviews do not substitute.

#### Rollback compatibility after assessment activation

Exercise full old-code rollback before admitting assessment/scenario jobs. The old service does not understand the new job kinds. Once such rows exist, retain the compatible new service and disable assessment/scenario admission flags when rolling the web UI back. Keep additive database columns and preserve all newly created rows; never overwrite the live database with a stale backup. Service-owned backups contain private job metadata and must stay operator-only.

#### Public assistant question boundary

The assistant accepts only exact questions from the versioned reviewed public registry. Arbitrary typed text is rejected server-side even with opt-in and a matching preview hash, and cannot reach the model transport. This prevents inline private coordinates, identities or credentials from being transmitted as a question. Reviewed question selection, payload preview and explicit consent remain required. Custom/private-result interpretation stays in local deterministic briefs. Public explanation citations point to public sources or the public Earthsignal evidence guide, never private GitHub documentation.
