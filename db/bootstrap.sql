-- Lumbung cluster bootstrap: cluster-wide roles.
--
-- Run as a superuser (or a role with CREATEROLE) BEFORE any migration.
-- Roles are cluster-wide, so this file is idempotent and safe to run many
-- times, including concurrently (src/db/migrate-lib.ts wraps it in an
-- advisory lock). Migrations never create roles (portability: on Supabase the
-- equivalent roles are created by the project owner).
--
-- Passwords: the runner sets the transaction-local settings
-- `lumbung.bootstrap_owner_password` / `lumbung.bootstrap_app_password`
-- (derived from DATABASE_OWNER_URL / DATABASE_URL). When this file is run by
-- hand through psql they fall back to the local development defaults from
-- docs/architecture.md G.1. Never use the defaults outside DEMO/TEST.
--
--   lumbung_owner  LOGIN NOSUPERUSER NOBYPASSRLS — owns schema `lumbung` and
--                  every object in it; used by migrate / seed / reset only.
--   lumbung_app    LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT — used by the web
--                  process and the worker; subject to RLS and narrow grants.

DO $bootstrap$
DECLARE
  v_owner_pw text := coalesce(nullif(current_setting('lumbung.bootstrap_owner_password', true), ''), 'lumbung_owner');
  v_app_pw   text := coalesce(nullif(current_setting('lumbung.bootstrap_app_password', true), ''), 'lumbung_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'lumbung_owner') THEN
    BEGIN
      EXECUTE format('CREATE ROLE lumbung_owner LOGIN PASSWORD %L', v_owner_pw);
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL; -- created concurrently by another bootstrap
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'lumbung_app') THEN
    BEGIN
      EXECUTE format('CREATE ROLE lumbung_app LOGIN PASSWORD %L', v_app_pw);
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;

  -- Enforce attributes every time (a previous manual change must not survive).
  EXECUTE format(
    'ALTER ROLE lumbung_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L',
    v_owner_pw);
  EXECUTE format(
    'ALTER ROLE lumbung_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
    v_app_pw);

  -- The app role must never be able to act as the owner.
  IF pg_catalog.pg_has_role('lumbung_app', 'lumbung_owner', 'MEMBER') THEN
    EXECUTE 'REVOKE lumbung_owner FROM lumbung_app';
  END IF;
END
$bootstrap$;
