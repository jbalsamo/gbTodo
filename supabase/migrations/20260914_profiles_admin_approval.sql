-- Documentation of profiles + admin approval already applied on Supabase project
-- zqefdxmhkgnccnhxjktq (gbTodo production). Records live schema/RLS for the repo;
-- it is not a destructive recreate of auth.users or existing data.
--
-- Live state (2026-09-14):
--   - public.profiles: id→auth.users, email, role (user|admin), status (pending|approved|rejected)
--   - Trigger creates profile on signup; graywulf70@gmail.com → admin + approved
--   - Existing users backfilled approved; new signups default pending
--   - Helpers is_approved(), is_admin(); todos RLS requires approved
--   - Confirm email disabled separately in Auth settings (no magic-mail needed)
--
-- Idempotent: safe to re-apply; does not DROP TABLE with CASCADE on user data.

-- Role / status enums (or recreate as text + check if enums already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'profile_role' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.profile_role AS ENUM ('user', 'admin');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'profile_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.profile_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.profile_role NOT NULL DEFAULT 'user',
  status public.profile_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_status_idx ON public.profiles (status);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);

-- Keep email unique for admin listing / lookups (case-insensitive via lower())
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_uidx
  ON public.profiles (lower(email));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC;
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;

-- Helpers used by RLS (security definer so policies can call them safely)
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.status = 'approved'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_approved() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Profile policies
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS profiles_update_admin_status ON public.profiles;
CREATE POLICY profiles_update_admin_status
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- No client INSERT: profiles are created only by the signup trigger.
DROP POLICY IF EXISTS profiles_insert_none ON public.profiles;

-- Signup trigger: create profile; special-case admin email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_role public.profile_role := 'user';
  new_status public.profile_status := 'pending';
BEGIN
  IF lower(coalesce(NEW.email, '')) = lower('graywulf70@gmail.com') THEN
    new_role := 'admin';
    new_status := 'approved';
  END IF;

  INSERT INTO public.profiles (id, email, role, status)
  VALUES (NEW.id, coalesce(NEW.email, ''), new_role, new_status)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill existing auth users as approved (except leave admin email as admin+approved)
INSERT INTO public.profiles (id, email, role, status)
SELECT
  u.id,
  coalesce(u.email, ''),
  CASE
    WHEN lower(coalesce(u.email, '')) = lower('graywulf70@gmail.com')
      THEN 'admin'::public.profile_role
    ELSE 'user'::public.profile_role
  END,
  'approved'::public.profile_status
FROM auth.users u
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      role = CASE
        WHEN lower(EXCLUDED.email) = lower('graywulf70@gmail.com')
          THEN 'admin'::public.profile_role
        ELSE public.profiles.role
      END,
      status = CASE
        WHEN lower(EXCLUDED.email) = lower('graywulf70@gmail.com')
          THEN 'approved'::public.profile_status
        ELSE public.profiles.status
      END,
      updated_at = now();

-- Todos RLS: own rows AND approved
DROP POLICY IF EXISTS todos_select_own ON public.todos;
CREATE POLICY todos_select_own
  ON public.todos
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.is_approved()
  );

DROP POLICY IF EXISTS todos_insert_own ON public.todos;
CREATE POLICY todos_insert_own
  ON public.todos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.is_approved()
  );

DROP POLICY IF EXISTS todos_update_own ON public.todos;
CREATE POLICY todos_update_own
  ON public.todos
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.is_approved()
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.is_approved()
  );

DROP POLICY IF EXISTS todos_delete_own ON public.todos;
CREATE POLICY todos_delete_own
  ON public.todos
  FOR DELETE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.is_approved()
  );
