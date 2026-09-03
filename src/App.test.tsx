import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App.tsx";

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
}

function getFilterControl() {
  return (
    screen.queryByRole("radiogroup", { name: /filter/i }) ??
    screen.queryByRole("group", { name: /filter/i })
  );
}

describe("empty state", () => {
  it("is accessible when there are no todos", () => {
    render(<App />);

    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent(/no todos/i);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("add todos", () => {
  it("adds the typed item when submitting with the button", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Buy milk", "button");

    expect(
      screen.getByRole("checkbox", { name: "Buy milk" }),
    ).toBeInTheDocument();
  });

  it("adds the typed item when submitting with Enter", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Walk the dog", "enter");

    expect(
      screen.getByRole("checkbox", { name: "Walk the dog" }),
    ).toBeInTheDocument();
  });

  it("clears the input after adding", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Write tests");

    expect(screen.getByRole("textbox", { name: /new todo/i })).toHaveValue("");
  });

  it("does not add whitespace-only input", async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByRole("textbox", { name: /new todo/i });
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent(/no todos/i);
  });

  it("keeps insertion order when adding two items", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "First");
    await addTodo(user, "Second");

    const items = screen.getAllByRole("checkbox");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName("First");
    expect(items[1]).toHaveAccessibleName("Second");
  });

  it("labels each item by its text", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Alpha");
    await addTodo(user, "Beta");

    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeInTheDocument();
  });
});

describe("mark done", () => {
  it("exposes a checkbox labeled by the todo text", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Read a book");

    expect(
      screen.getByRole("checkbox", { name: "Read a book" }),
    ).toBeInTheDocument();
  });

  it("marks that item complete via accessible checked state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Ship it");
    const checkbox = screen.getByRole("checkbox", { name: "Ship it" });

    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("restores incomplete when unchecked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Review PR");
    const checkbox = screen.getByRole("checkbox", { name: "Review PR" });

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("does not change other items when one is completed", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "One");
    await addTodo(user, "Two");

    await user.click(screen.getByRole("checkbox", { name: "One" }));

    expect(screen.getByRole("checkbox", { name: "One" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Two" })).not.toBeChecked();
  });
});

describe("filter", () => {
  it("is a real control with an accessible name", () => {
    render(<App />);

    const filter = getFilterControl();
    expect(filter).toBeInTheDocument();
    expect(
      within(filter!).getByRole("radio", { name: /^all$/i }),
    ).toBeInTheDocument();
    expect(
      within(filter!).getByRole("radio", { name: /active|incomplete/i }),
    ).toBeInTheDocument();
  });

  it("shows all todos by default, including completed", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Done task");
    await addTodo(user, "Open task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));

    expect(screen.getByRole("radio", { name: /^all$/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Done task" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Open task" }),
    ).not.toBeChecked();
  });

  it("hides completed todos and keeps incomplete when Active/Incomplete is selected", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Done task");
    await addTodo(user, "Open task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
    await user.click(screen.getByRole("radio", { name: /active|incomplete/i }));

    expect(
      screen.queryByRole("checkbox", { name: "Done task" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Open task" }),
    ).toBeInTheDocument();
  });

  it("brings completed todos back when All is selected", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Done task");
    await addTodo(user, "Open task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
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
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Done task");
    await user.click(screen.getByRole("checkbox", { name: "Done task" }));
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
    const user = userEvent.setup();
    render(<App />);

    await addTodo(user, "Last active");
    await user.click(screen.getByRole("radio", { name: /active|incomplete/i }));
    await user.click(screen.getByRole("checkbox", { name: "Last active" }));

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent(/no todos/i);
  });
});

describe("theme toggle", () => {
  it("exposes a button to switch theme", () => {
    render(<App />);

    expect(
      screen.getByRole("button", { name: /switch to dark mode/i }),
    ).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");
    expect(
      screen.getByRole("region", { name: /light theme/i }),
    ).toBeInTheDocument();
  });

  it("switches theme in an accessible way when clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

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
