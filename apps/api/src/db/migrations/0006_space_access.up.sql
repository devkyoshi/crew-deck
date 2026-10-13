CREATE TABLE space_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  space_id uuid NOT NULL,
  user_id uuid NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  granted_role text CHECK (granted_role IN ('admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id)
);

-- One open request per person per space.
CREATE UNIQUE INDEX space_access_requests_one_pending
  ON space_access_requests (space_id, user_id) WHERE status = 'pending';
CREATE INDEX space_access_requests_inbox_idx
  ON space_access_requests (org_id, status, created_at DESC);

ALTER TABLE space_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_access_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON space_access_requests
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON space_access_requests TO crew_app;
  END IF;
END $$;
