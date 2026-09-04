import { useEffect, useState, type FormEvent } from "react";

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
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    return () => {
      root.classList.remove("dark");
    };
  }, [dark]);

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
    <div className="relative min-h-screen bg-stone-100 text-stone-800 antialiased dark:bg-[#1c120c] dark:text-stone-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(196,149,90,0.28),_transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(154,80,40,0.32),_transparent_55%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col px-4 py-6 sm:px-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setDark((current) => !current)}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-800 dark:border-orange-950 dark:bg-[#2a1c14] dark:text-amber-100 dark:hover:bg-[#3d2a1f] dark:focus-visible:ring-orange-400"
          >
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>

        <main className="flex flex-1 flex-col justify-center py-6">
          <section
            aria-label={dark ? "Dark theme" : "Light theme"}
            className="rounded-2xl border border-stone-200 bg-[#faf6f0]/90 p-8 shadow-xl shadow-stone-400/25 backdrop-blur dark:border-orange-950/70 dark:bg-[#2a1c14]/90 dark:shadow-black/40"
          >
            <header className="mb-8">
              <div className="flex items-center gap-3">
                <img
                  src="/gbtodo-logo.png"
                  alt="gbTodo"
                  width={48}
                  height={32}
                  className="h-10 w-auto shrink-0 rounded-lg"
                />
                <p className="text-xl font-semibold tracking-tight text-stone-800 dark:text-amber-100">
                  gbTodo
                </p>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl dark:text-amber-50">
                Your Tasks Completed
              </h1>
              <p className="mt-2 text-stone-600 dark:text-stone-400">
                Add tasks and tick them off.
              </p>
            </header>

            <form className="space-y-2" onSubmit={handleSubmit}>
              <label
                htmlFor="new-todo"
                className="block text-sm font-medium text-stone-700 dark:text-stone-300"
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
                  className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 placeholder:text-stone-400 outline-none transition focus:border-orange-800 focus:ring-2 focus:ring-orange-800/30 dark:border-stone-700 dark:bg-[#1c120c] dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-orange-400 dark:focus:ring-orange-400/30"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-orange-800 px-4 py-3 text-sm font-semibold text-amber-50 shadow-lg shadow-orange-900/20 transition hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600 dark:focus-visible:ring-orange-400"
                >
                  Add
                </button>
              </div>
            </form>

            <div
              role="radiogroup"
              aria-label="Filter"
              className="mt-6 flex rounded-xl bg-stone-200/80 p-1 dark:bg-[#1c120c]"
            >
              <label
                className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium transition ${
                  filter === "all"
                    ? "bg-orange-800 text-amber-50 shadow dark:bg-orange-700"
                    : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
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
                    ? "bg-orange-800 text-amber-50 shadow dark:bg-orange-700"
                    : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
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
                className="mt-8 rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-stone-500 dark:border-stone-700 dark:text-stone-400"
              >
                No todos yet
              </p>
            ) : (
              <ul className="mt-6 space-y-2">
                {visibleTodos.map((todo) => (
                  <li key={todo.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border border-stone-200 bg-white/80 px-4 py-3 transition hover:border-stone-300 dark:border-stone-800 dark:bg-[#1c120c]/70 dark:hover:border-stone-700 ${
                        todo.completed ? "opacity-70" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={() => toggleTodo(todo.id)}
                        className="size-5 shrink-0 rounded border-stone-400 accent-orange-800 dark:border-stone-600 dark:accent-orange-500"
                      />
                      <span
                        className={`text-base ${
                          todo.completed
                            ? "text-stone-400 line-through dark:text-stone-500"
                            : "text-stone-800 dark:text-stone-100"
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
    </div>
  );
}
