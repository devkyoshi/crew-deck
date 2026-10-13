-- Who a person reports to. Managers can see their reports' exact check-in times.
ALTER TABLE memberships ADD COLUMN reports_to uuid;
ALTER TABLE memberships ADD CONSTRAINT memberships_reports_to_fk
  FOREIGN KEY (org_id, reports_to) REFERENCES memberships (org_id, user_id);
ALTER TABLE memberships ADD CONSTRAINT memberships_not_own_manager
  CHECK (reports_to IS NULL OR reports_to <> user_id);

CREATE TABLE tenant_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id),
  timezone text NOT NULL DEFAULT 'UTC',
  -- ISO weekdays: 1 = Monday ... 7 = Sunday
  work_days int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  work_start time NOT NULL DEFAULT '09:00',
  work_end time NOT NULL DEFAULT '17:30',
  -- Open check-ins are closed at this local time, in each person's own timezone.
  auto_close_time time NOT NULL DEFAULT '20:00',
  require_note boolean NOT NULL DEFAULT false,
  enabled_modules text[] NOT NULL DEFAULT '{members,spaces,checkin}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_days <@ ARRAY[1,2,3,4,5,6,7]),
  CHECK (work_start < work_end)
);

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE UNIQUE INDEX sites_org_name_idx ON sites (org_id, lower(name));

CREATE TABLE holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  date date NOT NULL,
  name text NOT NULL,
  UNIQUE (org_id, date)
);

CREATE TABLE work_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  -- The person's own local calendar date (not UTC).
  date date NOT NULL,
  planned_location text CHECK (planned_location IN ('onsite', 'remote', 'offsite', 'leave')),
  location_type text CHECK (location_type IN ('onsite', 'remote', 'offsite', 'leave', 'holiday')),
  site_id uuid,
  checkin_at timestamptz,
  checkout_at timestamptz,
  note text,
  auto_closed boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'auto', 'edit', 'plan')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, date),
  UNIQUE (id, org_id),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id),
  FOREIGN KEY (site_id, org_id) REFERENCES sites (id, org_id),
  CHECK (checkout_at IS NULL OR checkin_at IS NOT NULL),
  CHECK (checkout_at IS NULL OR checkout_at >= checkin_at)
);
CREATE INDEX work_days_org_date_idx ON work_days (org_id, date);
CREATE INDEX work_days_user_date_idx ON work_days (org_id, user_id, date DESC);
-- The auto-close job only ever looks at open check-ins.
CREATE INDEX work_days_open_idx ON work_days (org_id) WHERE checkin_at IS NOT NULL AND checkout_at IS NULL;

CREATE TABLE work_day_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  work_day_id uuid NOT NULL,
  edited_by uuid NOT NULL REFERENCES users(id),
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  edited_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (work_day_id, org_id) REFERENCES work_days (id, org_id) ON DELETE CASCADE
);
CREATE INDEX work_day_edits_day_idx ON work_day_edits (org_id, work_day_id);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sites
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON holidays
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
ALTER TABLE work_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_days FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_days
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
ALTER TABLE work_day_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_day_edits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_day_edits
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Edit history is append-only for the application role, like the audit log.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings, sites, holidays, work_days TO crew_app;
    GRANT SELECT, INSERT ON work_day_edits TO crew_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON work_day_edits FROM crew_app;
  END IF;
END $$;

-- The background job runs outside any tenant and needs to know which workspaces exist. This is the
-- only sanctioned way to list them: ids only, no other columns.
CREATE FUNCTION auth_list_org_ids()
  RETURNS TABLE (id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT o.id FROM organizations o $$;
REVOKE ALL ON FUNCTION auth_list_org_ids() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT EXECUTE ON FUNCTION auth_list_org_ids() TO crew_app;
  END IF;
END $$;
