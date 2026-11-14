# Deploy the full workspace

Reference host: Ubuntu26.04.1, Node22.22.1, Python3.14.4, GDAL3.12.2. Build on your workstation; the small server runs the release without npm installation. The frontend and science service use separate no-login accounts and separate private state directories. Existing applications must keep their own ports and nginx hosts.

## Current production origin — 17 October 2026

The public workspace remains **https://nasa.r8volt.com**. Its proxied Cloudflare
A record now points to the existing Hetzner host **167.233.60.119**. The active
hostname-and-HTTPS Origin Rule sends only Earthsignal traffic to TLS port 2087.
Nginx uses 80 for HTTP/ACME and 2087 for this site's TLS; the existing VPN process
continues to own 443. Do not apply the generic port 443 nginx template unchanged here.
Web port 3040 and science port 8030 remain loopback-only.

The migrated web release is the exact previously deployed
`20261016T221759Z-372bf0f`; the separately staged `20261017-4655c2a` release was
not activated during migration. Scientific code, private configuration, existing
accounts and state were transferred with the existing resource limits intact.
The supervised API and worker load the existing custom SQLite 3.54.0 library via
their preserved systemd drop-ins; a shell Python without that library path can
report a different SQLite version.

The previous origin **45.63.116.105** forwards this hostname exclusively to the
new host using verified TLS. Its three Earthsignal services are stopped,
disabled and fenced by a missing `.allow-old-origin-writes` condition marker.
Keep its preserved files for investigation and recovery. **After new requests
have been admitted, never restart the old writers or restore its stale databases
as a rollback.** Any subsequent recovery must preserve the new authoritative
state. Other applications and DNS records were not moved.

The new host's existing Certbot timer is active and its nginx deploy hook was
restored and executed. The public ACME webroot route was checked end to end; the
origin certificate expires 6 January 2027. No fresh issuance or renewal dry run was
performed as part of this migration. The detailed receipt and limits are in the
[implementation checkpoint](scientific-implementation-2026-10-12.md).

## Provision the host

Install nginx, Certbot, Node>=22.13, Python/venv, GDAL3.12.x with netCDF virtual IO, NumPy, h5py and Pillow. Exact science dependencies are documented in [service/README.md](../service/README.md); a generic older distro GDAL is insufficient for production streaming.

Create `earthsignal` and `earthsignal-web` system accounts. Create these directories:

| Directory | Owner | Mode |
|---|---|---|
| `/opt/earthsignal/service` | root:earthsignal |0755, source0644|
| `/opt/earthsignal/web/releases` |root:earthsignal-web|0750|
| `/opt/earthsignal/admin/lib`, `/opt/earthsignal/admin/scripts` |root:earthsignal-web|0750|
| `/var/lib/earthsignal` |earthsignal:earthsignal|0700|
| `/var/lib/earthsignal-web` |earthsignal-web:earthsignal-web|0700|
| `/etc/earthsignal` |root:root|0755, individual files restricted below|

Create `/opt/earthsignal/service/.venv` with system site packages and install the production requirements. Copy `service/` source into `/opt/earthsignal/service`; never copy workstation virtual environments.

Install `dist/standalone/admin/scripts/collaborator.mjs` and `dist/standalone/admin/lib/local-auth.mjs` into their corresponding `/opt/earthsignal/admin/` subdirectories and create `admin/package.json` containing `{"type":"module"}`. The release contains compiled JavaScript for the operator CLI too; distro Node builds may lack TypeScript execution even at the required version. These files are root-owned, group-readable, never web-writable.

## Private configuration

Copy [service.env.example](../service/deploy/service.env.example) to `/etc/earthsignal/service.env` (root:earthsignal0640) and [web.env.example](../service/deploy/web.env.example) to `/etc/earthsignal/web.env` (root:earthsignal-web0640). Both need the same cryptographically random gateway key of at least32 bytes; generate it locally and write it directly to the two private files. Do not put it in shell history, Git or client bundles.

