import { z } from "zod";

export const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const MIN_ITEMS_PER_ORDER = 1;
export const MAX_ITEMS_PER_ORDER = 5;

export const ORDER_SORT_FIELDS = ["createdAt", "totalCents"] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;

export const listOrdersQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(MAX_SEARCH_LENGTH)
    .optional()
    .transform((value) => value || undefined),
  status: z.enum(ORDER_STATUSES).optional(),
  sort: z.enum(ORDER_SORT_FIELDS).default("createdAt"),
  direction: z.enum(SORT_DIRECTIONS).default("desc"),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(500).optional(),
});

/** What the client sends; every field is optional and falls back to a default. */
export type ListOrdersParams = z.input<typeof listOrdersQuerySchema>;
/** What the server works with after parsing and defaults. */
export type ListOrdersQuery = z.output<typeof listOrdersQuerySchema>;

export type OrderSummary = {
  id: number;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalCents: number;
  itemCount: number;
  createdAt: string;
};

export type OrdersPage = {
  items: OrderSummary[];
  /** Opaque token for the next page; null when there are no more results. */
  nextCursor: string | null;
};

export const MAX_QUANTITY = 999;
export const MAX_UNIT_PRICE_CENTS = 9_999_999;
// Keeps every valid order inside the 32-bit integer total_cents column.
export const MAX_ORDER_TOTAL_CENTS = 1_000_000_000;

export const orderItemInputSchema = z.object({
  productName: z.string().trim().min(1, "Product is required").max(200),
  quantity: z.number().int().min(1, "At least 1").max(MAX_QUANTITY),
  unitPriceCents: z.number().int().min(0, "Cannot be negative").max(MAX_UNIT_PRICE_CENTS),
});

export const createOrderSchema = z
  .object({
    customerName: z.string().trim().min(1, "Customer name is required").max(200),
    customerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("Enter a valid email address").max(320)),
    items: z
      .array(orderItemInputSchema)
      .min(MIN_ITEMS_PER_ORDER, "Add at least one item")
      .max(MAX_ITEMS_PER_ORDER, `At most ${MAX_ITEMS_PER_ORDER} items`),
    totalCents: z.number().int().min(0).max(MAX_ORDER_TOTAL_CENTS, "Order total is too large"),
  })
  .refine((order) => order.totalCents === sumLineItems(order.items), {
    path: ["totalCents"],
    message: "Total does not match the line items",
  });

export type CreateOrderInput = z.input<typeof createOrderSchema>;

export function sumLineItems(items: { quantity: number; unitPriceCents: number }[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
}

export type OrderItem = {
  id: number;
  productName: string;
  quantity: number;
  unitPriceCents: number;
};

export type OrderDetail = OrderSummary & { items: OrderItem[] };

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENT_REPLAY_HEADER = "Idempotent-Replayed";
