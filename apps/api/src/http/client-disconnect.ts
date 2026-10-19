import type { Response } from "express";

/** Aborts when the client goes away before the response is sent (closed tab, cancelled fetch). */
export function clientDisconnectSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}
