-- Documentation of Row Level Security already applied on Supabase project
-- zqefdxmhkgnccnhxjktq (gbTodo production). This records live policy state for
-- review; it is not a destructive recreate of the todos table or data.
--
-- Live state verified 2026-09-04:
--   - RLS enabled on public.todos
--   - Policies: select/insert/update/delete own rows via auth.uid() = user_id
--   - Table grants for client roles: authenticated only (anon has none)
--
-- Idempotent: safe to re-apply; does not DROP TABLE or truncate rows.

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

-- Client-facing grants: authenticated CRUD only.
REVOKE ALL ON TABLE public.todos FROM anon;
REVOKE ALL ON TABLE public.todos FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.todos TO authenticated;

DROP POLICY IF EXISTS todos_select_own ON public.todos;
CREATE POLICY todos_select_own
  ON public.todos
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS todos_insert_own ON public.todos;
CREATE POLICY todos_insert_own
  ON public.todos
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS todos_update_own ON public.todos;
CREATE POLICY todos_update_own
  ON public.todos
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS todos_delete_own ON public.todos;
CREATE POLICY todos_delete_own
  ON public.todos
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
