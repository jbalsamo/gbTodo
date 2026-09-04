import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Session, User } from "@supabase/supabase-js";
import App from "./App.tsx";

type StoreTodo = {
  id: string;
  text: string;
  completed: boolean;
  user_id: string;
};

const mockUser: User = {
  id: "user-1",
  email: "tester@example.com",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
} as User;

const mockSession: Session = {
  access_token: "token",
  refresh_token: "refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: mockUser,
} as Session;

let store: StoreTodo[] = [];
let authCallback: ((event: string, session: Session | null) => void) | null =
  null;
let signedIn = true;
let idCounter = 1;
/** When set, the next N todo selects wait until the matching resolvers run. */
let pendingSelectGates: Array<{
  resolve: (release: () => void) => void;
  release: (() => void) | null;
}> = [];

const signInWithOtp = vi.fn();
const signOut = vi.fn();
const getSession = vi.fn();
const onAuthStateChange = vi.fn();

function ok<T>(data: T) {
  return Promise.resolve({ data, error: null });
}

function fail(message: string) {
  return Promise.resolve({ data: null, error: { message } });
}

function createFromMock() {
  return (table: string) => {
    expect(table).toBe("todos");

    return {
      select(_columns?: string) {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return builder;
          },
          order() {
            return builder.thenable();
          },
          thenable() {
            const finish = () => {
              let rows = [...store];
              for (const [key, value] of Object.entries(filters)) {
                rows = rows.filter(
                  (row) => (row as Record<string, unknown>)[key] === value,
                );
              }
              return ok(rows);
            };
            const gate = pendingSelectGates.shift();
            if (!gate) {
              return finish();
            }
            return new Promise((resolve) => {
              gate.release = () => {
                resolve(finish());
              };
              gate.resolve(gate.release);
            });
          },
          then(
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) {
            return builder.thenable().then(onFulfilled, onRejected);
          },
        };
        return builder;
      },

      insert(row: Partial<StoreTodo>) {
        return {
          select() {
            return {
              single() {
                const created: StoreTodo = {
                  id: `todo-${idCounter++}`,
                  text: String(row.text ?? ""),
                  completed: Boolean(row.completed),
                  user_id: String(row.user_id ?? ""),
                };
                store.push(created);
                return ok(created);
              },
            };
          },
        };
      },

      update(patch: Partial<StoreTodo>) {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return builder;
          },
          select() {
            return {
              single() {
                const index = store.findIndex((row) =>
                  Object.entries(filters).every(
                    ([key, value]) =>
                      (row as Record<string, unknown>)[key] === value,
                  ),
                );
                if (index < 0) {
                  return fail("Todo not found");
                }
                store[index] = { ...store[index], ...patch };
                return ok(store[index]);
              },
            };
          },
        };
        return builder;
      },

      delete() {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return builder;
          },
          then(
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) {
            store = store.filter(
              (row) =>
                !Object.entries(filters).every(
                  ([key, value]) =>
                    (row as Record<string, unknown>)[key] === value,
                ),
            );
            return ok(null).then(onFulfilled, onRejected);
          },
        };
        // Support awaiting .delete().eq(...).eq(...)
        return builder;
      },
    };
  };
}

const supabaseTestState = vi.hoisted(() => ({
  configured: true,
}));

vi.mock("@/lib/supabase", () => ({
  get isSupabaseConfigured() {
    return supabaseTestState.configured;
  },
  get supabase() {
    if (!supabaseTestState.configured) {
      return null;
    }
    return {
      auth: {
        getSession: (...args: unknown[]) => getSession(...args),
        onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...args),
        signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
        signOut: (...args: unknown[]) => signOut(...args),
      },
      from: (...args: unknown[]) => createFromMock()(...(args as [string])),
    };
  },
}));

function configureAuth(options: { signedIn?: boolean } = {}) {
  signedIn = options.signedIn ?? true;
  getSession.mockImplementation(() =>
    ok({ session: signedIn ? mockSession : null }),
  );
  onAuthStateChange.mockImplementation((callback) => {
    authCallback = callback;
    return {
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    };
  });
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
  signOut.mockImplementation(async () => {
    signedIn = false;
    authCallback?.("SIGNED_OUT", null);
    return { error: null };
  });
}

async function renderSignedIn() {
  configureAuth({ signedIn: true });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("textbox", { name: /new todo/i });
  return user;
}

