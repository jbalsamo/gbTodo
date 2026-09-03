import { useState, type FormEvent } from "react";

type Todo = {
  id: number;
  text: string;
  completed: boolean;
};

type Filter = "all" | "active";

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [nextId, setNextId] = useState(1);

  const visibleTodos = todos.filter(
    (todo) => filter === "all" || !todo.completed,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      return;
    }

    setTodos((current) => [
      ...current,
      { id: nextId, text, completed: false },
    ]);
    setNextId((current) => current + 1);
    setDraft("");
  }

  function toggleTodo(id: number) {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo,
      ),
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.18),_transparent_55%)]" />
      <main className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12 sm:px-6">
        <section className="rounded-2xl border border-white/10 bg-zinc-900/80 p-8 shadow-2xl shadow-violet-950/40 backdrop-blur">
          <header className="mb-8">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-400">
              gbTodo
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              What needs doing?
            </h1>
            <p className="mt-2 text-zinc-400">
              Capture tasks, tick them off, and focus on what is still open.
            </p>
          </header>

          <form className="space-y-2" onSubmit={handleSubmit}>
            <label
              htmlFor="new-todo"
              className="block text-sm font-medium text-zinc-300"
            >
              New todo
            </label>
            <div className="flex gap-2">
              <input
                id="new-todo"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a task"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/40"
              />
              <button
                type="submit"
                className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                Add
              </button>
            </div>
          </form>

          <div
            role="radiogroup"
            aria-label="Filter"
            className="mt-6 flex rounded-xl bg-zinc-800 p-1"
          >
            <label
              className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium transition ${
                filter === "all"
                  ? "bg-violet-600 text-white shadow"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <input
                type="radio"
                name="todo-filter"
                value="all"
                checked={filter === "all"}
                onChange={() => setFilter("all")}
                className="sr-only"
              />
              All
            </label>
            <label
              className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium transition ${
                filter === "active"
                  ? "bg-violet-600 text-white shadow"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <input
                type="radio"
                name="todo-filter"
                value="active"
                checked={filter === "active"}
                onChange={() => setFilter("active")}
                className="sr-only"
              />
              Active
            </label>
          </div>

          {visibleTodos.length === 0 ? (
            <p
              role="status"
              className="mt-8 rounded-xl border border-dashed border-zinc-700 px-4 py-8 text-center text-zinc-400"
            >
              No todos yet
            </p>
          ) : (
            <ul className="mt-6 space-y-2">
              {visibleTodos.map((todo) => (
                <li key={todo.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-800/60 px-4 py-3 transition hover:border-zinc-700 ${
                      todo.completed ? "opacity-70" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={() => toggleTodo(todo.id)}
                      className="size-5 shrink-0 rounded border-zinc-600 accent-violet-500"
                    />
                    <span
                      className={`text-base ${
                        todo.completed
                          ? "text-zinc-500 line-through"
                          : "text-zinc-100"
                      }`}
                    >
                      {todo.text}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
