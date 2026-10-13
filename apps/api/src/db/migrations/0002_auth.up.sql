ALTER TABLE users ADD COLUMN password_hash text;

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  org_role text NOT NULL DEFAULT 'member' CHECK (org_role IN ('owner','admin','member')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_org_email_idx ON invitations(org_id, lower(email));

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Pre-tenant lookups. Sign-in and invite acceptance happen before a tenant context exists, and RLS
-- (correctly) hides everything then. These SECURITY DEFINER functions are the only sanctioned way
-- around it: each takes a narrow key and returns the minimum columns, never a list.
CREATE FUNCTION auth_org_by_slug(p_slug text)
  RETURNS TABLE (id uuid, name text, slug text, domain text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT o.id, o.name, o.slug, o.domain FROM organizations o WHERE o.slug = lower(p_slug) $$;

CREATE FUNCTION auth_org_by_id(p_id uuid)
  RETURNS TABLE (id uuid, name text, slug text, domain text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT o.id, o.name, o.slug, o.domain FROM organizations o WHERE o.id = p_id $$;

CREATE FUNCTION auth_user_by_email(p_org uuid, p_email text)
  RETURNS TABLE (id uuid, email text, name text, status text, password_hash text, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id, u.email, u.name, u.status, u.password_hash, m.org_role
    FROM users u JOIN memberships m ON m.user_id = u.id
    WHERE m.org_id = p_org AND lower(u.email) = lower(p_email)
  $$;

CREATE FUNCTION auth_invitation_by_hash(p_hash text)
  RETURNS TABLE (id uuid, org_id uuid, email text, org_role text, expires_at timestamptz,
                 accepted_at timestamptz, revoked_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT i.id, i.org_id, i.email, i.org_role, i.expires_at, i.accepted_at, i.revoked_at
    FROM invitations i WHERE i.token_hash = p_hash
  $$;

CREATE FUNCTION auth_pending_invitation(p_org uuid, p_email text)
  RETURNS TABLE (id uuid, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT i.id, i.org_role FROM invitations i
    WHERE i.org_id = p_org AND lower(i.email) = lower(p_email)
      AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    ORDER BY i.created_at DESC LIMIT 1
  $$;

-- Existing user (by email) for invite acceptance when the person already has an account elsewhere.
CREATE FUNCTION auth_user_id_by_email(p_email text)
  RETURNS TABLE (id uuid, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT u.id, u.password_hash FROM users u WHERE lower(u.email) = lower(p_email) $$;

-- Orgs a user belongs to, for the tenant switcher.
CREATE FUNCTION auth_user_orgs(p_user uuid)
  RETURNS TABLE (id uuid, name text, slug text, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, o.slug, m.org_role
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = p_user
    ORDER BY o.name
  $$;

REVOKE ALL ON FUNCTION auth_org_by_slug(text), auth_org_by_id(uuid), auth_user_by_email(uuid, text),
  auth_invitation_by_hash(text), auth_pending_invitation(uuid, text),
  auth_user_id_by_email(text), auth_user_orgs(uuid) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO crew_app;
    GRANT EXECUTE ON FUNCTION auth_org_by_slug(text), auth_org_by_id(uuid), auth_user_by_email(uuid, text),
      auth_invitation_by_hash(text), auth_pending_invitation(uuid, text),
      auth_user_id_by_email(text), auth_user_orgs(uuid) TO crew_app;
  END IF;
END $$;
