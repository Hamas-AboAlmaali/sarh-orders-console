import type { OrderStatus } from "@sarh/shared";

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-badge--${status}`}>{status}</span>;
}
