import type { OrderStatus } from "./orders";

/** "Today" for revenue means the calendar day in this time zone, where the operations team works. */
export const BUSINESS_TIME_ZONE = "Asia/Riyadh";

export type StatusTotals = {
  status: OrderStatus;
  orderCount: number;
  totalCents: number;
};

export type OrderStats = {
  /** Every status, in ORDER_STATUSES order, including those with no orders. */
  byStatus: StatusTotals[];
  today: {
    orderCount: number;
    /** Excludes cancelled orders. */
    revenueCents: number;
  };
  timeZone: string;
  generatedAt: string;
};
