-- Per-member CRM role. Org owners and admins are always CRM admins regardless of this value.
ALTER TABLE memberships ADD COLUMN crm_role text NOT NULL DEFAULT 'member'
  CHECK (crm_role IN ('none', 'viewer', 'member', 'admin'));

-- The CRM is a module that can be switched off per workspace (enabled_modules contains 'crm').
UPDATE tenant_settings SET enabled_modules = array_append(enabled_modules, 'crm')
  WHERE NOT ('crm' = ANY (enabled_modules));
ALTER TABLE tenant_settings ALTER COLUMN enabled_modules SET DEFAULT '{members,spaces,checkin,crm}';

CREATE TABLE crm_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'blue',
  UNIQUE (id, org_id)
);
CREATE UNIQUE INDEX crm_tags_org_name_idx ON crm_tags (org_id, lower(name));

CREATE TABLE crm_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  website text,
  industry text,
  size text,
  owner_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, org_id)
);
-- A company name is unique per workspace (among records that are not deleted).
CREATE UNIQUE INDEX crm_companies_org_name_idx ON crm_companies (org_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  company_id uuid,
  name text NOT NULL,
  email text,
  phone text,
  job_title text,
  owner_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (company_id, org_id) REFERENCES crm_companies (id, org_id)
);
CREATE INDEX crm_contacts_company_idx ON crm_contacts (org_id, company_id);
CREATE INDEX crm_contacts_email_idx ON crm_contacts (org_id, lower(email));

CREATE TABLE crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  email text,
  company_name text,
  source text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'unqualified')),
  owner_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  converted_at timestamptz,
  converted_company_id uuid,
  converted_contact_id uuid,
  converted_deal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, org_id)
);
CREATE INDEX crm_leads_status_idx ON crm_leads (org_id, status);
CREATE INDEX crm_leads_source_idx ON crm_leads (org_id, source);

CREATE TABLE crm_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE (id, org_id)
);
-- At most one default pipeline per workspace (also makes first-use creation safe under concurrency).
CREATE UNIQUE INDEX crm_pipelines_one_default ON crm_pipelines (org_id) WHERE is_default;

CREATE TABLE crm_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  pipeline_id uuid NOT NULL,
  name text NOT NULL,
  position int NOT NULL,
  probability int NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  CHECK (NOT (is_won AND is_lost)),
  UNIQUE (id, org_id),
  FOREIGN KEY (pipeline_id, org_id) REFERENCES crm_pipelines (id, org_id) ON DELETE CASCADE
);
CREATE INDEX crm_stages_pipeline_idx ON crm_stages (org_id, pipeline_id, position);

CREATE TABLE crm_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  pipeline_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  company_id uuid,
  contact_id uuid,
  title text NOT NULL,
  value numeric(14, 2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  expected_close date,
  owner_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  -- Order inside a stage column. Fractional so a move changes one row.
  position double precision NOT NULL DEFAULT 0,
  closed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (pipeline_id, org_id) REFERENCES crm_pipelines (id, org_id),
  FOREIGN KEY (stage_id, org_id) REFERENCES crm_stages (id, org_id),
  FOREIGN KEY (company_id, org_id) REFERENCES crm_companies (id, org_id),
  FOREIGN KEY (contact_id, org_id) REFERENCES crm_contacts (id, org_id)
);
CREATE INDEX crm_deals_stage_idx ON crm_deals (org_id, stage_id, position);
CREATE INDEX crm_deals_status_idx ON crm_deals (org_id, status);
CREATE INDEX crm_deals_company_idx ON crm_deals (org_id, company_id);

CREATE TABLE crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  type text NOT NULL CHECK (type IN ('call', 'meeting', 'email', 'task')),
  subject text NOT NULL,
  due_at timestamptz,
  completed_at timestamptz,
  assignee_id uuid REFERENCES users(id),
  linked_type text CHECK (linked_type IN ('company', 'contact', 'lead', 'deal')),
  linked_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((linked_type IS NULL) = (linked_id IS NULL))
);
CREATE INDEX crm_activities_assignee_idx ON crm_activities (org_id, assignee_id, completed_at, due_at);
CREATE INDEX crm_activities_linked_idx ON crm_activities (org_id, linked_type, linked_id);

CREATE TABLE crm_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  author_id uuid NOT NULL REFERENCES users(id),
  linked_type text NOT NULL CHECK (linked_type IN ('company', 'contact', 'lead', 'deal')),
  linked_id uuid NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_notes_linked_idx ON crm_notes (org_id, linked_type, linked_id, created_at DESC);

-- A record can carry several tags (the brief's "tags" on companies and contacts, generalised).
CREATE TABLE crm_record_tags (
  org_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('company', 'contact', 'lead', 'deal')),
  record_id uuid NOT NULL,
  PRIMARY KEY (tag_id, record_type, record_id),
  FOREIGN KEY (tag_id, org_id) REFERENCES crm_tags (id, org_id) ON DELETE CASCADE
);
CREATE INDEX crm_record_tags_record_idx ON crm_record_tags (org_id, record_type, record_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_tags','crm_companies','crm_contacts','crm_leads','crm_pipelines','crm_stages',
                           'crm_deals','crm_activities','crm_notes','crm_record_tags']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crew_app', t);
    END IF;
  END LOOP;
END $$;
