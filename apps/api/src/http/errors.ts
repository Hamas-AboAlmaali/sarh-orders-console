import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Request validation failed",
        issues: error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  // Malformed JSON bodies and oversized payloads surface from express.json() with a status.
  if (isClientError(error)) {
    res.status(error.status).json({ error: { code: "bad_request", message: error.message } });
    return;
  }

  console.error(error);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
};

function isClientError(error: unknown): error is { status: number; message: string } {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const { status } = error;
  return typeof status === "number" && status >= 400 && status < 500;
}
