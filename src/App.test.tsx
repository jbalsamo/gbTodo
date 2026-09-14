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
import App, {
  compareTodos,
  mapRow,
  sortTodos,
  type ProfileStatus,
  type Todo,
  type TodoRow,
} from "./App.tsx";

type TodoPriority = "none" | "low" | "medium" | "high";

type StoreTodo = {
  id: string;
  text: string;
  completed: boolean;
  user_id: string;
  due_date: string | null;
  priority: TodoPriority;
  notes: string | null;
};

type StoreProfile = {
  id: string;
  email: string;
  role: "user" | "admin";
  status: ProfileStatus;
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

const defaultProfile: StoreProfile = {
  id: "user-1",
  email: "tester@example.com",
  role: "user",
  status: "approved",
};

let store: StoreTodo[] = [];
let profiles: StoreProfile[] = [];
let authCallback: ((event: string, session: Session | null) => void) | null =
  null;
let signedIn = true;
let idCounter = 1;
/** When set, the next insert().select().single() fails with this message. */
let nextInsertError: string | null = null;
/** When set, the next N todo selects wait until the matching resolvers run. */
let pendingSelectGates: Array<{
  resolve: (release: () => void) => void;
  release: (() => void) | null;
}> = [];

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const signOut = vi.fn();
const getSession = vi.fn();
const onAuthStateChange = vi.fn();

function ok<T>(data: T) {
  return Promise.resolve({ data, error: null });
}

function fail(message: string) {
  return Promise.resolve({ data: null, error: { message } });
}


function approvedAdminCount() {
  return profiles.filter(
    (row) => row.role === "admin" && row.status === "approved",
  ).length;
}

function createRpcMock() {
  return (
    fn: string,
    args: {
      target_id: string;
      new_status?: ProfileStatus;
      new_role?: "user" | "admin";
    },
  ) => {
    if (fn === "set_profile_status") {
      if (args.target_id === mockUser.id) {
        return fail("cannot change own status");
      }
      const index = profiles.findIndex((row) => row.id === args.target_id);
      if (index < 0) {
        return fail("Profile not found");
      }
      const target = profiles[index];
      const newStatus = args.new_status as ProfileStatus;
      // Mirrors DB last-admin guard (race covered in SQL via FOR UPDATE).
      if (
        target.role === "admin" &&
        target.status === "approved" &&
        newStatus !== "approved" &&
        approvedAdminCount() <= 1
      ) {
        return fail("cannot change status of last approved admin");
      }
      profiles[index] = { ...profiles[index], status: newStatus };
      return ok(profiles[index]);
    }
    if (fn === "set_profile_role") {
      if (args.target_id === mockUser.id) {
        return fail("cannot change own role");
      }
      const index = profiles.findIndex((row) => row.id === args.target_id);
      if (index < 0) {
        return fail("Profile not found");
      }
      if (profiles[index].status !== "approved") {
        return fail("target must be approved");
      }
      const newRole = args.new_role as "user" | "admin";
      if (
        profiles[index].role === "admin" &&
        newRole !== "admin" &&
        approvedAdminCount() <= 1
      ) {
        return fail("cannot demote last approved admin");
      }
      profiles[index] = { ...profiles[index], role: newRole };
      return ok(profiles[index]);
    }
    return fail(`Unknown rpc ${fn}`);
  };
}

function createFromMock() {
  return (table: string) => {
    if (table === "profiles") {
      return {
        select(_columns?: string) {
          const filters: Record<string, unknown> = {};
          const orders: Array<{ column: string; ascending: boolean }> = [];
          const finish = () => {
            let rows = [...profiles];
            for (const [key, value] of Object.entries(filters)) {
              rows = rows.filter(
                (row) => (row as Record<string, unknown>)[key] === value,
              );
            }
            const rank: Record<ProfileStatus, number> = {
              pending: 0,
              approved: 1,
              rejected: 2,
            };
            rows.sort((a, b) => {
              for (const ord of orders) {
                if (ord.column === "status") {
                  const diff = rank[a.status] - rank[b.status];
                  if (diff !== 0) return ord.ascending ? diff : -diff;
                } else if (ord.column === "email") {
                  const diff = a.email.localeCompare(b.email);
                  if (diff !== 0) return ord.ascending ? diff : -diff;
                }
              }
              return a.email.localeCompare(b.email);
            });
            return ok(rows);
          };
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            order(column: string, options?: { ascending?: boolean }) {
              orders.push({
                column,
                ascending: options?.ascending ?? true,
              });
              return builder;
            },
            maybeSingle() {
              let rows = [...profiles];
              for (const [key, value] of Object.entries(filters)) {
                rows = rows.filter(
                  (row) => (row as Record<string, unknown>)[key] === value,
                );
              }
              return ok(rows[0] ?? null);
            },
            single() {
              let rows = [...profiles];
              for (const [key, value] of Object.entries(filters)) {
                rows = rows.filter(
                  (row) => (row as Record<string, unknown>)[key] === value,
                );
              }
              if (!rows[0]) return fail("Profile not found");
              return ok(rows[0]);
            },
            then(
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              return finish().then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    }

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
                if (nextInsertError) {
                  const message = nextInsertError;
                  nextInsertError = null;
                  return fail(message);
                }
                const created: StoreTodo = {
                  id: `todo-${idCounter++}`,
                  text: String(row.text ?? ""),
                  completed: Boolean(row.completed),
                  user_id: String(row.user_id ?? ""),
                  due_date:
                    row.due_date === undefined
                      ? null
                      : (row.due_date as string | null),
                  priority: (row.priority as TodoPriority | undefined) ?? "none",
                  notes:
                    row.notes === undefined
                      ? null
                      : (row.notes as string | null),
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
        signInWithPassword: (...args: unknown[]) =>
          signInWithPassword(...args),
        signUp: (...args: unknown[]) => signUp(...args),
        signOut: (...args: unknown[]) => signOut(...args),
      },
      from: (...args: unknown[]) => createFromMock()(...(args as [string])),
      rpc: (...args: unknown[]) =>
        createRpcMock()(
          ...(args as [
            string,
            {
              target_id: string;
              new_status?: ProfileStatus;
              new_role?: "user" | "admin";
            },
          ]),
        ),
    };
  },
}));

function configureAuth(
  options: {
    signedIn?: boolean;
    profile?: Partial<StoreProfile> | null;
  } = {},
) {
  signedIn = options.signedIn ?? true;
  if (options.profile === null) {
    profiles = [];
  } else {
    profiles = [
      {
        ...defaultProfile,
        ...(options.profile ?? {}),
      },
    ];
  }
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
  signInWithPassword.mockImplementation(async ({ email, password }) => {
    void password;
    signedIn = true;
    const session = {
      ...mockSession,
      user: { ...mockUser, email },
    } as Session;
    authCallback?.("SIGNED_IN", session);
    return { data: { session, user: session.user }, error: null };
  });
  signUp.mockImplementation(async ({ email, password }) => {
    void password;
    const id = `pending-user-${idCounter++}`;
    profiles = [
      ...profiles.filter((row) => row.id !== id && row.email !== email),
      {
        id,
        email,
        role: "user",
        status: "pending",
      },
    ];
    // Simulate confirm-email off: return a session immediately.
    const user = { ...mockUser, id, email } as User;
    const session = { ...mockSession, user } as Session;
    signedIn = true;
    authCallback?.("SIGNED_IN", session);
    return { data: { session, user }, error: null };
  });
  signOut.mockImplementation(async () => {
    signedIn = false;
    authCallback?.("SIGNED_OUT", null);
    return { error: null };
  });
}

async function renderSignedIn(
  profile?: Partial<StoreProfile>,
) {
  configureAuth({ signedIn: true, profile });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("textbox", { name: /new todo/i });
  return user;
}

async function renderSignedOut() {
  configureAuth({ signedIn: false });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText(/^email$/i);
  return user;
}

async function renderPending(status: ProfileStatus = "pending") {
  configureAuth({
    signedIn: true,
    profile: { status, role: "user" },
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("account-status");
  return user;
}

async function renderAdmin(extraProfiles: StoreProfile[] = []) {
  const adminProfile: StoreProfile = {
    id: "user-1",
    email: "graywulf70@gmail.com",
    role: "admin",
    status: "approved",
  };
  configureAuth({
    signedIn: true,
    profile: adminProfile,
  });
  profiles = [
    adminProfile,
    ...extraProfiles.filter((p) => p.id !== adminProfile.id),
  ];
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: /^admin$/i });
  await screen.findByRole("textbox", { name: /new todo/i });
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
  profiles = [{ ...defaultProfile }];
  idCounter = 1;
  authCallback = null;
  signedIn = true;
  nextInsertError = null;
  pendingSelectGates = [];
  supabaseTestState.configured = true;
  vi.clearAllMocks();
});