Configure `/etc/earthsignal/earthdata.netrc`, owner earthsignal:earthsignal0600, with the operator's Earthdata Login. Parent directory must be traversable by both service accounts; individual credential files remain inaccessible to the other service account. The web account must not be able to read the Earthdata file. Public app URL is `https://nasa.r8volt.com`; processing URL is loopback `http://127.0.0.1:8030`.

Provision the initial collaborator using [operations.md](operations.md). Account passwords are separate from Earthdata and SSH.

## Units, TLS and release

Copy the four checked-in `service/deploy/earthsignal*.service`/`.slice` files to `/etc/systemd/system/`. Science API/worker share384MiB, zero swap and half a CPU. The web unit has192MiB, zero swap, Node heap112MiB, and binds127.0.0.1:3040. It reads `/opt/earthsignal/web/current/server.js`.

Build with `./scripts/package-release.sh`; unpack the resulting archive under `/opt/earthsignal/web/releases/<release>`, root:earthsignal-web, group-readable. Atomically point `web/current` to that release. Enable/start the API, worker and web units after `systemctl daemon-reload`.

After your DNS points to the server, obtain Let's Encrypt TLS using Certbot's webroot at `/var/lib/earthsignal-acme`. Use [the nginx template](../service/deploy/nginx.conf.template), test with `nginx -t`, then reload. `/health` exposes only status; every job/artifact request goes through the authenticated web gateway. Neither3040 nor8030 binds a public interface. The existing Certbot timer and deploy hook must test/reload nginx after renewal.

Subsequent web releases: `./scripts/deploy-web.sh root@your-server`. This builds locally, preserves the previous release, checks the new local session endpoint and rolls the symlink back on failure. It assumes accounts, units, configuration and TLS are already provisioned. Auth source/CLI changes need an explicit matching admin-source update; science changes need their own test/deployment.

The pinned [86692bb science activation](../scripts/activate-science-86692bb.py)
is an operator recipe for that exact prior/new source and package inventory,
not a generic upgrade command. It requires a stable virtual environment outside
the exchanged source directories. Linux `renameat2` exchanges the two directories
atomically; unsupported exchange fails without a two-rename fallback. Interrupted
or failed-compensation runs require inspection, not automatic replay. The script
tests the actual old source and supervised services before final activation;
after new work can be admitted it retains new code and never restores the database.
Run [the Linux interruption checks](../scripts/test_science_activation.py) before
using the recipe. Inspect every existing staging/backup path and package hash.

Keep root-only operator research files in `/var/backups/earthsignal-science`,
outside service-owned `/var/lib/earthsignal`. The vintage ledger deliberately
withholds writes if it cannot scan shared storage to verify its budget. Moving
operator files out must preserve hashes and restrictive permissions; do not fix
a scan failure by weakening the budget check or granting the web account access.

The [1.5→1.6 receipt activation](../scripts/activate-science-1.6.0.py) is a separate
pinned specialization with its own package digest and unused staging/backup paths.
Deploy the compatible web consumer first, then check the exact current source,
empty queue, storage reserve and external virtual environment. The original recipe
remains unchanged. Run the same Linux checks against the named recipe with
`--recipe scripts/activate-science-1.6.0.py`. Neither recipe is a generic future
upgrade command.

The [IPC correction recipe](../scripts/activate-science-1.6.0-ipc.py) retains
the same scientific method version while pinning the changed processing-entrypoint
source. Its isolated smoke hashes both `net.py` and `run_job.py`, distinguishing
the candidate from the previous source even when method strings match. It uses
a new staging/backup path and retains the same final-admission boundary.

## Verify activation

Check enabled/active units, HTTP→HTTPS redirect, valid hostname certificate, `/health`200, workspace200, session endpoint200/null anonymously, jobs/artifacts401 anonymously, and spoofed identity headers401. Sign in, inspect the retained study and protected downloads, submit a small job twice with one idempotency key, and verify another account cannot read its ordinary result. Check both memory limits under load. Test a renewal dry run during an appropriate maintenance window; certificate issuance alone does not prove future renewal.