async function renderSignedOut() {
  configureAuth({ signedIn: false });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("textbox", { name: /email/i });
  return user;
}

async function addTodo(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
  method: "button" | "enter" = "button",
) {
  const input = screen.getByRole("textbox", { name: /new todo/i });
  await user.clear(input);
  await user.type(input, text);
  if (method === "enter") {
    await user.keyboard("{Enter}");
  } else {
    await user.click(screen.getByRole("button", { name: /add/i }));
  }
  await screen.findByRole("checkbox", { name: text });
}

function getFilterControl() {
  return (
    screen.queryByRole("radiogroup", { name: /filter/i }) ??
    screen.queryByRole("group", { name: /filter/i })
  );
}

beforeEach(() => {
  store = [];
  idCounter = 1;
  authCallback = null;
  signedIn = true;
  pendingSelectGates = [];
  supabaseTestState.configured = true;
  vi.clearAllMocks();
});

describe("auth gate", () => {
  it("shows the magic-link form when signed out", async () => {
    await renderSignedOut();

    expect(
      screen.getByRole("textbox", { name: /email/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send magic link/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
  });

  it("sends a magic link for the entered email", async () => {
    const user = await renderSignedOut();

    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      "person@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /send magic link/i }),
    );

    await waitFor(() => {
      expect(signInWithOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "person@example.com",
        }),
      );
    });
    expect(screen.getByRole("status")).toHaveTextContent(/check your email/i);
  });

  it("shows signed-in email and sign out when authenticated", async () => {
    await renderSignedIn();

    expect(screen.getByText(/signed in as tester@example.com/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("clears the todo list after sign out", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Stay private");

    expect(
      screen.getByRole("checkbox", { name: "Stay private" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /email/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("checkbox", { name: "Stay private" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
  });
});

describe("empty state", () => {
  it("is accessible when there are no todos", async () => {
    await renderSignedIn();

    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent(/no todos/i);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("add todos", () => {
  it("adds the typed item when submitting with the button", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Buy milk", "button");

    expect(
      screen.getByRole("checkbox", { name: "Buy milk" }),
    ).toBeInTheDocument();
  });

  it("adds the typed item when submitting with Enter", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Walk the dog", "enter");

    expect(
      screen.getByRole("checkbox", { name: "Walk the dog" }),
    ).toBeInTheDocument();
  });

  it("clears the input after adding", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Write tests");

    expect(screen.getByRole("textbox", { name: /new todo/i })).toHaveValue("");
  });

  it("does not add whitespace-only input", async () => {
    const user = await renderSignedIn();

    const input = screen.getByRole("textbox", { name: /new todo/i });
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent(/no todos/i);
  });

  it("keeps insertion order when adding two items", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "First");
    await addTodo(user, "Second");

    const items = screen.getAllByRole("checkbox");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName("First");
    expect(items[1]).toHaveAccessibleName("Second");
  });

  it("labels each item by its text", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Alpha");
    await addTodo(user, "Beta");

    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeInTheDocument();
  });
});

describe("mark done", () => {
  it("exposes a checkbox labeled by the todo text", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Read a book");

    expect(
      screen.getByRole("checkbox", { name: "Read a book" }),
    ).toBeInTheDocument();
  });

  it("marks that item complete via accessible checked state", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Ship it");
    const checkbox = screen.getByRole("checkbox", { name: "Ship it" });

    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
  });

  it("restores incomplete when unchecked", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Review PR");
    const checkbox = screen.getByRole("checkbox", { name: "Review PR" });

    await user.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    await user.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it("does not change other items when one is completed", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "One");
    await addTodo(user, "Two");

    await user.click(screen.getByRole("checkbox", { name: "One" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "One" })).toBeChecked(),
    );

    expect(screen.getByRole("checkbox", { name: "Two" })).not.toBeChecked();
  });
});

describe("edit and delete", () => {
  it("edits todo text", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Old text");

    await user.click(screen.getByRole("button", { name: /edit old text/i }));
    const editInput = screen.getByRole("textbox", { name: /edit todo/i });
    await user.clear(editInput);
    await user.type(editInput, "New text");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "New text" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("checkbox", { name: "Old text" }),
    ).not.toBeInTheDocument();
  });

  it("deletes a todo", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Remove me");

    await user.click(
      screen.getByRole("button", { name: /delete remove me/i }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("checkbox", { name: "Remove me" }),
      ).not.toBeInTheDocument();
    });
  });

  it("clears completed todos", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Done task");
    await addTodo(user, "Open task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Done task" })).toBeChecked(),
    );

    await user.click(screen.getByRole("button", { name: /clear completed/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("checkbox", { name: "Done task" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("checkbox", { name: "Open task" }),
    ).toBeInTheDocument();
  });
});