describe("auth gate", () => {
  it("shows email/password sign-in form when signed out", async () => {
    await renderSignedOut();

    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^sign in$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /register/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send magic link/i }),
    ).not.toBeInTheDocument();
  });

  it("signs in with email and password", async () => {
    const user = await renderSignedOut();
    profiles = [{ ...defaultProfile }];

    await user.type(screen.getByLabelText(/^email$/i), "tester@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "tester@example.com",
        password: "secret123",
      });
    });
    expect(
      await screen.findByRole("textbox", { name: /new todo/i }),
    ).toBeInTheDocument();
  });

  it("registers a new account with email and password", async () => {
    const user = await renderSignedOut();

    await user.click(screen.getByRole("tab", { name: /register/i }));
    await user.type(screen.getByLabelText(/^email$/i), "newbie@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "secret123");
    await user.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith({
        email: "newbie@example.com",
        password: "secret123",
      });
    });
    // New signup is pending — no todos UI.
    expect(await screen.findByTestId("account-status")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
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
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    });
    expect(signOut).toHaveBeenNthCalledWith(1);
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
    expect(
      screen.queryByRole("checkbox", { name: "Stay private" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
  });

  it("returns to sign-in form when signOut reports Auth session missing", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Stuck session todo");

    signOut.mockImplementation(async (options?: { scope?: string }) => {
      // Simulate missing/expired server session: error without auth callback.
      // Global fails benignly; local-scope fallback also reports missing.
      void options;
      return { error: { message: "Auth session missing!" } };
    });

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    });
    expect(signOut).toHaveBeenNthCalledWith(1);
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
    expect(
      screen.getByRole("button", { name: /^sign in$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/auth session missing/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Stuck session todo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
  });

  it("returns to sign-in form when signOut rejects with Auth session missing", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Rejected session todo");

    signOut.mockImplementation(async (options?: { scope?: string }) => {
      if (options?.scope === "local") {
        return { error: { message: "Auth session missing!" } };
      }
      throw { message: "Auth session missing!" };
    });

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    });
    expect(signOut).toHaveBeenNthCalledWith(1);
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
    expect(
      screen.queryByText(/auth session missing/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Rejected session todo" }),
    ).not.toBeInTheDocument();
  });

  it("clears leftover error and returns to sign-in form on other-tab SIGNED_OUT", async () => {
    const user = await renderSignedIn();

    nextInsertError = "Auth session missing!";
    await user.type(
      screen.getByRole("textbox", { name: /new todo/i }),
      "Will fail",
    );
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /auth session missing/i,
    );
    expect(
      screen.getByText(/signed in as tester@example.com/i),
    ).toBeInTheDocument();

    // Simulate auth broadcast from another tab clearing the session.
    authCallback?.("SIGNED_OUT", null);

    await waitFor(() => {
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/signed in as/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/auth session missing/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears to signed-out UI and shows non-benign signOut errors", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Keep clearing");

    signOut.mockImplementation(async (options?: { scope?: string }) => {
      if (options?.scope === "local") {
        return { error: null };
      }
      return { error: { message: "Network request failed" } };
    });

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    });
    expect(signOut).toHaveBeenNthCalledWith(1);
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/signed in as/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /network request failed/i,
    );
  });
});

