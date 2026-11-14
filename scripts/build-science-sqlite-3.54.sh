#!/bin/sh
# Build an isolated library; never replace the OS library or activate services.
set -eu
SQLITE_RELEASE_DIR=${1:-/opt/earthsignal/runtime/sqlite-3.54.0}
if [ -e "$SQLITE_RELEASE_DIR" ]; then
  echo 'Destination exists; inspect it instead of replaying a build.' >&2
  exit 1
fi
SQLITE_BUILD_DIR=$(mktemp -d /var/tmp/earthsignal-sqlite.XXXXXX)
trap 'rm -rf "$SQLITE_BUILD_DIR"' EXIT
curl --fail --location --max-time 60 --proto '=https' --tlsv1.2 \
  https://www.sqlite.org/2026/sqlite-amalgamation-3540000.zip -o "$SQLITE_BUILD_DIR/source.zip"
python3 - "$SQLITE_BUILD_DIR/source.zip" <<'PY'
import hashlib,sys
from pathlib import Path
if hashlib.sha3_256(Path(sys.argv[1]).read_bytes()).hexdigest() != '7b670a62fdfbd672b75fef004cb703c8a3e87d3a5cc7d675b4a08337004a2d93':
    raise SystemExit('Official SQLite source pin mismatch')
PY
unzip -q "$SQLITE_BUILD_DIR/source.zip" -d "$SQLITE_BUILD_DIR"
gcc -shared -fPIC -O1 -DSQLITE_THREADSAFE=1 -DSQLITE_ENABLE_COLUMN_METADATA \
  -DSQLITE_ENABLE_RTREE -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_DBSTAT_VTAB \
  -DSQLITE_ENABLE_MATH_FUNCTIONS -Wl,-soname,libsqlite3.so.0 \
  "$SQLITE_BUILD_DIR/sqlite-amalgamation-3540000/sqlite3.c" \
  -o "$SQLITE_BUILD_DIR/libsqlite3.so.0" -lm -ldl -pthread
LD_LIBRARY_PATH="$SQLITE_BUILD_DIR" python3 - <<'PY'
import sqlite3,tempfile
assert sqlite3.sqlite_version == '3.54.0'
with tempfile.NamedTemporaryFile() as f:
    with sqlite3.connect(f.name) as db:
        assert db.execute('pragma journal_mode=wal').fetchone()[0] == 'wal'
        db.executescript('create table test(v); insert into test values(1);')
        assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'
        assert db.execute('select v from test').fetchone()[0] == 1
PY
install -d -m 0755 "$SQLITE_RELEASE_DIR"
install -m 0644 "$SQLITE_BUILD_DIR/libsqlite3.so.0" "$SQLITE_RELEASE_DIR/libsqlite3.so.0"
sha256sum "$SQLITE_RELEASE_DIR/libsqlite3.so.0"
echo 'Built only. Run native checks and a rollback exercise before service activation.'
