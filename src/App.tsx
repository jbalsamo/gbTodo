import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type TodoPriority = "none" | "low" | "medium" | "high";

export type Todo = {
  id: string;
  text: string;
  completed: boolean;
  due_date: string | null;
  priority: TodoPriority;
};

type Filter = "all" | "active" | "completed";

export type TodoRow = {
  id: string;
  text: string;
  completed: boolean;
  user_id: string;
  due_date: string | null;
  priority: TodoPriority;
};

const TODO_COLUMNS = "id, text, completed, user_id, due_date, priority";

const PRIORITY_RANK: Record<TodoPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const PRIORITY_OPTIONS: TodoPriority[] = ["none", "low", "medium", "high"];

export function mapRow(row: TodoRow): Todo {
  return {
    id: row.id,
    text: row.text,
    completed: Boolean(row.completed),
    due_date: row.due_date ?? null,
    priority: row.priority ?? "none",
  };
}

/** Sort: due_date asc (nulls last), priority high→low, then id. */
export function compareTodos(a: Todo, b: Todo): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date == null) return 1;
    if (b.due_date == null) return -1;
    if (a.due_date < b.due_date) return -1;
    if (a.due_date > b.due_date) return 1;
  }
  const byPriority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (byPriority !== 0) return byPriority;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function sortTodos(list: Todo[]): Todo[] {
  return [...list].sort(compareTodos);
}

/** Local calendar date as YYYY-MM-DD. */
export function localISODate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dueStatus(
  due_date: string | null,
  completed: boolean,
): "overdue" | "due-today" | "due-soon" | null {
  if (!due_date || completed) return null;
  const today = localISODate();
  if (due_date < today) return "overdue";
  if (due_date === today) return "due-today";
  const soon = new Date();
  soon.setDate(soon.getDate() + 2);
  if (due_date <= localISODate(soon)) return "due-soon";
  return null;
}

function priorityLabel(priority: TodoPriority): string {
  if (priority === "none") return "";
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

/** Avoid session state churn when getSession + onAuthStateChange report the same identity. */
function sessionsEquivalent(a: Session | null, b: Session | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.access_token === b.access_token &&
    a.user.id === b.user.id
  );
}

