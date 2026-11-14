#!/usr/bin/env bash
# Operator release deployment. Provision accounts/config/units/TLS first; see docs/deployment.md.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# != 1 ]]; then printf 'Usage: %s root@your-server\n' "$0" >&2; exit 2; fi
target="$1"
transport=()
if [[ -n "${EARTHSIGNAL_SSH_CONTROL:-}" ]]; then
  transport=(-o "ControlPath=$EARTHSIGNAL_SSH_CONTROL" -o BatchMode=yes)
fi
./scripts/package-release.sh
release="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
scp "${transport[@]}" outputs/releases/earthsignal-web.tar.gz "$target:/opt/earthsignal/web/$release.tar.gz"
ssh "${transport[@]}" "$target" bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release="$1"
cd /opt/earthsignal/web
[[ "$(df --output=avail -B1 . | tail -1)" -gt 3221225472 ]]
mkdir -p "releases/$release"
tar -xzf "$release.tar.gz" -C "releases/$release"
chown -R root:earthsignal-web "releases/$release"
chmod -R g+rX,o-rwx "releases/$release"
previous="$(readlink current || true)"
ln -s "releases/$release" current.next
mv -Tf current.next current
restore_previous() {
  if [[ -z "$previous" ]]; then
    printf 'No previous release is available for rollback.\n' >&2
    return 1
  fi
  ln -s "$previous" current.rollback
  mv -Tf current.rollback current
  if ! systemctl restart earthsignal-web; then
    printf 'Previous release restored, but its restart failed.\n' >&2
    return 1
  fi
  for rollback_attempt in $(seq 1 20); do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3040/api/auth/session >/dev/null; then return 0; fi
    sleep 1
  done
  printf 'Previous release restored, but its health check failed.\n' >&2
  return 1
}
if ! systemctl restart earthsignal-web; then
  restore_previous
  printf 'New release restart failed; previous release restored.\n' >&2
  exit 1
fi
for attempt in $(seq 1 20); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3040/api/auth/session >/dev/null; then
    rm "$release.tar.gz"
    printf 'Activated %s\n' "$release"
    exit 0
  fi
  sleep 1
done
restore_previous
printf 'Release failed its local health check; previous release restored when available.\n' >&2
exit 1
REMOTE
