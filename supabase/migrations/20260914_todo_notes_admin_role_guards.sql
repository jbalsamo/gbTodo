-- Matching production (zqefdxmhkgnccnhxjktq) as of 2026-09-14:
--   1. public.todos.notes text null
--   2. set_profile_status hardened: admin-only; cannot change own status;
--      cannot change status of last approved admin away from approved
--   3. set_profile_role(target_id, new_role): admin-only; cannot change own role;
--      only if target.status = approved; cannot demote last approved admin
--   4. Last-admin checks lock approved-admin rows (FOR UPDATE) before count/update
--      so concurrent demote/reject cannot both pass.
-- Idempotent / safe to re-apply.

ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS notes text NULL;

-- Hardened admin status RPC
CREATE OR REPLACE FUNCTION public.set_profile_status(
  target_id uuid,
  new_status public.profile_status
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_row public.profiles;
  target_row public.profiles;
  approved_admin_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot change own status';
  END IF;

  IF new_status IS DISTINCT FROM 'approved'::public.profile_status
     AND new_status IS DISTINCT FROM 'rejected'::public.profile_status THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  -- Lock target row before read/count/update so concurrent callers serialize.
  SELECT * INTO target_row
  FROM public.profiles
  WHERE id = target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  -- Protect the last approved admin from being moved off approved.
  IF target_row.role = 'admin'::public.profile_role
     AND target_row.status = 'approved'::public.profile_status
     AND new_status IS DISTINCT FROM 'approved'::public.profile_status THEN
    -- Lock all approved-admin rows before counting (aggregate FOR UPDATE is illegal).
    PERFORM 1
    FROM public.profiles p
    WHERE p.role = 'admin'::public.profile_role
      AND p.status = 'approved'::public.profile_status
    FOR UPDATE;

    SELECT count(*)::integer INTO approved_admin_count
    FROM public.profiles p
    WHERE p.role = 'admin'::public.profile_role
      AND p.status = 'approved'::public.profile_status;

    IF approved_admin_count <= 1 THEN
      RAISE EXCEPTION 'cannot change status of last approved admin';
    END IF;
  END IF;

  UPDATE public.profiles
  SET status = new_status,
      updated_at = now()
  WHERE id = target_id
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  RETURN updated_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_status(uuid, public.profile_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_status(uuid, public.profile_status) TO authenticated;

-- Admin role RPC
CREATE OR REPLACE FUNCTION public.set_profile_role(
  target_id uuid,
  new_role public.profile_role
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_row public.profiles;
  target_row public.profiles;
  approved_admin_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot change own role';
  END IF;

  IF new_role IS DISTINCT FROM 'user'::public.profile_role
     AND new_role IS DISTINCT FROM 'admin'::public.profile_role THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  -- Lock target row before read/count/update so concurrent callers serialize.
  SELECT * INTO target_row
  FROM public.profiles
  WHERE id = target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF target_row.status IS DISTINCT FROM 'approved'::public.profile_status THEN
    RAISE EXCEPTION 'target must be approved';
  END IF;

  -- Protect the last approved admin from demotion.
  IF target_row.role = 'admin'::public.profile_role
     AND new_role IS DISTINCT FROM 'admin'::public.profile_role THEN
    PERFORM 1
    FROM public.profiles p
    WHERE p.role = 'admin'::public.profile_role
      AND p.status = 'approved'::public.profile_status
    FOR UPDATE;

    SELECT count(*)::integer INTO approved_admin_count
    FROM public.profiles p
    WHERE p.role = 'admin'::public.profile_role
      AND p.status = 'approved'::public.profile_status;

    IF approved_admin_count <= 1 THEN
      RAISE EXCEPTION 'cannot demote last approved admin';
    END IF;
  END IF;

  UPDATE public.profiles
  SET role = new_role,
      updated_at = now()
  WHERE id = target_id
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  RETURN updated_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_role(uuid, public.profile_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_role(uuid, public.profile_role) TO authenticated;
