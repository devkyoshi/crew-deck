CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- lets group_members point at (group, org) so a member and a group can never be in different tenants
  UNIQUE (id, org_id)
);
-- Group names are unique per workspace, ignoring case.
CREATE UNIQUE INDEX groups_org_name_idx ON groups (org_id, lower(name));

CREATE TABLE group_members (
  group_id uuid NOT NULL,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, org_id) REFERENCES groups (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (org_id, user_id);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON groups
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON group_members
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Groups an invitation will place the person in once accepted.
ALTER TABLE invitations ADD COLUMN group_ids uuid[] NOT NULL DEFAULT '{}';

-- Pending-invitation lookup now also returns the preset groups.
DROP FUNCTION auth_pending_invitation(uuid, text);
CREATE FUNCTION auth_pending_invitation(p_org uuid, p_email text)
  RETURNS TABLE (id uuid, org_role text, group_ids uuid[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT i.id, i.org_role, i.group_ids FROM invitations i
    WHERE i.org_id = p_org AND lower(i.email) = lower(p_email)
      AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    ORDER BY i.created_at DESC LIMIT 1
  $$;
REVOKE ALL ON FUNCTION auth_pending_invitation(uuid, text) FROM PUBLIC;

DROP FUNCTION auth_invitation_by_hash(text);
CREATE FUNCTION auth_invitation_by_hash(p_hash text)
  RETURNS TABLE (id uuid, org_id uuid, email text, org_role text, expires_at timestamptz,
                 accepted_at timestamptz, revoked_at timestamptz, group_ids uuid[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT i.id, i.org_id, i.email, i.org_role, i.expires_at, i.accepted_at, i.revoked_at, i.group_ids
    FROM invitations i WHERE i.token_hash = p_hash
  $$;
REVOKE ALL ON FUNCTION auth_invitation_by_hash(text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON groups, group_members TO crew_app;
    GRANT EXECUTE ON FUNCTION auth_pending_invitation(uuid, text), auth_invitation_by_hash(text) TO crew_app;
  END IF;
END $$;
