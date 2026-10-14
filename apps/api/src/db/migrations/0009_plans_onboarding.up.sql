-- Plans, self-serve sign-up and the platform admin console.

-- ---- Plans ----------------------------------------------------------------------------------------
-- A plan is global (not tenant data). `limits` holds numbers (a missing key means unlimited);
-- `features` holds the keys listed in docs/FEATURES.md. Prices are display-only: there is no billing.
CREATE TABLE plans (
  key text PRIMARY KEY,
  name text NOT NULL,
  sort int NOT NULL,
  price_cents int,
  public boolean NOT NULL DEFAULT true,
  limits jsonb NOT NULL DEFAULT '{}',
  features text[] NOT NULL DEFAULT '{}'
);

INSERT INTO plans (key, name, sort, price_cents, public, limits, features) VALUES
  ('free', 'Free', 1, 0, true,
    '{"seats":5,"spaces":3,"crm_records":500,"pipelines":1,"storage_mb":100,"audit_days":30,"sites":1}',
    '{}'),
  ('team', 'Team', 2, 600, true,
    '{"seats":50,"pipelines":3,"storage_mb":5120,"audit_days":365}',
    '{attendance_export,crm_io,domain_lock,branding_name}'),
  ('business', 'Business', 3, 1200, true,
    '{"storage_mb":51200}',
    '{attendance_export,crm_io,domain_lock,space_audit,branding_name,branding_full}'),
  ('enterprise', 'Enterprise', 4, NULL, false,
    '{}',
    '{attendance_export,crm_io,domain_lock,space_audit,branding_name,branding_full}');

-- ---- Organizations --------------------------------------------------------------------------------
-- plan_key NULL means an internal workspace with no limits (every workspace that existed before plans).
ALTER TABLE organizations
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspended_reason text,
  ADD COLUMN plan_key text REFERENCES plans(key),
  ADD COLUMN on_trial boolean NOT NULL DEFAULT false,
  ADD COLUMN trial_ends_at timestamptz,
  ADD COLUMN limit_overrides jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN logo_url text,
  ADD COLUMN accent_color text CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN domain_restricted boolean NOT NULL DEFAULT true,
  ADD COLUMN created_via text NOT NULL DEFAULT 'admin' CHECK (created_via IN ('admin','signup','platform'));

-- Tenants may change only their own branding. Status, plan and limits belong to the platform and are
-- changed through the SECURITY DEFINER functions below.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON organizations FROM crew_app;
    GRANT UPDATE (name, logo_url, accent_color, domain_restricted) ON organizations TO crew_app;
    GRANT SELECT ON plans TO crew_app;
  END IF;
END $$;

-- ---- Platform tables (no tenant, no direct access for the application role) -------------------------
CREATE TABLE platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  block_free_email_domains boolean NOT NULL DEFAULT false,
  signups_enabled boolean NOT NULL DEFAULT true,
  trial_days int NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 0 AND 90),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings DEFAULT VALUES;

CREATE TABLE signup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  email text NOT NULL,
  name text,
  company text NOT NULL,
  slug text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signup_requests_email_idx ON signup_requests (lower(email), created_at);

