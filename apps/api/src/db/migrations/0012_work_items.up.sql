-- Work items, statuses and boards (docs/work-items, W1). Every table carries org_id with row-level security.
-- Composite foreign keys keep a status, parent or label in the same space (and so the same tenant).

CREATE TABLE boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  space_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'kanban' CHECK (type IN ('kanban', 'scrum')),
  name text NOT NULL DEFAULT 'Board',
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE
);

CREATE TABLE space_counters (
  space_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE
);

CREATE TABLE space_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  space_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  category text NOT NULL CHECK (category IN ('todo', 'in_progress', 'done')),
  position int NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  wip_limit int CHECK (wip_limit IS NULL OR wip_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (id, space_id),
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX space_statuses_name_idx ON space_statuses (space_id, lower(name));
CREATE INDEX space_statuses_order_idx ON space_statuses (space_id, position);

CREATE TABLE work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  space_id uuid NOT NULL,
  number int NOT NULL,
  type text NOT NULL CHECK (type IN ('epic', 'story', 'task', 'bug', 'subtask')),
  parent_id uuid,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  -- Rich text document (ProseMirror JSON); plain paragraphs in W1, Tiptap from W3.
  description jsonb,
  status_id uuid NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('highest', 'high', 'medium', 'low', 'lowest')),
  assignee_id uuid,
  reporter_id uuid NOT NULL,
  estimate numeric(5,1) CHECK (estimate IS NULL OR estimate >= 0),
  due_date date,
  -- The foreign key to sprints is added with the sprints table (W6).
  sprint_id uuid,
  -- Fractional-indexing key; byte order matters, hence COLLATE "C".
  rank text COLLATE "C" NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (space_id, number),
  UNIQUE (id, org_id),
  UNIQUE (id, space_id),
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (status_id, space_id) REFERENCES space_statuses (id, space_id),
  FOREIGN KEY (parent_id, space_id) REFERENCES work_items (id, space_id),
  FOREIGN KEY (org_id, assignee_id) REFERENCES memberships (org_id, user_id),
  FOREIGN KEY (org_id, reporter_id) REFERENCES memberships (org_id, user_id)
);
CREATE INDEX work_items_board_idx ON work_items (space_id, status_id, rank, id) WHERE deleted_at IS NULL;
CREATE INDEX work_items_assignee_idx ON work_items (space_id, assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX work_items_parent_idx ON work_items (parent_id) WHERE deleted_at IS NULL;
CREATE INDEX work_items_org_idx ON work_items (org_id, space_id);

CREATE TABLE labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  space_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  color text NOT NULL DEFAULT 'slate',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (id, space_id),
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX labels_name_idx ON labels (space_id, lower(name));

CREATE TABLE work_item_labels (
  work_item_id uuid NOT NULL,
  label_id uuid NOT NULL,
  org_id uuid NOT NULL,
  space_id uuid NOT NULL,
  PRIMARY KEY (work_item_id, label_id),
  FOREIGN KEY (work_item_id, space_id) REFERENCES work_items (id, space_id) ON DELETE CASCADE,
  FOREIGN KEY (label_id, space_id) REFERENCES labels (id, space_id) ON DELETE CASCADE,
  FOREIGN KEY (space_id, org_id) REFERENCES spaces (id, org_id) ON DELETE CASCADE
);

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON boards
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE space_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON space_counters
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE space_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_statuses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON space_statuses
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_items
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON labels
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE work_item_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_item_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_item_labels
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON boards, space_counters, space_statuses, work_items, labels, work_item_labels TO crew_app;
  END IF;
END $$;

-- Every space gets a board, an item counter and the four default statuses the moment it is created,
-- whichever code path creates it (API, seed, tests). It runs with the caller tenant context.
CREATE FUNCTION spaces_seed_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO boards (org_id, space_id) VALUES (NEW.org_id, NEW.id);
  INSERT INTO space_counters (space_id, org_id) VALUES (NEW.id, NEW.org_id);
  INSERT INTO space_statuses (org_id, space_id, name, category, position, color) VALUES
    (NEW.org_id, NEW.id, 'To Do', 'todo', 0, 'slate'),
    (NEW.org_id, NEW.id, 'In Progress', 'in_progress', 1, 'blue'),
    (NEW.org_id, NEW.id, 'In Review', 'in_progress', 2, 'violet'),
    (NEW.org_id, NEW.id, 'Done', 'done', 3, 'green');
  RETURN NEW;
END $$;
CREATE TRIGGER spaces_seed_work AFTER INSERT ON spaces FOR EACH ROW EXECUTE FUNCTION spaces_seed_work();

-- Backfill spaces that already exist (idempotent: skips spaces that already have a board).
DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT id, org_id FROM spaces WHERE NOT EXISTS (SELECT 1 FROM boards b WHERE b.space_id = spaces.id) LOOP
    PERFORM set_config('app.current_org', s.org_id::text, true);
    INSERT INTO boards (org_id, space_id) VALUES (s.org_id, s.id);
    INSERT INTO space_counters (space_id, org_id) VALUES (s.id, s.org_id);
    INSERT INTO space_statuses (org_id, space_id, name, category, position, color) VALUES
      (s.org_id, s.id, 'To Do', 'todo', 0, 'slate'),
      (s.org_id, s.id, 'In Progress', 'in_progress', 1, 'blue'),
      (s.org_id, s.id, 'In Review', 'in_progress', 2, 'violet'),
      (s.org_id, s.id, 'Done', 'done', 3, 'green');
  END LOOP;
END $$;
