-- 0014_stage1_integration (Stage 1 integration): two small app-side needs that the
-- Wave-1/Wave-2 slices requested of W1-DB.
--
--   demo_login_directory()   pre-login directory of staff users in DEMO/TEST demo
--                            tenants, used by /masuk and POST /api/session
--                            (src/security/actor.ts listDemoLogins). SECURITY DEFINER
--                            because it runs before any tenant context exists; it
--                            deliberately does NOT call require_ctx() and is
--                            allow-listed by name in tests/db/rls-catalog.test.ts.
--                            It can never return a LIVE tenant (mode filter here,
--                            plus the CHECK (mode <> 'LIVE' OR NOT is_demo) on
--                            tenants). The web process additionally refuses demo
--                            sign-in when APP_MODE=LIVE.
--
--   schema_migrations        lumbung_app may read (version, name) only, so
--                            GET /api/health can report the applied schema version.
--                            No tenant data; checksum/applied_at stay owner-only.

SET LOCAL search_path = lumbung, pg_temp;

CREATE FUNCTION lumbung.demo_login_directory()
  RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_name text, tenant_mode text,
                 user_id uuid, display_name text, role_label text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lumbung, pg_temp
  AS $$
    SELECT t.id, t.slug, t.name, t.mode, u.id, u.display_name, m.role_label
      FROM lumbung.tenants t
      JOIN lumbung.memberships m ON m.tenant_id = t.id AND m.status = 'ACTIVE'
      JOIN lumbung.users u ON u.id = m.user_id AND u.kind = 'HUMAN'
     WHERE t.mode IN ('DEMO','TEST') AND t.is_demo
  $$;

COMMENT ON FUNCTION lumbung.demo_login_directory() IS
  'Pre-login demo directory (DEMO/TEST demo tenants only). No require_ctx by design; allow-listed in rls-catalog.';

REVOKE ALL ON FUNCTION lumbung.demo_login_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lumbung.demo_login_directory() TO lumbung_app;

GRANT SELECT (version, name) ON lumbung.schema_migrations TO lumbung_app;
