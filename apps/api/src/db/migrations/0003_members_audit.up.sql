-- Per-workspace deactivation. users.status is global (one identity, many tenants), so deactivating
-- someone in one workspace must not lock them out of another.
ALTER TABLE memberships ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'deactivated'));
ALTER TABLE memberships ADD COLUMN deactivated_at timestamptz;

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_created_idx ON audit_logs(org_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Append-only for the application role: it can read and add entries, never edit or delete them.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT SELECT, INSERT ON audit_logs TO crew_app;
    -- Default privileges grant everything on new tables, so take the write rights back explicitly.
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM crew_app;
  END IF;
END $$;

-- Sign-in must see the effective (per-workspace) status.
CREATE OR REPLACE FUNCTION auth_user_by_email(p_org uuid, p_email text)
  RETURNS TABLE (id uuid, email text, name text, status text, password_hash text, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id, u.email, u.name,
           CASE WHEN m.status = 'deactivated' THEN 'deactivated' ELSE u.status END,
           u.password_hash, m.org_role
    FROM users u JOIN memberships m ON m.user_id = u.id
    WHERE m.org_id = p_org AND lower(u.email) = lower(p_email)
  $$;

-- The workspace switcher only lists workspaces where the person is still active.
CREATE OR REPLACE FUNCTION auth_user_orgs(p_user uuid)
  RETURNS TABLE (id uuid, name text, slug text, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, o.slug, m.org_role
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = p_user AND m.status = 'active'
    ORDER BY o.name
  $$;