/** Missing/expired server session — local sign-out still succeeded. */
function isBenignSignOutError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("auth session missing") ||
    normalized.includes("session not found") ||
    normalized.includes("session from session_id claim in jwt does not exist")
  );
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editPriority, setEditPriority] = useState<TodoPriority>("none");
  /** Bumps when a todos load is superseded so stale responses are ignored. */
  const todosLoadGenerationRef = useRef(0);

  const user: User | null = session?.user ?? null;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    return () => {
      root.classList.remove("dark");
    };
  }, [dark]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) {
        setError(sessionError.message);
      }
      const next = data.session ?? null;
      setSession((prev) => (sessionsEquivalent(prev, next) ? prev : next));
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession((prev) =>
        sessionsEquivalent(prev, nextSession) ? prev : nextSession,
      );
      setAuthReady(true);
      // Any-tab SIGNED_OUT / session clear: drop leftover chrome so a
      // secondary tab does not keep signed-in UI or stale errors.
      if (!nextSession) {
        setTodos([]);
        setError(null);
        setMagicLinkStatus(null);
        setDraft((current) => (current ? "" : current));
        setExpandedId(null);
        setEditDraft("");
        setEditDueDate("");
        setEditPriority("none");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Depend on user id (not the User object) so getSession + onAuthStateChange
  // identity churn does not re-fetch todos hundreds of times.
  const userId = user?.id;

  useEffect(() => {
    if (!userId || !supabase) {
      setTodos([]);
      setTodosLoading(false);
      return;
    }

    const client = supabase;
    const requestedUserId = userId;
    const requestId = ++todosLoadGenerationRef.current;

    async function loadTodosForUser() {
      setTodosLoading(true);
      setError(null);
      const { data, error: loadError } = await client
        .from("todos")
        .select(TODO_COLUMNS)
        .eq("user_id", requestedUserId)
        .order("id", { ascending: true });

      const isCurrent = requestId === todosLoadGenerationRef.current;

      // Ignore stale todos/error if a newer load superseded this one.
      // Still clear loading only for the active request so we never strand
      // todosLoading=true after StrictMode/auth churn cancels an in-flight load.
      if (!isCurrent) {
        return;
      }

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
      // Invalidate this generation so its response cannot apply todos/error.
      if (todosLoadGenerationRef.current === requestId) {
        todosLoadGenerationRef.current += 1;
      }
      // Clear loading when abandoning an in-flight load. A successor effect
      // that starts a new load will set todosLoading true again immediately.
      setTodosLoading(false);
    };
  }, [userId]);

  const filteredTodos = todos.filter((todo) => {
    if (filter === "active") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });

  // Incomplete first (sorted), then completed (sorted) when showing All.
  const visibleTodos =
    filter === "all"
      ? [
          ...sortTodos(filteredTodos.filter((t) => !t.completed)),
          ...sortTodos(filteredTodos.filter((t) => t.completed)),
        ]
      : sortTodos(filteredTodos);

  const hasCompleted = todos.some((todo) => todo.completed);

  function collapseExpanded() {
    setExpandedId(null);
    setEditDraft("");
    setEditDueDate("");
    setEditPriority("none");
  }

  function expandTodo(todo: Todo) {
    setExpandedId(todo.id);
    setEditDraft(todo.text);
    setEditDueDate(todo.due_date ?? "");
    setEditPriority(todo.priority);
  }

  function handleRowKeyDown(event: KeyboardEvent, todo: Todo) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      expandTodo(todo);
    }
  }

  useEffect(() => {
    if (!expandedId) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        collapseExpanded();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  async function handleMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
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
    if (!supabase) return;
    setAuthBusy(true);
    setError(null);

    const messageFromUnknown = (err: unknown): string => {
      if (err && typeof err === "object" && "message" in err) {
        return String((err as { message: unknown }).message);
      }
      if (err instanceof Error) {
        return err.message;
      }
      return "Sign out failed";
    };

    let signOutError: { message: string } | null = null;
    try {
      // Prefer global so other tabs receive the auth broadcast.
      const result = await supabase.auth.signOut();
      signOutError = result.error;
    } catch (err) {
      signOutError = { message: messageFromUnknown(err) };
    }

    // Missing/expired server session: still clear this tab locally.
    if (signOutError && isBenignSignOutError(signOutError.message)) {
      try {
        const localResult = await supabase.auth.signOut({ scope: "local" });
        signOutError = localResult.error;
      } catch (err) {
        signOutError = { message: messageFromUnknown(err) };
      }
    }

    setAuthBusy(false);

    // Always clear local UI after attempting sign-out so a missing/expired
    // server session cannot leave the user stuck on the signed-in screen.
    setSession(null);
    setTodos([]);
    setMagicLinkStatus(null);
    setDraft("");
    collapseExpanded();

    if (signOutError && !isBenignSignOutError(signOutError.message)) {
      setError(signOutError.message);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !supabase) return;

    const text = draft.trim();
    if (!text) return;

    setError(null);
    const { data, error: insertError } = await supabase
      .from("todos")
      .insert({
        text,
        completed: false,
        user_id: user.id,
        priority: "none",
        due_date: null,
      })
      .select(TODO_COLUMNS)
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setTodos((current) => [...current, mapRow(data as TodoRow)]);
    setDraft("");
  }

  async function toggleTodo(id: string) {
    if (!user || !supabase) return;
    const current = todos.find((todo) => todo.id === id);
    if (!current) return;

    setError(null);
    const { data, error: updateError } = await supabase
      .from("todos")
      .update({ completed: !current.completed })
      .eq("id", id)
      .eq("user_id", user.id)
      .select(TODO_COLUMNS)
      .single();

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setTodos((list) =>
      list.map((todo) => (todo.id === id ? mapRow(data as TodoRow) : todo)),
    );
  }

  async function saveExpanded(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !expandedId || !supabase) return;

    const text = editDraft.trim();
    if (!text) return;

    const due_date = editDueDate.trim() === "" ? null : editDueDate.trim();

    setError(null);
    const { data, error: updateError } = await supabase
      .from("todos")
      .update({
        text,
        due_date,
        priority: editPriority,
      })
      .eq("id", expandedId)
      .eq("user_id", user.id)
      .select(TODO_COLUMNS)
      .single();

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setTodos((list) =>
      list.map((todo) =>
        todo.id === expandedId ? mapRow(data as TodoRow) : todo,
      ),
    );
    collapseExpanded();
  }

  async function deleteTodo(id: string) {
    if (!user || !supabase) return;
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
    if (expandedId === id) collapseExpanded();
  }

  async function clearCompleted() {
    if (!user || !supabase) return;
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

  function priorityChipClass(priority: TodoPriority): string {
    switch (priority) {
      case "high":
        return "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200";
      case "medium":
        return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
      case "low":
        return "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
      default:
        return "";
    }
  }

  function dueHintClass(status: ReturnType<typeof dueStatus>): string {
    if (status === "overdue") {
      return "text-red-700 dark:text-red-300";
    }
    if (status === "due-today" || status === "due-soon") {
      return "text-orange-800 dark:text-amber-300";
    }
    return "text-stone-500 dark:text-stone-400";
  }

  function dueHintText(
    due_date: string | null,
    completed: boolean,
  ): string | null {
    if (!due_date) return null;
    const status = dueStatus(due_date, completed);
    if (status === "overdue") return "Overdue";
    if (status === "due-today") return "Due today";
    if (status === "due-soon") return "Due soon";
    return due_date;
  }

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

            {!isSupabaseConfigured ? (
              <p
                role="alert"
                className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-6 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              >
                Supabase is not configured. Copy .env.example to .env.local, set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart npm run dev.
              </p>
            ) : !authReady ? (
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
                    {visibleTodos.map((todo) => {
                      const isExpanded = expandedId === todo.id;
                      const hint = dueHintText(todo.due_date, todo.completed);
                      const status = dueStatus(todo.due_date, todo.completed);
                      const chip = priorityLabel(todo.priority);

                      return (
                        <li key={todo.id}>
                          {isExpanded ? (
                            <form
                              className="flex flex-col gap-3 rounded-xl border border-orange-800/40 bg-white/90 px-4 py-3 dark:border-orange-700/50 dark:bg-[#1c120c]/80"
                              onSubmit={saveExpanded}
                              data-testid={`expanded-row-${todo.id}`}
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={todo.completed}
                                  onChange={() => void toggleTodo(todo.id)}
                                  aria-label={todo.text}
                                  className="mt-2.5 size-5 shrink-0 rounded border-stone-400 accent-orange-800 dark:border-stone-600 dark:accent-orange-500"
                                />
                                <div className="min-w-0 flex-1 space-y-3">
                                  <div>
                                    <label
                                      className="sr-only"
                                      htmlFor={`edit-${todo.id}`}
                                    >
                                      Edit todo
                                    </label>
                                    <input
                                      id={`edit-${todo.id}`}
                                      value={editDraft}
                                      onChange={(event) =>
                                        setEditDraft(event.target.value)
                                      }
                                      className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 outline-none focus:border-orange-800 focus:ring-2 focus:ring-orange-800/30 dark:border-stone-700 dark:bg-[#1c120c] dark:text-stone-100 dark:focus:border-orange-400"
                                    />
                                  </div>
                                  <div className="flex flex-col gap-2 sm:flex-row">
                                    <div className="min-w-0 flex-1">
                                      <label
                                        htmlFor={`due-${todo.id}`}
                                        className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-400"
                                      >
                                        Due date
                                      </label>
                                      <input
                                        id={`due-${todo.id}`}
                                        type="date"
                                        value={editDueDate}
                                        onChange={(event) =>
                                          setEditDueDate(event.target.value)
                                        }
                                        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-orange-800 focus:ring-2 focus:ring-orange-800/30 dark:border-stone-700 dark:bg-[#1c120c] dark:text-stone-100 dark:focus:border-orange-400"
                                      />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <label
                                        htmlFor={`priority-${todo.id}`}
                                        className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-400"
                                      >
                                        Priority
                                      </label>
                                      <select
                                        id={`priority-${todo.id}`}
                                        value={editPriority}
                                        onChange={(event) =>
                                          setEditPriority(
                                            event.target.value as TodoPriority,
                                          )
                                        }
                                        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-orange-800 focus:ring-2 focus:ring-orange-800/30 dark:border-stone-700 dark:bg-[#1c120c] dark:text-stone-100 dark:focus:border-orange-400"
                                      >
                                        {PRIORITY_OPTIONS.map((option) => (
                                          <option key={option} value={option}>
                                            {option === "none"
                                              ? "None"
                                              : priorityLabel(option)}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="submit"
                                      className="rounded-lg bg-orange-800 px-3 py-2 text-sm font-semibold text-amber-50 dark:bg-orange-700"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={collapseExpanded}
                                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-200"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Collapse ${todo.text}`}
                                      onClick={collapseExpanded}
                                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-200"
                                    >
                                      Collapse
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Delete ${todo.text}`}
                                      onClick={() => void deleteTodo(todo.id)}
                                      className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:text-red-300 dark:hover:bg-red-950/40 dark:focus-visible:ring-red-400"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </form>
                          ) : (
                            <div
                              className={`flex items-center gap-2 rounded-xl border border-stone-200 bg-white/80 px-4 py-3 transition hover:border-stone-300 dark:border-stone-800 dark:bg-[#1c120c]/70 dark:hover:border-stone-700 ${
                                todo.completed ? "opacity-70" : ""
                              }`}
                              data-testid={`compact-row-${todo.id}`}
                            >
                              <input
                                type="checkbox"
                                checked={todo.completed}
                                onChange={() => void toggleTodo(todo.id)}
                                aria-label={todo.text}
                                onClick={(event: MouseEvent) =>
                                  event.stopPropagation()
                                }
                                className="size-5 shrink-0 rounded border-stone-400 accent-orange-800 dark:border-stone-600 dark:accent-orange-500"
                              />
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                aria-expanded={false}
                                aria-label={`Expand ${todo.text}`}
                                onClick={() => expandTodo(todo)}
                                onKeyDown={(event) =>
                                  handleRowKeyDown(event, todo)
                                }
                              >
                                <span
                                  className={`min-w-0 flex-1 truncate text-base ${
                                    todo.completed
                                      ? "text-stone-400 line-through dark:text-stone-500"
                                      : "text-stone-800 dark:text-stone-100"
                                  }`}
                                >
                                  {todo.text}
                                </span>
                                {chip ? (
                                  <span
                                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${priorityChipClass(todo.priority)}`}
                                    data-testid={`priority-chip-${todo.id}`}
                                  >
                                    {chip}
                                  </span>
                                ) : null}
                                {hint ? (
                                  <span
                                    className={`shrink-0 text-xs font-medium ${dueHintClass(status)}`}
                                    data-testid={`due-hint-${todo.id}`}
                                  >
                                    {hint}
                                  </span>
                                ) : null}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
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
