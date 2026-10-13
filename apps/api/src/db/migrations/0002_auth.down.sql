DROP FUNCTION IF EXISTS auth_user_orgs(uuid);
DROP FUNCTION IF EXISTS auth_user_id_by_email(text);
DROP FUNCTION IF EXISTS auth_pending_invitation(uuid, text);
DROP FUNCTION IF EXISTS auth_invitation_by_hash(text);
DROP FUNCTION IF EXISTS auth_user_by_email(uuid, text);
DROP FUNCTION IF EXISTS auth_org_by_id(uuid);
DROP FUNCTION IF EXISTS auth_org_by_slug(text);
DROP TABLE IF EXISTS invitations;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
