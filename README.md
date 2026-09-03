# gbTodo

A small in-browser todo list: add tasks, mark them done, and filter to what is still open. There is no backend and no persistence — todos live in memory for the session.

Stack: React 19, Vite, TypeScript, Tailwind CSS. Tests: Vitest + Testing Library.

## Prerequisites

- Node.js 20 (the version GitHub Actions uses)
- npm (ships with Node)

## Setup

```bash
git clone https://github.com/jbalsamo/gbTodo.git
cd gbTodo
npm install
```

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

- Add a todo from the **New todo** field with **Add** or Enter. Whitespace-only input is ignored; the field clears after a successful add.
- Each item is a checkbox labeled by its text. Check or uncheck to mark done / not done.
- Filter: **All** (default, including completed) vs **Active** (hides completed).
- Empty list shows an accessible status: “No todos yet”.
- Heading: **Your Tasks Completed**. Subtitle: “Add tasks and tick them off.”
- Earth-tone light theme by default, with a **Dark mode** / **Light mode** toggle at the top of the page.

Not in this app: delete, edit, persistence, a backend, or a Completed-only filter.

## Tests and CI

Contract tests in `src/App.test.tsx` cover empty state, adding, marking done, the All / Active filter, and the light/dark theme toggle. They assert through Testing Library roles (`textbox`, `checkbox`, `radio`, `status`, `button`) rather than implementation details.

Vitest runs in happy-dom. Setup is `src/test/setup.ts` (`@testing-library/jest-dom` plus cleanup after each test).

GitHub Actions [`.github/workflows/test.yml`](.github/workflows/test.yml) runs on every pull request and on pushes to `main`:

```bash
npm ci
npm test
```

Node 20, with the npm cache enabled.

## Contributing

1. Branch from `main`.
2. `npm install`, then `npm test` before you push.
3. Keep the contract tests green. If you change add / done / filter / theme behavior, add or update cases in `src/App.test.tsx`.
4. Open a pull request. CI must pass.
