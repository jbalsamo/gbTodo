import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Todo = {
  id: string;
  text: string;
  completed: boolean;
};

type Filter = "all" | "active" | "completed";

type TodoRow = {
  id: string;
  text: string;
  completed: boolean;
  user_id: string;
};

function mapRow(row: TodoRow): Todo {
  return {
    id: row.id,
    text: row.text,
    completed: row.completed,
  };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [dark, setDark] = useState(false);
  const [email, setEmail] = useState("");
  const [magicLinkStatus, setMagicLinkStatus] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const user: User | null = session?.user ?? null;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    return () => {
      root.classList.remove("dark");
    };
  }, [dark]);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) {
        setError(sessionError.message);
      }
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) {
        setTodos([]);
        setError(null);
        setEditingId(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setTodos([]);
      setTodosLoading(false);
      return;
    }

    const requestedUserId = user.id;
    let cancelled = false;

    async function loadTodosForUser() {
      setTodosLoading(true);
      setError(null);
      const { data, error: loadError } = await supabase
        .from("todos")
        .select("id, text, completed, user_id")
        .eq("user_id", requestedUserId)
        .order("id", { ascending: true });

      // Ignore stale results if the user signed out or switched accounts
      // while this request was in flight.
      if (cancelled) return;

      if (loadError) {
        setError(loadError.message);
        setTodos([]);
      } else {
        setTodos(((data ?? []) as TodoRow[]).map(mapRow));
      }
      setTodosLoading(false);
    }

    void loadTodosForUser();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const visibleTodos = todos.filter((todo) => {
    if (filter === "active") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });

  const hasCompleted = todos.some((todo) => todo.completed);

  async function handleMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setAuthBusy(true);
    setMagicLinkStatus(null);
    setError(null);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    setAuthBusy(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setMagicLinkStatus(
      "Check your email for a magic link to sign in.",
    );
  }

  async function handleSignOut() {
    setAuthBusy(true);
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();
    setAuthBusy(false);
    if (signOutError) {
      setError(signOutError.message);
      return;
    }
    setTodos([]);
    setMagicLinkStatus(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    const text = draft.trim();
    if (!text) return;

    setError(null);
    const { data, error: insertError } = await supabase
      .from("todos")
      .insert({
        text,
        completed: false,
        user_id: user.id,
      })
      .select("id, text, completed, user_id")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setTodos((current) => [...current, mapRow(data as TodoRow)]);
    setDraft("");
  }

  async function toggleTodo(id: string) {
    if (!user) return;
    const current = todos.find((todo) => todo.id === id);
    if (!current) return;

    setError(null);
    const { data, error: updateError } = await supabase
      .from("todos")
      .update({ completed: !current.completed })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, text, completed, user_id")
      .single();

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setTodos((list) =>
      list.map((todo) => (todo.id === id ? mapRow(data as TodoRow) : todo)),
    );
  }

  function startEdit(todo: Todo) {
    setEditingId(todo.id);
    setEditDraft(todo.text);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !editingId) return;

    const text = editDraft.trim();
    if (!text) return;

    setError(null);
    const { data, error: updateError } = await supabase
      .from("todos")
      .update({ text })
      .eq("id", editingId)
      .eq("user_id", user.id)
      .select("id, text, completed, user_id")
      .single();

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setTodos((list) =>
      list.map((todo) =>
        todo.id === editingId ? mapRow(data as TodoRow) : todo,
      ),
    );
    cancelEdit();
  }

  async function deleteTodo(id: string) {
    if (!user) return;
    setError(null);
    const { error: deleteError } = await supabase
      .from("todos")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setTodos((list) => list.filter((todo) => todo.id !== id));
    if (editingId === id) cancelEdit();
  }

  async function clearCompleted() {
    if (!user) return;
    setError(null);
    const { error: deleteError } = await supabase
      .from("todos")
      .delete()
      .eq("user_id", user.id)
      .eq("completed", true);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setTodos((list) => list.filter((todo) => !todo.completed));
  }

  const controlClass =
    "rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-800 dark:border-orange-950 dark:bg-[#2a1c14] dark:text-amber-100 dark:hover:bg-[#3d2a1f] dark:focus-visible:ring-orange-400";

  const filterLabelClass = (active: boolean) =>
    `flex-1 cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium transition ${
      active
        ? "bg-orange-800 text-amber-50 shadow dark:bg-orange-700"
        : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
    }`;

  return (
    <div className="relative min-h-screen bg-stone-100 text-stone-800 antialiased dark:bg-[#1c120c] dark:text-stone-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(196,149,90,0.28),_transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(154,80,40,0.32),_transparent_55%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col px-4 py-6 sm:px-6">
        <div className="flex items-center justify-end gap-2">
          {user ? (
            <>
              <p
                className="mr-auto truncate text-sm text-stone-600 dark:text-stone-400"
                aria-live="polite"
              >
                Signed in as {user.email}
              </p>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={authBusy}
                className={controlClass}
              >
                Sign out
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setDark((current) => !current)}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className={controlClass}
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
                  alt=""
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

            {!authReady ? (
              <p
                role="status"
                className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-stone-500 dark:border-stone-700 dark:text-stone-400"
              >
                Checking session…
              </p>
            ) : !user ? (
              <div className="space-y-4">
                <form className="space-y-2" onSubmit={handleMagicLink}>
                  <label
                    htmlFor="magic-link-email"
                    className="block text-sm font-medium text-stone-700 dark:text-stone-300"
                  >
                    Email
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="magic-link-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      required
                      className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 placeholder:text-stone-400 outline-none transition focus:border-orange-800 focus:ring-2 focus:ring-orange-800/30 dark:border-stone-700 dark:bg-[#1c120c] dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-orange-400 dark:focus:ring-orange-400/30"
                    />
                    <button
                      type="submit"
                      disabled={authBusy}
                      className="rounded-xl bg-orange-800 px-4 py-3 text-sm font-semibold text-amber-50 shadow-lg shadow-orange-900/20 transition hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-700 disabled:opacity-60 dark:bg-orange-700 dark:hover:bg-orange-600 dark:focus-visible:ring-orange-400"
                    >
                      Send magic link
                    </button>
                  </div>
                </form>
                {magicLinkStatus ? (
                  <p
                    role="status"
                    className="rounded-xl border border-stone-200 bg-white/70 px-4 py-3 text-sm text-stone-600 dark:border-stone-700 dark:bg-[#1c120c]/70 dark:text-stone-300"
                  >
                    {magicLinkStatus}
                  </p>
                ) : null}
                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                  >
                    {error}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
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
                  <label className={filterLabelClass(filter === "all")}>
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
                  <label className={filterLabelClass(filter === "active")}>
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
                  <label className={filterLabelClass(filter === "completed")}>
                    <input
                      type="radio"
                      name="todo-filter"
                      value="completed"
                      checked={filter === "completed"}
                      onChange={() => setFilter("completed")}
                      className="sr-only"
                    />
                    Completed
                  </label>
                </div>

                {hasCompleted ? (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void clearCompleted()}
                      className="text-sm font-medium text-orange-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-800 dark:text-amber-200 dark:focus-visible:ring-orange-400"
                    >
                      Clear completed
                    </button>
                  </div>
                ) : null}

                {error ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                  >
                    {error}
                  </p>
                ) : null}

                {todosLoading ? (
                  <p
                    role="status"
                    className="mt-8 rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-stone-500 dark:border-stone-700 dark:text-stone-400"
                  >
                    Loading todos…
                  </p>
                ) : visibleTodos.length === 0 ? (
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
                        {editingId === todo.id ? (
                          <form
                            className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white/80 px-4 py-3 dark:border-stone-800 dark:bg-[#1c120c]/70 sm:flex-row sm:items-center"
                            onSubmit={saveEdit}
                          >
                            <label className="sr-only" htmlFor={`edit-${todo.id}`}>
                              Edit todo
                            </label>
                            <input
                              id={`edit-${todo.id}`}
                              value={editDraft}
                              onChange={(event) =>
                                setEditDraft(event.target.value)
                              }
                              className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 outline-none focus:border-orange-800 focus:ring-2 focus:ring-orange-800/30 dark:border-stone-700 dark:bg-[#1c120c] dark:text-stone-100 dark:focus:border-orange-400"
                            />
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                className="rounded-lg bg-orange-800 px-3 py-2 text-sm font-semibold text-amber-50 dark:bg-orange-700"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-200"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div
                            className={`flex items-center gap-2 rounded-xl border border-stone-200 bg-white/80 px-4 py-3 transition hover:border-stone-300 dark:border-stone-800 dark:bg-[#1c120c]/70 dark:hover:border-stone-700 ${
                              todo.completed ? "opacity-70" : ""
                            }`}
                          >
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                              <input
                                type="checkbox"
                                checked={todo.completed}
                                onChange={() => void toggleTodo(todo.id)}
                                className="size-5 shrink-0 rounded border-stone-400 accent-orange-800 dark:border-stone-600 dark:accent-orange-500"
                              />
                              <span
                                className={`truncate text-base ${
                                  todo.completed
                                    ? "text-stone-400 line-through dark:text-stone-500"
                                    : "text-stone-800 dark:text-stone-100"
                                }`}
                              >
                                {todo.text}
                              </span>
                            </label>
                            <button
                              type="button"
                              aria-label={`Edit ${todo.text}`}
                              onClick={() => startEdit(todo)}
                              className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-800 dark:text-stone-300 dark:hover:bg-[#3d2a1f] dark:focus-visible:ring-orange-400"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${todo.text}`}
                              onClick={() => void deleteTodo(todo.id)}
                              className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:text-red-300 dark:hover:bg-red-950/40 dark:focus-visible:ring-red-400"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
