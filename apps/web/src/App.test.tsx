import type { OrderSummary, SessionUser, UserRole } from "@sarh/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { endSession } from "./features/auth/session";
import { createQueryClient } from "./lib/query-client";

const PASSWORD = "Correct#2026";

const order: OrderSummary = {
  id: 7,
  customerName: "Sara Ali",
  customerEmail: "sara@example.com",
  status: "paid",
  totalCents: 4_500,
  itemCount: 1,
  createdAt: "2026-10-18T12:00:00.000Z",
};

function unauthorized() {
  return Response.json(
    { error: { code: "unauthenticated", message: "Sign in to continue" } },
    { status: 401 },
  );
}

/** A minimal stand-in for the API that keeps the session server-side, as the real cookie does. */
function stubServer(role: UserRole) {
  const user: SessionUser = { id: 1, email: `${role}@sarh.test`, name: `Test ${role}`, role };
  const server = { session: null as SessionUser | null };

  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    if (path === "/api/auth/me") {
      return server.session ? Response.json({ user: server.session }) : unauthorized();
    }
    if (path === "/api/auth/login") {
      const { password } = JSON.parse(init.body as string) as { password: string };
      if (password !== PASSWORD) {
        return Response.json(
          { error: { code: "invalid_credentials", message: "Email or password is incorrect" } },
          { status: 401 },
        );
      }
      server.session = user;
      return Response.json({ user });
    }
    if (path === "/api/auth/logout") {
      server.session = null;
      return new Response(null, { status: 204 });
    }
    if (path === "/api/orders/stats") {
      return new Promise<Response>(() => {});
    }
    if (path.startsWith("/api/orders")) {
      return server.session ? Response.json({ items: [order], nextCursor: null }) : unauthorized();
    }
    throw new Error(`Unexpected request to ${path}`);
  });

  return server;
}

function renderApp() {
  const queryClient = createQueryClient({ onUnauthorized: () => endSession(queryClient) });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

async function signIn(password = PASSWORD) {
  const user = userEvent.setup();
  const email = await screen.findByLabelText("Email");
  const passwordInput = screen.getByLabelText("Password");
  await user.clear(email);
  await user.type(email, "someone@sarh.test");
  await user.clear(passwordInput);
  await user.type(passwordInput, password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("App session handling", () => {
  it("asks for credentials, shows the server's error, then opens the console", async () => {
    stubServer("agent");
    renderApp();

    await signIn("Wrong#2026");
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect");

    await signIn();

    expect(await screen.findByRole("heading", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByText(/Test agent/)).toBeInTheDocument();
  });

  it.each([
    { role: "admin", hasDelete: true },
    { role: "agent", hasDelete: false },
  ] as const)("shows the delete action: $hasDelete for an $role", async ({ role, hasDelete }) => {
    stubServer(role);
    renderApp();
    await signIn();

    await screen.findByRole("columnheader", { name: "Order" });
    expect(Boolean(screen.queryByRole("columnheader", { name: "Actions" }))).toBe(hasDelete);
  });

  it("returns to the sign-in screen when the session expires mid-use", async () => {
    const server = stubServer("agent");
    server.session = { id: 1, email: "agent@sarh.test", name: "Test agent", role: "agent" };
    renderApp();
    await screen.findByRole("heading", { name: "Orders" });

    server.session = null;
    await userEvent.selectOptions(screen.getByLabelText("Status"), "paid");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("keeps the order filters when visiting Overview and coming back", async () => {
    stubServer("agent");
    renderApp();
    const user = await signIn();
    await user.type(await screen.findByLabelText("Search"), "sara");

    await user.click(screen.getByRole("link", { name: "Overview" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Orders" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Orders" }));
    expect(await screen.findByLabelText("Search")).toHaveValue("sara");
    expect(screen.queryByRole("heading", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("signs out", async () => {
    stubServer("agent");
    renderApp();
    const user = await signIn();
    await screen.findByRole("heading", { name: "Orders" });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