describe("approval gate", () => {
  it("blocks todos when profile is pending", async () => {
    await renderPending("pending");

    expect(screen.getByTestId("account-status")).toHaveTextContent(/pending/i);
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();
  });

  it("blocks todos when profile is rejected", async () => {
    await renderPending("rejected");

    expect(screen.getByTestId("account-status")).toHaveTextContent(/rejected/i);
    expect(
      screen.queryByRole("textbox", { name: /new todo/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the todo list when approved", async () => {
    await renderSignedIn({ status: "approved", role: "user" });

    expect(
      screen.getByRole("textbox", { name: /new todo/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();
  });
});

describe("admin panel", () => {
  it("does not show the Admin button for non-admin users", async () => {
    await renderSignedIn({ role: "user", status: "approved" });

    expect(
      screen.queryByRole("button", { name: /^admin$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /admin approval/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the Admin button for admins with the panel closed by default", async () => {
    await renderAdmin();

    const toggle = screen.getByRole("button", { name: /^admin$/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();
  });

  it("toggles the admin panel open and closed", async () => {
    const user = await renderAdmin();

    const toggle = screen.getByRole("button", { name: /^admin$/i });
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("admin-panel")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /admin approval/i }),
    ).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();
  });

  it("resets admin panel closed after sign-out", async () => {
    const user = await renderAdmin();

    await user.click(screen.getByRole("button", { name: /^admin$/i }));
    expect(screen.getByTestId("admin-panel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^email$/i), "graywulf70@gmail.com");
    await user.type(screen.getByLabelText(/^password$/i), "password123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const toggle = await screen.findByRole("button", { name: /^admin$/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();
  });

  it("lets an admin approve a pending profile", async () => {
    const pending: StoreProfile = {
      id: "user-pending",
      email: "waiter@example.com",
      role: "user",
      status: "pending",
    };
    const user = await renderAdmin([pending]);

    await user.click(screen.getByRole("button", { name: /^admin$/i }));
    expect(screen.getByTestId("admin-panel")).toBeInTheDocument();
    expect(
      await screen.findByText("waiter@example.com"),
    ).toBeInTheDocument();

    const row = screen.getByTestId("admin-profile-user-pending");
    await user.click(
      within(row).getByRole("button", { name: /^approve$/i }),
    );

    await waitFor(() => {
      expect(profiles.find((p) => p.id === "user-pending")?.status).toBe(
        "approved",
      );
    });
    expect(within(row).getByText(/approved/i)).toBeInTheDocument();
  });

  it("hides admin UI for non-admin users", async () => {
    await renderSignedIn({ role: "user", status: "approved" });

    expect(
      screen.queryByRole("button", { name: /^admin$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-panel")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /admin approval/i }),
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

    await user.click(screen.getByRole("button", { name: /expand old text/i }));
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

    await user.click(screen.getByRole("button", { name: /expand remove me/i }));
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
    profiles = [
      { ...defaultProfile },
      {
        id: "user-2",
        email: "other@example.com",
        role: "user",
        status: "approved",
      },
    ];
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



describe("mapRow and sort", () => {
  it("maps due_date and priority from a TodoRow", () => {
    const row: TodoRow = {
      id: "a",
      text: "Task",
      completed: false,
      user_id: "user-1",
      due_date: "2026-09-20",
      priority: "high",
      notes: "remember milk",
    };
    expect(mapRow(row)).toEqual({
      id: "a",
      text: "Task",
      completed: false,
      due_date: "2026-09-20",
      priority: "high",
      notes: "remember milk",
    });
  });

  it("defaults missing due_date to null and priority to none", () => {
    const row = {
      id: "b",
      text: "Bare",
      completed: true,
      user_id: "user-1",
      due_date: null,
      priority: undefined,
    } as unknown as TodoRow;
    expect(mapRow(row)).toEqual({
      id: "b",
      text: "Bare",
      completed: true,
      due_date: null,
      priority: "none",
      notes: null,
    });
  });

  it("sorts by due_date asc with nulls last, then priority high→low, then id", () => {
    const items: Todo[] = [
      {
        id: "3",
        text: "C",
        completed: false,
        due_date: null,
        priority: "high",
        notes: null,
      },
      {
        id: "1",
        text: "A",
        completed: false,
        due_date: "2026-09-15",
        priority: "low",
        notes: null,
      },
      {
        id: "2",
        text: "B",
        completed: false,
        due_date: "2026-09-15",
        priority: "high",
        notes: null,
      },
      {
        id: "4",
        text: "D",
        completed: false,
        due_date: "2026-09-10",
        priority: "none",
        notes: null,
      },
      {
        id: "5",
        text: "E",
        completed: false,
        due_date: null,
        priority: "none",
        notes: null,
      },
    ];
    expect(sortTodos(items).map((t) => t.id)).toEqual([
      "4",
      "2",
      "1",
      "3",
      "5",
    ]);
  });

  it("compareTodos ranks high above none when due dates match", () => {
    const a: Todo = {
      id: "a",
      text: "a",
      completed: false,
      due_date: null,
      priority: "high",
      notes: null,
    };
    const b: Todo = {
      id: "b",
      text: "b",
      completed: false,
      due_date: null,
      priority: "none",
      notes: null,
    };
    expect(compareTodos(a, b)).toBeLessThan(0);
  });
});

describe("compact expand rows", () => {
  it("hides due date and priority controls until the row is expanded", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Compact me");

    expect(screen.queryByLabelText(/due date/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^priority$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /edit todo/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete compact me/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /expand compact me/i }),
    );

    expect(screen.getByLabelText(/due date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^priority$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /edit todo/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete compact me/i }),
    ).toBeInTheDocument();
  });

  it("collapses the previous row when another expands", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "First item");
    await addTodo(user, "Second item");

    await user.click(
      screen.getByRole("button", { name: /expand first item/i }),
    );
    expect(
      screen.getByRole("textbox", { name: /edit todo/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /expand second item/i }),
    );

    const editInputs = screen.getAllByRole("textbox", { name: /edit todo/i });
    expect(editInputs).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /expand first item/i }),
    ).toBeInTheDocument();
  });

  it("collapses on Escape", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Escapable");

    await user.click(
      screen.getByRole("button", { name: /expand escapable/i }),
    );
    expect(screen.getByLabelText(/due date/i)).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByLabelText(/due date/i)).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /expand escapable/i }),
    ).toBeInTheDocument();
  });

  it("persists due_date and priority updates through the mock store", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Schedule me");

    expect(store[0].due_date).toBeNull();
    expect(store[0].priority).toBe("none");

    await user.click(
      screen.getByRole("button", { name: /expand schedule me/i }),
    );
    const dueInput = screen.getByLabelText(/due date/i);
    await user.clear(dueInput);
    await user.type(dueInput, "2026-09-20");
    await user.selectOptions(screen.getByLabelText(/^priority$/i), "high");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(store[0].due_date).toBe("2026-09-20");
      expect(store[0].priority).toBe("high");
    });

    expect(screen.getByTestId(`priority-chip-${store[0].id}`)).toHaveTextContent(
      /high/i,
    );
    expect(screen.getByTestId(`due-hint-${store[0].id}`)).toBeInTheDocument();
  });

  it("sorts visible incomplete todos by due date then priority", async () => {
    store = [
      {
        id: "todo-z",
        text: "Later low",
        completed: false,
        user_id: "user-1",
        due_date: "2026-09-22",
        priority: "low",
        notes: null,
      },
      {
        id: "todo-a",
        text: "Soon high",
        completed: false,
        user_id: "user-1",
        due_date: "2026-09-15",
        priority: "high",
        notes: null,
      },
      {
        id: "todo-b",
        text: "Soon low",
        completed: false,
        user_id: "user-1",
        due_date: "2026-09-15",
        priority: "low",
        notes: null,
      },
      {
        id: "todo-c",
        text: "No date high",
        completed: false,
        user_id: "user-1",
        due_date: null,
        priority: "high",
        notes: null,
      },
    ];

    await renderSignedIn();

    await waitFor(() => {
      expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    });
    const items = screen.getAllByRole("checkbox");
    expect(items[0]).toHaveAccessibleName("Soon high");
    expect(items[1]).toHaveAccessibleName("Soon low");
    expect(items[2]).toHaveAccessibleName("Later low");
    expect(items[3]).toHaveAccessibleName("No date high");
  });


  it("expands when the compact row is clicked, but not when the checkbox is clicked", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Row click me");

    const row = screen.getByTestId(`compact-row-${store[0].id}`);
    await user.click(row);

    expect(screen.getByTestId(`expanded-row-${store[0].id}`)).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /edit todo/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => {
      expect(
        screen.queryByTestId(`expanded-row-${store[0].id}`),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox", { name: "Row click me" }));
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Row click me" }),
      ).toBeChecked(),
    );
    expect(
      screen.queryByTestId(`expanded-row-${store[0].id}`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`compact-row-${store[0].id}`)).toBeInTheDocument();
  });

  it("collapses on Escape when focus is not in a date input", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Esc outside date");

    await user.click(
      screen.getByRole("button", { name: /expand esc outside date/i }),
    );
    const editInput = screen.getByRole("textbox", { name: /edit todo/i });
    editInput.focus();
    expect(document.activeElement).toBe(editInput);

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByLabelText(/due date/i)).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /expand esc outside date/i }),
    ).toBeInTheDocument();
  });

  it("does not collapse on Escape while focus is in the due date input", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Esc in date");

    await user.click(
      screen.getByRole("button", { name: /expand esc in date/i }),
    );
    const dueInput = screen.getByLabelText(/due date/i);
    dueInput.focus();
    expect(document.activeElement).toBe(dueInput);

    await user.keyboard("{Escape}");

    expect(screen.getByLabelText(/due date/i)).toBeInTheDocument();
    expect(
      screen.getByTestId(`expanded-row-${store[0].id}`),
    ).toBeInTheDocument();
  });

  it("clears expandedId when clearCompleted removes the expanded completed todo", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Done expanded");
    await addTodo(user, "Still open");
    await user.click(screen.getByRole("checkbox", { name: "Done expanded" }));
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Done expanded" }),
      ).toBeChecked(),
    );

    const doneId = store.find((t) => t.text === "Done expanded")!.id;
    await user.click(
      screen.getByRole("button", { name: /expand done expanded/i }),
    );
    expect(screen.getByTestId(`expanded-row-${doneId}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear completed/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("checkbox", { name: "Done expanded" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(`expanded-row-${doneId}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /edit todo/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Still open" }),
    ).toBeInTheDocument();
  });

  it("defaults new todos to priority none and null due_date", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Fresh");
    expect(store).toHaveLength(1);
    expect(store[0].priority).toBe("none");
    expect(store[0].due_date).toBeNull();
  });
});


