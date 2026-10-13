DROP FUNCTION IF EXISTS auth_invitation_by_hash(text);
CREATE FUNCTION auth_invitation_by_hash(p_hash text)
  RETURNS TABLE (id uuid, org_id uuid, email text, org_role text, expires_at timestamptz,
                 accepted_at timestamptz, revoked_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT i.id, i.org_id, i.email, i.org_role, i.expires_at, i.accepted_at, i.revoked_at
    FROM invitations i WHERE i.token_hash = p_hash
  $$;
REVOKE ALL ON FUNCTION auth_invitation_by_hash(text) FROM PUBLIC;

DROP FUNCTION IF EXISTS auth_pending_invitation(uuid, text);
CREATE FUNCTION auth_pending_invitation(p_org uuid, p_email text)
  RETURNS TABLE (id uuid, org_role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT i.id, i.org_role FROM invitations i
    WHERE i.org_id = p_org AND lower(i.email) = lower(p_email)
      AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    ORDER BY i.created_at DESC LIMIT 1
  $$;
REVOKE ALL ON FUNCTION auth_pending_invitation(uuid, text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT EXECUTE ON FUNCTION auth_pending_invitation(uuid, text), auth_invitation_by_hash(text) TO crew_app;
  END IF;
END $$;

ALTER TABLE invitations DROP COLUMN IF EXISTS group_ids;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