describe("filter", () => {
  it("is a real control with an accessible name", async () => {
    await renderSignedIn();

    const filter = getFilterControl();
    expect(filter).toBeInTheDocument();
    expect(
      within(filter!).getByRole("radio", { name: /^all$/i }),
    ).toBeInTheDocument();
    expect(
      within(filter!).getByRole("radio", { name: /active|incomplete/i }),
    ).toBeInTheDocument();
    expect(
      within(filter!).getByRole("radio", { name: /^completed$/i }),
    ).toBeInTheDocument();
  });

  it("shows all todos by default, including completed", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Done task");
    await addTodo(user, "Open task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Done task" })).toBeChecked(),
    );

    expect(screen.getByRole("radio", { name: /^all$/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Done task" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Open task" }),
    ).not.toBeChecked();
  });

  it("hides completed todos and keeps incomplete when Active/Incomplete is selected", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Done task");
    await addTodo(user, "Open task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Done task" })).toBeChecked(),
    );
    await user.click(screen.getByRole("radio", { name: /active|incomplete/i }));

    expect(
      screen.queryByRole("checkbox", { name: "Done task" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Open task" }),
    ).toBeInTheDocument();
  });

  it("shows only completed todos when Completed is selected", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Done task");
    await addTodo(user, "Open task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Done task" })).toBeChecked(),
    );
    await user.click(screen.getByRole("radio", { name: /^completed$/i }));

    expect(
      screen.getByRole("checkbox", { name: "Done task" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Open task" }),
    ).not.toBeInTheDocument();
  });

  it("brings completed todos back when All is selected", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Done task");
    await addTodo(user, "Open task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Done task" })).toBeChecked(),
    );
    await user.click(screen.getByRole("radio", { name: /active|incomplete/i }));
    await user.click(screen.getByRole("radio", { name: /^all$/i }));

    expect(
      screen.getByRole("checkbox", { name: "Done task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Open task" }),
    ).toBeInTheDocument();
  });

  it("still shows a new incomplete item added while filtered", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Done task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Done task" })).toBeChecked(),
    );
    await user.click(screen.getByRole("radio", { name: /active|incomplete/i }));

    await addTodo(user, "Fresh task");

    expect(
      screen.getByRole("checkbox", { name: "Fresh task" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Done task" }),
    ).not.toBeInTheDocument();
  });

  it("leaves an empty accessible list without crashing after completing the last visible item under Incomplete", async () => {
    const user = await renderSignedIn();

    await addTodo(user, "Last active");
    await user.click(screen.getByRole("radio", { name: /active|incomplete/i }));
    await user.click(screen.getByRole("checkbox", { name: "Last active" }));

    await waitFor(() => {
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });
    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent(/no todos/i);
  });
});

describe("theme toggle", () => {
  it("exposes a button to switch theme", async () => {
    await renderSignedIn();

    expect(
      screen.getByRole("button", { name: /switch to dark mode/i }),
    ).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");
    expect(
      screen.getByRole("region", { name: /light theme/i }),
    ).toBeInTheDocument();
  });

  it("switches theme in an accessible way when clicked", async () => {
    const user = await renderSignedIn();

    await user.click(
      screen.getByRole("button", { name: /switch to dark mode/i }),
    );

    expect(document.documentElement).toHaveClass("dark");
    expect(
      screen.getByRole("button", { name: /switch to light mode/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /dark theme/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /switch to light mode/i }),
    );

    expect(document.documentElement).not.toHaveClass("dark");
    expect(
      screen.getByRole("button", { name: /switch to dark mode/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /light theme/i }),
    ).toBeInTheDocument();
  });
});

describe("brand header", () => {
  it("shows a decorative gbTodo logo mark next to the wordmark", async () => {
    await renderSignedIn();

    const logo = document.querySelector('img[src="/gbtodo-logo.png"]');
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img", { name: /gbtodo/i })).not.toBeInTheDocument();
  });

  it("shows the gbTodo brand name near the header", async () => {
    await renderSignedIn();

    const heading = screen.getByRole("heading", {
      name: /your tasks completed/i,
    });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("gbTodo")).toBeInTheDocument();
    expect(
      screen.getByText(/add tasks and tick them off/i),
    ).toBeInTheDocument();
  });
});


