# gbTodo

A multi-user todo list with Supabase email magic-link auth and cloud-backed CRUD. Earth-tone light/dark theme with a Logo A header brand row.

Stack: React 19, Vite, TypeScript, Tailwind CSS, `@supabase/supabase-js` (SPA only). Tests: Vitest + Testing Library with a mocked Supabase client.

## Prerequisites

- Node.js 20 (the version GitHub Actions uses)
- npm
- A Supabase project named **gbTodo** with:
  - Email auth enabled
  - Table `public.todos` with columns `id`, `text`, `completed`, `user_id`
  - RLS so each user only reads/writes their own rows (`auth.uid() = user_id`)

See `supabase/migrations/20260904_todos_rls.sql` for the documented policy shape.

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

1. **Authentication → Providers** — enable Email.
2. **Authentication → URL Configuration** — set Site URL / Redirect URLs to include `http://localhost:5173` (and your deploy origin when you have one).
3. Confirm email templates / SMTP if magic links do not arrive.

Without step 2, magic-link redirects will fail after you click the email.

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

## Features

- **Logo A header** — brand row with `public/gbtodo-logo.png`, heading **Your Tasks Completed**, short subtitle, earth-tone light default, and a light/dark toggle at the top.
- **Magic-link auth** — enter email, **Send magic link** (`signInWithOtp`), then sign out when done. Signed-in email is shown. Todo CRUD is gated behind a session; signed-out users only see the auth form.
- **Cloud todos** — select / insert / update / delete on `public.todos`; `user_id` is set from the session on insert.
- **Add** from **New todo** with **Add** or Enter. Whitespace-only input is ignored.
- **Toggle** complete via the checkbox labeled by the todo text.
- **Edit** and **Delete** per item; **Clear completed** when any completed todos exist.
- **Filters**: All (default), Active, Completed.
- Empty / loading / error states use accessible `status` / `alert` roles.

Not in this app yet: Realtime sync, shared lists, Google OAuth, anonymous auth, or Vercel deploy.

## Tests and CI

Contract tests in `src/App.test.tsx` cover the auth gate, empty state, add / mark done, edit / delete / clear completed, All / Active / Completed filters, theme toggle, and the Logo A brand header. Supabase is mocked with `vi.mock("@/lib/supabase")` so tests never hit the network.

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