describe("admin self-guard and roles", () => {
  it("disables Approve and Reject on the current admin's own row", async () => {
    const user = await renderAdmin();
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    const ownRow = screen.getByTestId("admin-profile-user-1");
    expect(within(ownRow).getByTestId("approve-user-1")).toBeDisabled();
    expect(within(ownRow).getByTestId("reject-user-1")).toBeDisabled();
    expect(within(ownRow).getByTestId("remove-admin-user-1")).toBeDisabled();
  });

  it("does not call set_profile_status when Approve/Reject on self are clicked", async () => {
    const pending: StoreProfile = {
      id: "user-pending",
      email: "waiter@example.com",
      role: "user",
      status: "pending",
    };
    const user = await renderAdmin([pending]);
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    const own = screen.getByTestId("admin-profile-user-1");
    const before = profiles.find((p) => p.id === "user-1")!.status;
    await user.click(within(own).getByRole("button", { name: /^approve$/i }));
    await user.click(within(own).getByRole("button", { name: /^reject$/i }));
    expect(profiles.find((p) => p.id === "user-1")!.status).toBe(before);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces set_profile_status RPC errors", async () => {
    const pending: StoreProfile = {
      id: "user-pending",
      email: "waiter@example.com",
      role: "user",
      status: "pending",
    };
    const user = await renderAdmin([pending]);
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    // Make target vanish so RPC returns not found
    profiles = profiles.filter((p) => p.id !== "user-pending");

    const row = screen.getByTestId("admin-profile-user-pending");
    await user.click(within(row).getByRole("button", { name: /^approve$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /profile not found/i,
    );
  });

  it("shows Make admin only for approved users and calls set_profile_role", async () => {
    const pending: StoreProfile = {
      id: "user-pending",
      email: "waiter@example.com",
      role: "user",
      status: "pending",
    };
    const approvedUser: StoreProfile = {
      id: "user-approved",
      email: "member@example.com",
      role: "user",
      status: "approved",
    };
    const user = await renderAdmin([pending, approvedUser]);
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    const pendingRow = screen.getByTestId("admin-profile-user-pending");
    expect(
      within(pendingRow).queryByRole("button", { name: /make admin/i }),
    ).not.toBeInTheDocument();
    expect(
      within(pendingRow).queryByRole("button", { name: /remove admin/i }),
    ).not.toBeInTheDocument();

    const approvedRow = screen.getByTestId("admin-profile-user-approved");
    expect(
      within(approvedRow).getByRole("button", { name: /make admin/i }),
    ).toBeInTheDocument();

    await user.click(
      within(approvedRow).getByRole("button", { name: /make admin/i }),
    );

    await waitFor(() => {
      expect(profiles.find((p) => p.id === "user-approved")?.role).toBe("admin");
    });
    expect(
      within(approvedRow).getByRole("button", { name: /remove admin/i }),
    ).toBeInTheDocument();
  });

  it("hides Make/Remove admin for rejected profiles", async () => {
    const rejected: StoreProfile = {
      id: "user-rejected",
      email: "nope@example.com",
      role: "user",
      status: "rejected",
    };
    const user = await renderAdmin([rejected]);
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    const row = screen.getByTestId("admin-profile-user-rejected");
    expect(
      within(row).queryByRole("button", { name: /make admin/i }),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: /remove admin/i }),
    ).not.toBeInTheDocument();
  });

  it("cannot remove admin on self (button disabled)", async () => {
    const peer: StoreProfile = {
      id: "user-peer-admin",
      email: "peer@example.com",
      role: "admin",
      status: "approved",
    };
    const user = await renderAdmin([peer]);
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    const own = screen.getByTestId("admin-profile-user-1");
    expect(within(own).getByTestId("remove-admin-user-1")).toBeDisabled();

    const peerRow = screen.getByTestId("admin-profile-user-peer-admin");
    expect(
      within(peerRow).getByRole("button", { name: /remove admin/i }),
    ).not.toBeDisabled();

    await user.click(
      within(peerRow).getByRole("button", { name: /remove admin/i }),
    );
    await waitFor(() => {
      expect(profiles.find((p) => p.id === "user-peer-admin")?.role).toBe("user");
    });
  });

  it("surfaces set_profile_role RPC errors", async () => {
    const approvedUser: StoreProfile = {
      id: "user-approved",
      email: "member@example.com",
      role: "user",
      status: "approved",
    };
    const user = await renderAdmin([approvedUser]);
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    // Force RPC failure by making target pending after load via direct mutate
    // then clicking Make admin — update mock checks approved at call time.
    profiles = profiles.map((p) =>
      p.id === "user-approved" ? { ...p, status: "pending" as ProfileStatus } : p,
    );

    const row = screen.getByTestId("admin-profile-user-approved");
    // UI still shows Make admin from stale state; click triggers RPC error
    await user.click(within(row).getByRole("button", { name: /make admin/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /target must be approved/i,
    );
  });

  it("surfaces last-admin demotion guard from set_profile_role", async () => {
    const peer: StoreProfile = {
      id: "user-peer-admin",
      email: "peer@example.com",
      role: "admin",
      status: "approved",
    };
    const user = await renderAdmin([peer]);
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    // Simulate concurrent last-admin race: only peer remains approved admin
    // in the mock DB while the stale UI still offers Remove admin.
    profiles = profiles.map((p) =>
      p.id === "user-1" ? { ...p, role: "user" as const } : p,
    );

    const peerRow = screen.getByTestId("admin-profile-user-peer-admin");
    await user.click(
      within(peerRow).getByRole("button", { name: /remove admin/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cannot demote last approved admin/i,
    );
    expect(profiles.find((p) => p.id === "user-peer-admin")?.role).toBe("admin");
  });

  it("surfaces last-admin status guard from set_profile_status", async () => {
    const peer: StoreProfile = {
      id: "user-peer-admin",
      email: "peer@example.com",
      role: "admin",
      status: "approved",
    };
    const user = await renderAdmin([peer]);
    await user.click(screen.getByRole("button", { name: /^admin$/i }));

    // Only peer remains as approved admin in the mock DB.
    profiles = profiles.map((p) =>
      p.id === "user-1"
        ? { ...p, role: "user" as const, status: "rejected" as ProfileStatus }
        : p,
    );

    const peerRow = screen.getByTestId("admin-profile-user-peer-admin");
    await user.click(within(peerRow).getByRole("button", { name: /^reject$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cannot change status of last approved admin/i,
    );
    expect(profiles.find((p) => p.id === "user-peer-admin")?.status).toBe(
      "approved",
    );
  });
});

describe("todo notes modal", () => {
  it("shows Notes button in expanded view and opens a modal", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Noted task");
    const id = store[0].id;

    await user.click(screen.getByRole("button", { name: /expand noted task/i }));
    expect(screen.getByTestId(`notes-button-${id}`)).toBeInTheDocument();

    await user.click(screen.getByTestId(`notes-button-${id}`));
    expect(screen.getByTestId("notes-modal")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("notes-textarea")).toHaveFocus();
  });

  it("saves notes via todos update and closes the modal", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Persist notes");
    const id = store[0].id;

    await user.click(
      screen.getByRole("button", { name: /expand persist notes/i }),
    );
    await user.click(screen.getByTestId(`notes-button-${id}`));
    await user.type(screen.getByTestId("notes-textarea"), "side note");
    await user.click(screen.getByTestId("notes-save"));

    await waitFor(() => {
      expect(store[0].notes).toBe("side note");
    });
    expect(screen.queryByTestId("notes-modal")).not.toBeInTheDocument();
  });

  it("cancels without saving notes", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Discard notes");
    const id = store[0].id;

    await user.click(
      screen.getByRole("button", { name: /expand discard notes/i }),
    );
    await user.click(screen.getByTestId(`notes-button-${id}`));
    await user.type(screen.getByTestId("notes-textarea"), "temporary");
    await user.click(screen.getByTestId("notes-cancel"));

    expect(screen.queryByTestId("notes-modal")).not.toBeInTheDocument();
    expect(store[0].notes).toBeNull();
  });

  it("allows empty notes on save", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Empty notes");
    const id = store[0].id;

    await user.click(
      screen.getByRole("button", { name: /expand empty notes/i }),
    );
    await user.click(screen.getByTestId(`notes-button-${id}`));
    await user.type(screen.getByTestId("notes-textarea"), "temporary");
    await user.click(screen.getByTestId("notes-save"));
    await waitFor(() => {
      expect(store[0].notes).toBe("temporary");
    });
    expect(screen.queryByTestId("notes-modal")).not.toBeInTheDocument();

    // Row stays expanded after notes save — reopen modal and clear.
    await user.click(screen.getByTestId(`notes-button-${id}`));
    expect(screen.getByTestId("notes-textarea")).toHaveValue("temporary");
    await user.clear(screen.getByTestId("notes-textarea"));
    await user.click(screen.getByTestId("notes-save"));

    await waitFor(() => {
      expect(store[0].notes).toBeNull();
    });
  });

  it("closes notes modal on Escape without collapsing expanded row", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Escape notes");
    const id = store[0].id;

    await user.click(
      screen.getByRole("button", { name: /expand escape notes/i }),
    );
    await user.click(screen.getByTestId(`notes-button-${id}`));
    expect(screen.getByTestId("notes-modal")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("notes-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId(`expanded-row-${id}`)).toBeInTheDocument();
  });

  it("closes notes modal when backdrop is clicked", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Backdrop notes");
    const id = store[0].id;

    await user.click(
      screen.getByRole("button", { name: /expand backdrop notes/i }),
    );
    await user.click(screen.getByTestId(`notes-button-${id}`));
    await user.click(screen.getByTestId("notes-modal-backdrop"));
    expect(screen.queryByTestId("notes-modal")).not.toBeInTheDocument();
  });

  it("traps Tab focus inside the notes dialog and restores trigger focus", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Focus trap");
    const id = store[0].id;

    await user.click(
      screen.getByRole("button", { name: /expand focus trap/i }),
    );
    const notesButton = screen.getByTestId(`notes-button-${id}`);
    await user.click(notesButton);
    expect(screen.getByTestId("notes-textarea")).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    await user.tab();
    expect(screen.getByTestId("notes-cancel")).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId("notes-save")).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId("notes-textarea")).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByTestId("notes-save")).toHaveFocus();

    await user.click(screen.getByTestId("notes-cancel"));
    expect(screen.queryByTestId("notes-modal")).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(notesButton).toHaveFocus();
  });

  it("trims notes on save and shows collapsed-row notes cue", async () => {
    const user = await renderSignedIn();
    await addTodo(user, "Trim notes");
    const id = store[0].id;

    await user.click(
      screen.getByRole("button", { name: /expand trim notes/i }),
    );
    await user.click(screen.getByTestId(`notes-button-${id}`));
    const textarea = screen.getByTestId("notes-textarea");
    await user.clear(textarea);
    await user.type(textarea, "  padded  ");
    await user.click(screen.getByTestId("notes-save"));

    await waitFor(() => {
      expect(store[0].notes).toBe("padded");
    });

    await user.keyboard("{Escape}");
    expect(screen.getByTestId(`notes-indicator-${id}`)).toBeInTheDocument();
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