CREATE TABLE platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES platform_admins(id),
  action text NOT NULL,
  org_id uuid REFERENCES organizations(id),
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_org_idx ON platform_audit_logs (org_id, created_at DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    REVOKE ALL ON platform_admins, platform_settings, signup_requests, platform_audit_logs FROM crew_app;
  END IF;
END $$;

-- ---- Pre-tenant lookups now also return status, plan and branding ---------------------------------------
DROP FUNCTION auth_org_by_slug(text);
DROP FUNCTION auth_org_by_id(uuid);

CREATE FUNCTION auth_org_by_slug(p_slug text)
  RETURNS TABLE (id uuid, name text, slug text, domain text, status text, suspended_reason text,
                 logo_url text, accent_color text, domain_restricted boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT o.id, o.name, o.slug, o.domain, o.status, o.suspended_reason, o.logo_url, o.accent_color,
               o.domain_restricted
        FROM organizations o WHERE o.slug = lower(p_slug) $$;

CREATE FUNCTION auth_org_by_id(p_id uuid)
  RETURNS TABLE (id uuid, name text, slug text, domain text, status text, suspended_reason text,
                 logo_url text, accent_color text, domain_restricted boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT o.id, o.name, o.slug, o.domain, o.status, o.suspended_reason, o.logo_url, o.accent_color,
               o.domain_restricted
        FROM organizations o WHERE o.id = p_id $$;

-- The workspace picker and tenant switcher must not list suspended workspaces' data as usable.
DROP FUNCTION auth_user_orgs(uuid);
CREATE FUNCTION auth_user_orgs(p_user uuid)
  RETURNS TABLE (id uuid, name text, slug text, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, o.slug, m.org_role
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = p_user AND o.status = 'active'
    ORDER BY o.name
  $$;

-- The plan row an organization is on (NULL plan = internal, no limits) plus its overrides.
CREATE FUNCTION plan_for_org(p_org uuid)
  RETURNS TABLE (plan_key text, on_trial boolean, trial_ends_at timestamptz, limit_overrides jsonb,
                 plan_name text, limits jsonb, features text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.plan_key, o.on_trial, o.trial_ends_at, o.limit_overrides, p.name, p.limits, p.features
    FROM organizations o LEFT JOIN plans p ON p.key = o.plan_key WHERE o.id = p_org
  $$;

-- ---- Sign-up ---------------------------------------------------------------------------------------------
CREATE FUNCTION platform_settings_get()
  RETURNS TABLE (block_free_email_domains boolean, signups_enabled boolean, trial_days int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT block_free_email_domains, signups_enabled, trial_days FROM platform_settings $$;

CREATE FUNCTION platform_settings_set(p_block boolean, p_signups boolean, p_trial_days int)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE platform_settings SET block_free_email_domains = p_block, signups_enabled = p_signups,
          trial_days = p_trial_days, updated_at = now() $$;

CREATE FUNCTION signup_request_create(p_hash text, p_email text, p_name text, p_company text,
                                      p_slug text, p_expires timestamptz)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ INSERT INTO signup_requests (token_hash, email, name, company, slug, expires_at)
        VALUES (p_hash, lower(p_email), p_name, p_company, lower(p_slug), p_expires) $$;

-- How many sign-up emails this address has asked for recently (abuse guard).
CREATE FUNCTION signup_recent_count(p_email text, p_since timestamptz)
  RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT count(*)::int FROM signup_requests WHERE lower(email) = lower(p_email) AND created_at > p_since $$;

-- Looks at a usable request without using it (for the verify page). Also says whether the email already
-- has an account, so the page knows whether to ask for a password.
CREATE FUNCTION signup_request_peek(p_hash text)
  RETURNS TABLE (email text, company text, slug text, has_account boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT r.email, r.company, r.slug,
           EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(r.email))
    FROM signup_requests r
    WHERE r.token_hash = p_hash AND r.used_at IS NULL AND r.expires_at > now()
  $$;

-- Atomically marks a usable request as used and returns it. Unknown, used and expired look the same.
CREATE FUNCTION signup_request_consume(p_hash text)
  RETURNS TABLE (id uuid, email text, name text, company text, slug text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE signup_requests SET used_at = now()
    WHERE token_hash = p_hash AND used_at IS NULL AND expires_at > now()
    RETURNING id, email, name, company, slug
  $$;

-- Creates a workspace. Used by verified sign-ups and by the platform console.
CREATE FUNCTION platform_create_org(p_name text, p_slug text, p_domain text, p_plan text, p_on_trial boolean,
                                    p_trial_ends timestamptz, p_domain_restricted boolean, p_via text)
  RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    INSERT INTO organizations (name, slug, domain, plan_key, on_trial, trial_ends_at, domain_restricted, created_via)
    VALUES (p_name, lower(p_slug), lower(p_domain), p_plan, p_on_trial, p_trial_ends, p_domain_restricted, p_via)
    RETURNING id
  $$;

-- ---- Platform console ------------------------------------------------------------------------------------
CREATE FUNCTION platform_admin_by_email(p_email text)
  RETURNS TABLE (id uuid, email text, name text, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.id, a.email, a.name, a.password_hash FROM platform_admins a WHERE lower(a.email) = lower(p_email) $$;

CREATE FUNCTION platform_admin_by_id(p_id uuid)
  RETURNS TABLE (id uuid, email text, name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.id, a.email, a.name FROM platform_admins a WHERE a.id = p_id $$;

CREATE FUNCTION platform_list_tenants(p_q text, p_status text, p_limit int, p_offset int)
  RETURNS TABLE (id uuid, name text, slug text, domain text, status text, suspended_reason text, plan_key text,
                 on_trial boolean, trial_ends_at timestamptz, created_at timestamptz, created_via text,
                 member_count int, last_login_at timestamptz, total bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, o.slug, o.domain, o.status, o.suspended_reason, o.plan_key, o.on_trial, o.trial_ends_at,
           o.created_at, o.created_via,
           (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id AND m.status = 'active'),
           (SELECT max(u.last_login_at) FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id),
           count(*) OVER ()
    FROM organizations o
    WHERE (p_q IS NULL OR o.name ILIKE '%' || p_q || '%' OR o.slug ILIKE '%' || p_q || '%' OR o.domain ILIKE '%' || p_q || '%')
      AND (p_status IS NULL OR o.status = p_status)
    ORDER BY o.created_at DESC, o.id
    LIMIT p_limit OFFSET p_offset
  $$;

CREATE FUNCTION platform_get_tenant(p_id uuid)
  RETURNS TABLE (id uuid, name text, slug text, domain text, status text, suspended_reason text, suspended_at timestamptz,
                 plan_key text, on_trial boolean, trial_ends_at timestamptz, limit_overrides jsonb,
                 created_at timestamptz, created_via text, domain_restricted boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, o.slug, o.domain, o.status, o.suspended_reason, o.suspended_at, o.plan_key, o.on_trial,
           o.trial_ends_at, o.limit_overrides, o.created_at, o.created_via, o.domain_restricted
    FROM organizations o WHERE o.id = p_id
  $$;

CREATE FUNCTION platform_set_status(p_id uuid, p_status text, p_reason text)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    WITH u AS (
      UPDATE organizations SET status = p_status,
        suspended_at = CASE WHEN p_status = 'suspended' THEN now() ELSE NULL END,
        suspended_reason = CASE WHEN p_status = 'suspended' THEN p_reason ELSE NULL END
      WHERE id = p_id RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM u)
  $$;

CREATE FUNCTION platform_set_plan(p_id uuid, p_plan text, p_on_trial boolean, p_trial_ends timestamptz,
                                  p_overrides jsonb)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    WITH u AS (
      UPDATE organizations SET plan_key = p_plan, on_trial = p_on_trial, trial_ends_at = p_trial_ends,
        limit_overrides = p_overrides
      WHERE id = p_id RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM u)
  $$;

-- Moves workspaces whose trial has ended to Free. Returns the ones that changed.
CREATE FUNCTION platform_expire_trials()
  RETURNS TABLE (id uuid)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE organizations SET plan_key = 'free', on_trial = false
    WHERE on_trial AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
    RETURNING organizations.id
  $$;

CREATE FUNCTION platform_audit(p_admin uuid, p_action text, p_org uuid, p_detail jsonb)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ INSERT INTO platform_audit_logs (admin_id, action, org_id, detail) VALUES (p_admin, p_action, p_org, p_detail) $$;

CREATE FUNCTION platform_audit_list(p_org uuid, p_limit int)
  RETURNS TABLE (id uuid, admin_email text, action text, org_id uuid, detail jsonb, created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT l.id, a.email, l.action, l.org_id, l.detail, l.created_at
    FROM platform_audit_logs l LEFT JOIN platform_admins a ON a.id = l.admin_id
    WHERE p_org IS NULL OR l.org_id = p_org
    ORDER BY l.created_at DESC LIMIT p_limit
  $$;

-- The owner a platform admin acts as when impersonating (the earliest active owner).
CREATE FUNCTION platform_owner_of(p_org uuid)
  RETURNS TABLE (user_id uuid, email text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id, u.email FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = p_org AND m.org_role = 'owner' AND m.status = 'active' AND u.status = 'active'
    ORDER BY m.created_at LIMIT 1
  $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'auth_org_by_slug(text)', 'auth_org_by_id(uuid)', 'auth_user_orgs(uuid)', 'plan_for_org(uuid)',
    'platform_settings_get()', 'platform_settings_set(boolean,boolean,int)',
    'signup_request_create(text,text,text,text,text,timestamptz)', 'signup_recent_count(text,timestamptz)',
    'signup_request_consume(text)', 'signup_request_peek(text)',
    'platform_create_org(text,text,text,text,boolean,timestamptz,boolean,text)',
    'platform_admin_by_email(text)', 'platform_admin_by_id(uuid)', 'platform_list_tenants(text,text,int,int)',
    'platform_get_tenant(uuid)', 'platform_set_status(uuid,text,text)',
    'platform_set_plan(uuid,text,boolean,timestamptz,jsonb)', 'platform_expire_trials()',
    'platform_audit(uuid,text,uuid,jsonb)', 'platform_audit_list(uuid,int)', 'platform_owner_of(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO crew_app', f);
    END IF;
  END LOOP;
END $$;
