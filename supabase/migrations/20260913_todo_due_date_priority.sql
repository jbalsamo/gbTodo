-- Documentation of due_date + priority already applied on Supabase project
-- zqefdxmhkgnccnhxjktq (gbTodo production). Records live schema for the repo;
-- it is not a destructive recreate of the todos table or data.
--
-- Live state verified 2026-09-13:
--   - enum public.todo_priority ('none','low','medium','high')
--   - columns: due_date date nullable, priority todo_priority not null default 'none'
--   - indexes on (user_id, due_date) and (user_id, priority)
--
-- Idempotent: safe to re-apply; does not DROP TABLE or truncate rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'todo_priority' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.todo_priority AS ENUM ('none', 'low', 'medium', 'high');
  END IF;
END $$;

ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS priority public.todo_priority NOT NULL DEFAULT 'none';

CREATE INDEX IF NOT EXISTS todos_user_id_due_date_idx
  ON public.todos (user_id, due_date);

CREATE INDEX IF NOT EXISTS todos_user_id_priority_idx
  ON public.todos (user_id, priority);
