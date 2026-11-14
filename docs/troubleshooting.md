# Troubleshooting & Diagnostics

This guide provides troubleshooting steps, diagnostic commands, and recovery procedures for common issues in Earthsignal Observatory.

---

## 1. Quick Diagnostics Commands

Check service status and recent journal logs:

```sh
# Check systemd slice and resource usage
systemctl status earthsignal.slice
systemctl status earthsignal-web.service

# View live service logs
journalctl -u earthsignal-api.service -f
journalctl -u earthsignal-worker.service -f
journalctl -u earthsignal-web.service -f

# Inspect database queue state directly
sudo -u earthsignal sqlite3 /var/lib/earthsignal/jobs.sqlite3 \
  "SELECT id, owner, state, phase, error, created FROM jobs ORDER BY created DESC LIMIT 5;"
```

---

## 2. Common Errors & Resolution

### HTTP 401 Unauthorized / Signature Errors

| Error Code | Reason | Resolution |
| :--- | :--- | :--- |
| `stale_signature` | Request timestamp differs by $>60$ seconds from the server clock. | Synchronize system clock using `chrony` or `timedatectl set-ntp on`. |
| `replay` | Gateway signature nonce was already recorded in `jobs.sqlite3`. | Ensure the client/gateway generates a unique random nonce (16–128 characters) per request. |
| `unauthorized` | HMAC signature mismatch or secret mismatch. | Verify `EARTHSIGNAL_GATEWAY_SECRET` in `/etc/earthsignal/service.env` matches `/etc/earthsignal/web.env` character-for-character. |

---

### HTTP 503 Processing Unavailable / Gates

| Error Code | Reason | Resolution |
| :--- | :--- | :--- |
| `processing_unavailable` | Science runtime dependencies or Earthdata credentials missing. | 1. Check `/etc/earthsignal/earthdata.netrc` exists and is readable by `earthsignal` (mode `0600`).<br>2. Confirm GDAL 3.12.x has NETCDF virtual IO enabled (`gdalinfo --format netCDF`). |
| `storage_limit` | Server disk free space is below the 3 GiB reserve or managed storage exceeds 1 GiB. | 1. Check filesystem disk space: `df -h /var/lib/earthsignal`.<br>2. Clean up unpinned/orphaned data if needed or expand disk volume. |
| `gateway_unavailable` | `EARTHSIGNAL_GATEWAY_SECRET` is shorter than 32 bytes. | Provision a secure random secret of at least 32 bytes (64 hex characters recommended). |

---

### HTTP 429 Rate & Quota Limits

| Error Code | Cause | Resolution |
| :--- | :--- | :--- |
| `owner_limit` | The user already has 2 active (queued/running) jobs. | Wait for active jobs to complete or cancel them before submitting new ones. |
| `daily_limit` | The user submitted 5 jobs within a rolling 24-hour window. | Wait for the 24-hour window to advance. |
| `queue_full` | Total system queue depth has reached 8 jobs. | Wait for the worker to drain queued work. |

---

## 3. Worker Diagnostics & Recovery

### Interrupted or Orphaned Jobs
If the worker process crashes or the host reboots while a job is running:
- On startup, `Worker.run()` calls `store.recover(restart=True)`.
- Any jobs in state `running` with expired leases are automatically marked `failed` with code `interrupted` (`Worker interrupted; submit a new job`).
- Orphaned directories in `/var/lib/earthsignal/staging` and partial outputs are safely cleaned up.
- **Workers never automatically re-queue interrupted jobs**, preventing infinite crash loops on malformed inputs.

### Worker Stalling / Process Hanging
The worker monitors active jobs with a monotonic timer and a 1-second polling loop:
- If a job exceeds `EARTHSIGNAL_WALL_SECONDS` (default: 1200 seconds / 20 minutes), the worker terminates the entire child process group (`SIGTERM`, followed by `SIGKILL` after 5 seconds).
- The job status is updated to `failed` (`code: time_limit`).
- To check if a job is currently executing:
  ```sh
  pgrep -u earthsignal -f "service.run_job"
  ```

---

## 4. Frontend & Authentication Issues

### Cookie Not Set / Session Loss
- If using `https://nasa.r8volt.com`, ensure the cookie name is `__Host-earthsignal-session`. Browsers require HTTPS and `Path=/` without a `Domain` attribute for `__Host-` cookies.
- Ensure `EARTHSIGNAL_PUBLIC_ORIGIN` matches the exact URL accessed by the browser (including scheme and port, if non-standard).

### Database Lock Contention (`database is locked`)
- Both SQLite databases use `PRAGMA journal_mode=WAL` with busy timeouts (`busy_timeout=3000` or `15000`).
- Ensure no external processes have opened the database files in exclusive non-WAL mode.
- If WAL files grow excessively, checkpoint them:
  ```sh
  sudo -u earthsignal sqlite3 /var/lib/earthsignal/jobs.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"
  ```
