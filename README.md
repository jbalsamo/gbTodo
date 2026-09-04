# gbTodo

A small todo list with Supabase email magic-link auth and cloud-backed CRUD. Earth-tone light/dark theme, Logo A header brand row.

Stack: React 19, Vite, TypeScript, Tailwind CSS, @supabase/supabase-js (SPA only). Tests: Vitest + Testing Library (mocked Supabase).

## Prerequisites

- Node.js 20
- npm
- Supabase public.todos RLS by user_id; columns id, text, completed, user_id.

## Setup

```bash
git clone https://github.com/jbalsamo/gbTodo.git
cd gbTodo
npm install
cp .env.example .env.local
```

Edit .env.local (never commit it):

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
```

Legacy VITE_SUPABASE_ANON_KEY is accepted if PUBLISHABLE_KEY is unset.

### Supabase Auth (dashboard)

1. Authentication -> Providers -> Email enabled.
2. Authentication -> URL Configuration -> add http://localhost:5173 to Redirect URLs / Site URL.
3. Confirm email templates / SMTP if magic links do not arrive.

### Run the app

```bash
npm run dev
```

Vite prints a local URL (usually http://localhost:5173).

### Tests

```bash
npm test
```

Watch mode: `npm run test:watch`.

### Other scripts

- `npm run build` - typecheck then production build
- `npm run preview` - serve the production build
- `npm run lint` - oxlint

## Features

- Auth: email magic link (signInWithOtp) and sign out. Signed-in email shown. Todo CRUD gated behind session.
- Cloud todos: select/insert/update/delete on public.todos; user_id from session on insert.
- Add via New todo with Add or Enter. Whitespace-only ignored.
- Toggle complete; Edit text; Delete item; Clear completed.
- Filters: All, Active, Completed.
- Empty/loading/error use status/alert roles.
- Logo A brand row and earth-tone theme toggle kept.

Out of scope: Realtime, shared lists, Google OAuth, anonymous auth, Vercel deploy.

## Tests and CI

Contract tests in src/App.test.tsx cover auth gate, CRUD, filters, theme, brand header. Supabase mocked via vi.mock("@/lib/supabase").

GitHub Actions .github/workflows/test.yml runs on PRs and pushes to main.

## Contributing

1. Branch from main.
2. Install deps, then run tests before push.
3. Keep contract tests green.
4. Open a pull request. CI must pass.