function deferNextSelect() {
  let releaseFn: (() => void) | null = null;
  const ready = new Promise<() => void>((resolve) => {
    pendingSelectGates.push({
      resolve: (release) => {
        releaseFn = release;
        resolve(release);
      },
      release: null,
    });
  });
  return {
    ready,
    release: () => {
      if (!releaseFn) {
        throw new Error("select gate was released before the query started");
      }
      releaseFn();
    },
  };
}

describe("todos loading race", () => {
  it("does not leave Loading todos stuck after a superseded in-flight load", async () => {
    const first = deferNextSelect();
    const second = deferNextSelect();

    configureAuth({ signedIn: true });
    render(<App />);

    // First load is gated — UI should show the loading status.
    const releaseFirst = await first.ready;
    expect(await screen.findByText(/loading todos/i)).toBeInTheDocument();

    // Switch accounts while the first request is still in flight so the
    // todos effect re-runs for a new user id (generation counter race).
    authCallback?.("SIGNED_IN", {
      ...mockSession,
      access_token: "token-user-2",
      user: {
        ...mockUser,
        id: "user-2",
        email: "other@example.com",
      },
    } as Session);

    const releaseSecond = await second.ready;

    // Stale first response settles after being superseded.
    releaseFirst();

    // Active second request settles with an empty list.
    store = [];
    releaseSecond();

    await waitFor(() => {
      expect(
        screen.queryByText(/loading todos/i),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/no todos/i);
    expect(
      screen.getByRole("textbox", { name: /new todo/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/signed in as other@example.com/i),
    ).toBeInTheDocument();
  });

  it("clears Loading todos when sign-out cancels an in-flight load", async () => {
    const first = deferNextSelect();
    configureAuth({ signedIn: true });
    render(<App />);

    const releaseFirst = await first.ready;
    expect(await screen.findByText(/loading todos/i)).toBeInTheDocument();

    authCallback?.("SIGNED_OUT", null);

    await waitFor(() => {
      expect(screen.queryByText(/loading todos/i)).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("textbox", { name: /email/i }),
    ).toBeInTheDocument();

    // Stale response must not resurrect the loading state.
    releaseFirst();
    await waitFor(() => {
      expect(screen.queryByText(/loading todos/i)).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("textbox", { name: /email/i }),
    ).toBeInTheDocument();
  });

  it("does not re-fetch todos when auth reports the same user id and token", async () => {
    configureAuth({ signedIn: true });
    render(<App />);
    await screen.findByRole("textbox", { name: /new todo/i });
    expect(screen.getByRole("status")).toHaveTextContent(/no todos/i);

    const gated = deferNextSelect();
    authCallback?.("TOKEN_REFRESHED", {
      ...mockSession,
      user: { ...mockUser },
    } as Session);

    // Same access_token + user id → session deduped; todos effect must not
    // start another select (gate would otherwise be consumed).
    await waitFor(() => {
      expect(screen.queryByText(/loading todos/i)).not.toBeInTheDocument();
    });
    expect(pendingSelectGates).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(/no todos/i);
    // Drop unused gate so later tests are not poisoned if any leak.
    pendingSelectGates = [];
    void gated;
  });
});

describe("missing supabase config", () => {
  it("shows config notice and shell when unconfigured", async () => {
    supabaseTestState.configured = false;
    const user = userEvent.setup();
    render(<App />);

    const notice = await screen.findByRole("alert");
    expect(notice).toBeTruthy();
    expect(screen.getByText("gbTodo")).toBeInTheDocument();
    expect(notice).toHaveTextContent(/supabase is not configured/i);
    expect(notice).toHaveTextContent(/VITE_SUPABASE_URL/);
    expect(notice).toHaveTextContent(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    expect(notice).toHaveTextContent(/npm run dev/);
    expect(screen.queryByText(/checking session/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /email/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /your tasks completed/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /switch to dark mode/i }),
    );
    expect(document.documentElement).toHaveClass("dark");
  });

  it("does not hang on checking session when unconfigured", async () => {
    supabaseTestState.configured = false;
    render(<App />);
    await screen.findByRole("alert");
    expect(screen.queryByText(/checking session/i)).not.toBeInTheDocument();
  });
});