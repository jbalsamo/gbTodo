-- Documentation of profiles.settings already applied on Supabase project
-- zqefdxmhkgnccnhxjktq (gbTodo production). Records live schema/RLS for the repo;
-- it is not a destructive recreate of profiles or data.
--
-- Live state (2026-09-16):
--   - public.profiles.settings jsonb NOT NULL DEFAULT '{}'::jsonb
--   - Authenticated users may UPDATE their own row's settings only
--     (policy profiles_update_own_settings); role/status still via RPCs
--
-- Idempotent: safe to re-apply.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Column-scoped UPDATE so clients cannot change role/status/email via table UPDATE.
GRANT UPDATE (settings) ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_update_own_settings ON public.profiles;
CREATE POLICY profiles_update_own_settings
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
