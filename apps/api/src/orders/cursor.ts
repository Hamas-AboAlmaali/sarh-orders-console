import { SORT_DIRECTIONS, type ListOrdersQuery, type OrderSortField } from "@sarh/shared";
import { z } from "zod";
import { HttpError } from "../http/errors";

const direction = z.enum(SORT_DIRECTIONS);
const id = z.number().int().positive();

// The cursor carries the sort it was issued for, so it cannot be replayed against a different one.
const cursorSchema = z.discriminatedUnion("sort", [
  z.object({
    sort: z.literal("createdAt" satisfies OrderSortField),
    direction,
    value: z.iso.datetime(),
    id,
  }),
  z.object({
    sort: z.literal("totalCents" satisfies OrderSortField),
    direction,
    value: z.number().int(),
    id,
  }),
]);

export type OrderCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: OrderCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(token: string, query: ListOrdersQuery): OrderCursor {
  const cursor = cursorSchema.safeParse(parseJson(Buffer.from(token, "base64url").toString()));
  if (!cursor.success) {
    throw new HttpError(400, "invalid_cursor", "Cursor is malformed");
  }
  if (cursor.data.sort !== query.sort || cursor.data.direction !== query.direction) {
    throw new HttpError(400, "invalid_cursor", "Cursor does not match the requested sort");
  }
  return cursor.data;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
