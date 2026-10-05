#!/bin/bash
# Installs (first time) and starts a throw-away Postgres on port 54329. Needs root + apt network access.
# Safe to run again: it clears stale lock files left by a crashed server.
set -e
if ! ls -d /usr/lib/postgresql/*/bin >/dev/null 2>&1; then
  apt-get update >/dev/null 2>&1; apt-get install -y --no-install-recommends postgresql postgresql-client >/dev/null 2>&1
fi
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
mkdir -p /tmp/pgdata && chown postgres:postgres /tmp/pgdata
[ -f /tmp/pgdata/PG_VERSION ] || su postgres -c "$PGBIN/initdb -D /tmp/pgdata -A trust >/dev/null"
if ! su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata status" >/dev/null 2>&1; then
  rm -f /tmp/pgdata/postmaster.pid /tmp/.s.PGSQL.54329 /tmp/.s.PGSQL.54329.lock
  su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-p 54329 -k /tmp' -l /tmp/pg.log start" >/dev/null
fi
sleep 3; su postgres -c "pg_isready -h /tmp -p 54329"
