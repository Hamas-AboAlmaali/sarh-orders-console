import type { OrderStats } from "@sarh/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/query-client";
import { OverviewPage } from "./OverviewPage";
import { fetchOrderStats } from "./stats-api";

const stats: OrderStats = {
  byStatus: [
    { status: "pending", orderCount: 7_512, totalCents: 1_000_000 },
    { status: "paid", orderCount: 7_400, totalCents: 2_000_000 },
    { status: "shipped", orderCount: 7_600, totalCents: 3_000_000 },
    { status: "delivered", orderCount: 22_500, totalCents: 4_000_000 },
    { status: "cancelled", orderCount: 4_988, totalCents: 500_000 },
  ],
  today: { orderCount: 103, revenueCents: 12_345_678 },
  timeZone: "Asia/Riyadh",
  generatedAt: "2026-10-18T16:40:00.000Z",
};

type PendingRequest = {
  signal: AbortSignal;
  respond: (response: Response) => void;
  fail: (error: Error) => void;
};

/** Holds every request open until the test answers it, like the real 3–6 second endpoint. */
function stubSlowServer(): PendingRequest[] {
  const requests: PendingRequest[] = [];
  vi.stubGlobal("fetch", (_path: string, init: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal!;
      signal.addEventListener("abort", () => reject(signal.reason));
      requests.push({ signal, respond: resolve, fail: reject });
    });
  });
  return requests;
}

function renderOverview() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <OverviewPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OverviewPage", () => {
  it("explains the wait without blocking, then shows the report", async () => {
    const requests = stubSlowServer();
    renderOverview();

    expect(await screen.findByText(/Loading report… \ds/)).toBeInTheDocument();
    expect(screen.getByText(/leaving this page cancels the request/)).toBeInTheDocument();

    requests[0]!.respond(Response.json(stats));

    expect(await screen.findByText("SAR 123,456.78")).toBeInTheDocument();
    expect(screen.getByText("103")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1 + stats.byStatus.length);
  });

  it("cancels the request when the user navigates away", async () => {
    const requests = stubSlowServer();
    const { unmount } = renderOverview();
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    unmount();

    expect(requests[0]!.signal.aborted).toBe(true);
  });

  it("shows a failure at once, without silent retries, and recovers with one retry", async () => {
    const requests = stubSlowServer();
    renderOverview();
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    requests[0]!.respond(
      Response.json(
        { error: { code: "internal_error", message: "Something went wrong" } },
        { status: 500 },
      ),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the overview: Something went wrong.",
    );
    expect(requests).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Loading report…/)).toBeInTheDocument();
    requests[1]!.respond(Response.json(stats));

    expect(await screen.findByText("SAR 123,456.78")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it("keeps the last report visible when a refresh fails", async () => {
    const requests = stubSlowServer();
    renderOverview();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0]!.respond(Response.json(stats));
    await screen.findByText("SAR 123,456.78");

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    requests[1]!.fail(new TypeError("Failed to fetch"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the overview: Could not reach the server. Showing the last report.",
    );
    expect(screen.getByText("SAR 123,456.78")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  });
});

describe("fetchOrderStats", () => {
  it("gives up with a readable error when the server never answers", async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    stubSlowServer();

    const result = fetchOrderStats(new AbortController().signal);
    timeout.abort(new DOMException("signal timed out", "TimeoutError"));

    await expect(result).rejects.toThrow("The server did not answer within 15 seconds");
  });
});
