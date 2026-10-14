DROP FUNCTION IF EXISTS platform_owner_of(uuid);
DROP FUNCTION IF EXISTS platform_audit_list(uuid, int);
DROP FUNCTION IF EXISTS platform_audit(uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS platform_expire_trials();
DROP FUNCTION IF EXISTS platform_set_plan(uuid, text, boolean, timestamptz, jsonb);
DROP FUNCTION IF EXISTS platform_set_status(uuid, text, text);
DROP FUNCTION IF EXISTS platform_get_tenant(uuid);
DROP FUNCTION IF EXISTS platform_list_tenants(text, text, int, int);
DROP FUNCTION IF EXISTS platform_admin_by_id(uuid);
DROP FUNCTION IF EXISTS platform_admin_by_email(text);
DROP FUNCTION IF EXISTS platform_create_org(text, text, text, text, boolean, timestamptz, boolean, text);
DROP FUNCTION IF EXISTS signup_request_consume(text);
DROP FUNCTION IF EXISTS signup_request_peek(text);
DROP FUNCTION IF EXISTS signup_recent_count(text, timestamptz);
DROP FUNCTION IF EXISTS signup_request_create(text, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS platform_settings_set(boolean, boolean, int);
DROP FUNCTION IF EXISTS platform_settings_get();
DROP FUNCTION IF EXISTS plan_for_org(uuid);

DROP FUNCTION IF EXISTS auth_user_orgs(uuid);
DROP FUNCTION IF EXISTS auth_org_by_id(uuid);
DROP FUNCTION IF EXISTS auth_org_by_slug(text);

CREATE FUNCTION auth_org_by_slug(p_slug text)
  RETURNS TABLE (id uuid, name text, slug text, domain text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT o.id, o.name, o.slug, o.domain FROM organizations o WHERE o.slug = lower(p_slug) $$;

CREATE FUNCTION auth_org_by_id(p_id uuid)
  RETURNS TABLE (id uuid, name text, slug text, domain text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT o.id, o.name, o.slug, o.domain FROM organizations o WHERE o.id = p_id $$;

CREATE FUNCTION auth_user_orgs(p_user uuid)
  RETURNS TABLE (id uuid, name text, slug text, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, o.slug, m.org_role
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = p_user
    ORDER BY o.name
  $$;

REVOKE ALL ON FUNCTION auth_org_by_slug(text), auth_org_by_id(uuid), auth_user_orgs(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT EXECUTE ON FUNCTION auth_org_by_slug(text), auth_org_by_id(uuid), auth_user_orgs(uuid) TO crew_app;
    GRANT INSERT, UPDATE, DELETE ON organizations TO crew_app;
  END IF;
END $$;

DROP TABLE IF EXISTS platform_audit_logs;
DROP TABLE IF EXISTS signup_requests;
DROP TABLE IF EXISTS platform_settings;
DROP TABLE IF EXISTS platform_admins;

ALTER TABLE organizations
  DROP COLUMN IF EXISTS created_via,
  DROP COLUMN IF EXISTS domain_restricted,
  DROP COLUMN IF EXISTS accent_color,
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS limit_overrides,
  DROP COLUMN IF EXISTS trial_ends_at,
  DROP COLUMN IF EXISTS on_trial,
  DROP COLUMN IF EXISTS plan_key,
  DROP COLUMN IF EXISTS suspended_reason,
  DROP COLUMN IF EXISTS suspended_at,
  DROP COLUMN IF EXISTS status;
DROP TABLE IF EXISTS plans;
