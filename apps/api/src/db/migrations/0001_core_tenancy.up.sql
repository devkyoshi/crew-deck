CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helper: the tenant for the current transaction (NULL when unset, so policies match nothing).
CREATE FUNCTION current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_org', true), '')::uuid $$;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  domain text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text,
  avatar_url text,
  job_title text,
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','deactivated')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  org_role text NOT NULL DEFAULT 'member' CHECK (org_role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

-- Row-level security. FORCE applies it to the table owner too.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = current_org_id()) WITH CHECK (id = current_org_id());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Users are global identities: visible only if they belong to the current tenant.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON users FOR SELECT
  USING (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = current_org_id()));
CREATE POLICY tenant_update ON users FOR UPDATE
  USING (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = current_org_id()));
CREATE POLICY tenant_insert ON users FOR INSERT WITH CHECK (current_org_id() IS NOT NULL);

-- Table-level grants for the restricted application role (created by infra/postgres/init-roles.sh).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, memberships TO crew_app;
  END IF;
END $$;
