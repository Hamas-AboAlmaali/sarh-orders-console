import { IDEMPOTENCY_KEY_HEADER } from "@sarh/shared";
import type { Request } from "express";
import { z } from "zod";
import { HttpError } from "./errors";

const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export function requireIdempotencyKey(req: Request): string {
  const parsed = idempotencyKeySchema.safeParse(req.get(IDEMPOTENCY_KEY_HEADER));
  if (!parsed.success) {
    throw new HttpError(
      400,
      "invalid_idempotency_key",
      `${IDEMPOTENCY_KEY_HEADER} header is required: 16-128 letters, digits, "-" or "_"`,
    );
  }
  return parsed.data;
}
