# gbTodo

A multi-user todo list with Supabase email/password auth, admin approval gating, and cloud-backed CRUD. Earth-tone light/dark theme with a Logo A header brand row.

Stack: React 19, Vite, TypeScript, Tailwind CSS, `@supabase/supabase-js` (SPA only). Tests: Vitest + Testing Library with a mocked Supabase client.

## Prerequisites

- Node.js 20 (the version GitHub Actions uses)
- npm
- A Supabase project named **gbTodo** with:
  - Email auth enabled (**Confirm email** turned **off** for password sign-up without magic mail)
  - Table `public.todos` with columns `id`, `text`, `completed`, `user_id`, `due_date`, `priority`
  - Table `public.profiles` with `id`, `email`, `role` (`user`|`admin`), `status` (`pending`|`approved`|`rejected`)
  - RLS so each user only reads/writes their own todos when approved; admins manage profile status

See `supabase/migrations/20260904_todos_rls.sql` for the base todos policy shape, `supabase/migrations/20260913_todo_due_date_priority.sql` for due date / priority, and `supabase/migrations/20260914_profiles_admin_approval.sql` for profiles, helpers, and approval-gated todos RLS.

## Setup

```bash
git clone https://github.com/jbalsamo/gbTodo.git
cd gbTodo
npm install
cp .env.example .env.local
```

Edit `.env.local` (never commit it):

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
```

Values come from the Supabase dashboard under **Project Settings → API**. The legacy name `VITE_SUPABASE_ANON_KEY` is still accepted if `VITE_SUPABASE_PUBLISHABLE_KEY` is unset.

### Supabase Auth (dashboard)

1. **Authentication → Providers** — enable Email (password).
2. **Authentication → Providers → Email** — turn **Confirm email** **off** so register/sign-in work without a confirmation message (this app no longer uses magic-link as the primary flow).
3. **Authentication → URL Configuration** — set Site URL / Redirect URLs to include `http://localhost:5173` (and your deploy origin when you have one).

Initial admin account: **graywulf70@gmail.com** is provisioned as `role=admin` and `status=approved` by the signup trigger / backfill in `20260914_profiles_admin_approval.sql`. New signups default to `pending` until an admin approves them.

### Run the app

```bash
npm run dev
```

Vite prints a local URL (usually `http://localhost:5173`). Open it in a browser.

### Tests

```bash
npm test
```

That runs `vitest run` once. Watch mode:

```bash
npm run test:watch
```

### Other scripts

- `npm run build` — typecheck (`tsc -b`) then production build
- `npm run preview` — serve the production build
- `npm run lint` — oxlint

## Deploy (Vercel)

This is a Vite SPA. [`vercel.json`](vercel.json) rewrites all routes to `/index.html` so deep links work.

- Framework preset: Vite
- Build: `npm run build`
- Output: `dist`

Set these on the Vercel project for **Production** and **Preview** (Project Settings → Environment Variables):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

`VITE_SUPABASE_ANON_KEY` is still accepted as an alias if `VITE_SUPABASE_PUBLISHABLE_KEY` is unset. Vite inlines them at build time, so they must be present for both Production and Preview builds.

After you have a deploy origin, add it to Supabase **Authentication → URL Configuration** (Site URL / Redirect URLs).

## Features

- **Logo A header** — brand row with `public/gbtodo-logo.png`, heading **Your Tasks Completed**, short subtitle, earth-tone light default, and a light/dark toggle at the top.
- **Email/password auth** — Sign in / Register tabs with email + password (`signInWithPassword` / `signUp`). Magic-link is not the primary UI. Signed-in email is shown; sign-out still does global then local session wipe.
- **Admin approval** — after auth, the app loads `profiles` for the current user. `pending` / `rejected` users see a status screen (no todos). `approved` users get the todo app. Admins (`role=admin` and approved) see an **Admin approval** panel to Approve / Reject other profiles. Seeded admin: `graywulf70@gmail.com`.
- **Cloud todos** — select / insert / update / delete on `public.todos` for approved users only; `user_id` is set from the session on insert. RLS also requires `is_approved()`.
- **Add** from **New todo** with **Add** or Enter. Whitespace-only input is ignored.
- **Toggle** complete via the checkbox labeled by the todo text.
- **Due date & priority** — optional `due_date` (YYYY-MM-DD) and `priority` (`none` | `low` | `medium` | `high`). New todos default to `none` / no due date; set them after expand. Incomplete list sorts by due date (soonest first, nulls last), then priority high→low, then id. See `supabase/migrations/20260913_todo_due_date_priority.sql`.
- **Compact rows** — default row shows checkbox, truncated title, priority chip (if not none), and an overdue/due-soon hint. Click the row (not the checkbox) to expand; expanded view has due date, priority, edit text / save / cancel, and delete. Only one row expands at a time; Escape or Cancel closes it (Cancel clears edit drafts the same as collapsing).
- **Edit** and **Delete** live in the expanded row; **Clear completed** when any completed todos exist.
- **Filters**: All (default), Active, Completed.
- Empty / loading / error states use accessible `status` / `alert` roles.

Not in this app yet: Realtime sync, shared lists, Google OAuth, or anonymous auth.

## Tests and CI

Contract tests in `src/App.test.tsx` cover password register/sign-in, the approval gate (pending blocks todos; approved sees the list), admin approve + non-admin without admin UI, empty state, add / mark done, edit / delete / clear completed, All / Active / Completed filters, theme toggle, and the Logo A brand header. Supabase is mocked with `vi.mock("@/lib/supabase")` so tests never hit the network.

Vitest runs in happy-dom. Setup is `src/test/setup.ts`.

GitHub Actions [`.github/workflows/test.yml`](.github/workflows/test.yml) runs on every pull request and on pushes to `main`:

```bash
npm ci
npm test
```

Node 20, with the npm cache enabled.

## Contributing

1. Branch from `main` using `feature/` or `fix/` prefixes. Open a PR into `main` — no direct pushes to `main`.
2. `npm install`, then `npm test` before you push.
3. Keep the contract tests green. If you change auth, CRUD, filters, or theme behavior, add or update cases in `src/App.test.tsx`.
4. CI must pass before merge.
