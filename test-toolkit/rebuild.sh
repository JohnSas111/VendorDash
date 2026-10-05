#!/bin/bash
# Rebuilds a scratch Postgres copy of the VendorDash database.
# usage:  SCHEMA=/path/vendordash_schema_new.sql [MIGRATIONS="/path/a.sql /path/b.sql"] bash rebuild.sh
# - SCHEMA     the fresh public-schema export (it already contains migrations applied before the export)
# - MIGRATIONS only migrations that were applied AFTER that export (usually none)
# Needs: postgresql 16 installed (apt-get update && apt-get install -y postgresql), server running on port 54329.
set -e
: "${SCHEMA:?set SCHEMA to the schema export file}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PS="psql -h /tmp -p 54329 -U postgres -q"
# Postgres 17 exports add the MAINTAIN privilege, which Postgres 16 rejects: strip it so the GRANT lines still apply.
sed -E "s/,MAINTAIN//g; s/MAINTAIN,//g" "$SCHEMA" > /tmp/schema.sql; cp "$HERE/stubs.sql" /tmp/stubs.sql; chmod 644 /tmp/schema.sql /tmp/stubs.sql
su postgres -c "$PS -d postgres -c 'drop database if exists vd' -c 'create database vd'"
su postgres -c "$PS -d vd -f /tmp/stubs.sql" >/dev/null
su postgres -c "$PS -d vd -f /tmp/schema.sql" >/tmp/schema_load.log 2>&1 || true
grep -E "ERROR" /tmp/schema_load.log | grep -vE "already exists" | head -5 || true
for m in $MIGRATIONS; do cp "$m" /tmp/_m.sql; chmod 644 /tmp/_m.sql; su postgres -c "$PS -d vd -v ON_ERROR_STOP=1 -f /tmp/_m.sql"; done
echo REBUILT
