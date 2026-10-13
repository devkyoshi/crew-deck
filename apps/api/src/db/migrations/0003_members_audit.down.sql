CREATE OR REPLACE FUNCTION auth_user_orgs(p_user uuid)
  RETURNS TABLE (id uuid, name text, slug text, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, o.slug, m.org_role
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = p_user
    ORDER BY o.name
  $$;

CREATE OR REPLACE FUNCTION auth_user_by_email(p_org uuid, p_email text)
  RETURNS TABLE (id uuid, email text, name text, status text, password_hash text, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id, u.email, u.name, u.status, u.password_hash, m.org_role
    FROM users u JOIN memberships m ON m.user_id = u.id
    WHERE m.org_id = p_org AND lower(u.email) = lower(p_email)
  $$;

DROP TABLE IF EXISTS audit_logs;
ALTER TABLE memberships DROP COLUMN IF EXISTS deactivated_at;
ALTER TABLE memberships DROP COLUMN IF EXISTS status;
