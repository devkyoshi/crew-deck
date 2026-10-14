DROP FUNCTION signup_request_peek(text);
CREATE FUNCTION signup_request_peek(p_hash text)
  RETURNS TABLE (email text, company text, slug text, has_account boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT r.email, r.company, r.slug,
           EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(r.email))
    FROM signup_requests r
    WHERE r.token_hash = p_hash AND r.used_at IS NULL AND r.expires_at > now()
  $$;
REVOKE ALL ON FUNCTION signup_request_peek(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    GRANT EXECUTE ON FUNCTION signup_request_peek(text) TO crew_app;
  END IF;
END $$;
