CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  key text NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT 'folder',
  visibility text NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'private')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  owner_id uuid REFERENCES users(id),
  -- Deleting is a soft delete so a key is never reused (the unique constraint below still covers it).
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key),
  UNIQUE (id, org_id)
);

CREATE TABLE space_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  org_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id uuid NOT NULL,
  space_role text NOT NULL CHECK (space_role IN ('admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, principal_type, principal_id),
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE
);
CREATE INDEX space_members_principal_idx ON space_members (org_id, principal_type, principal_id);

CREATE TABLE space_stars (
  space_id uuid NOT NULL,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id),
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id)
);

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON spaces
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON space_members
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE space_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_stars FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON space_stars
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON spaces, space_members, space_stars TO crew_app;
  END IF;
END $$;
