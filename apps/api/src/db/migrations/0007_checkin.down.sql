DROP FUNCTION IF EXISTS auth_list_org_ids();
DROP TABLE IF EXISTS work_day_edits;
DROP TABLE IF EXISTS work_days;
DROP TABLE IF EXISTS holidays;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS tenant_settings;
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_not_own_manager;
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_reports_to_fk;
ALTER TABLE memberships DROP COLUMN IF EXISTS reports_to;
