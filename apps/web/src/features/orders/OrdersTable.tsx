import type { OrderSummary } from "@sarh/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import { formatDateTime } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { StatusBadge } from "./StatusBadge";

const ROW_HEIGHT = 56;
const OVERSCAN = 10;
// Start loading the next page while this many loaded rows are still below the viewport.
const PREFETCH_THRESHOLD = 20;

const COLUMNS = ["Order", "Customer", "Status", "Items", "Total", "Created"] as const;

type Props = {
  rows: OrderSummary[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  nextPageFailed: boolean;
  fetchNextPage: () => unknown;
  isUpdating: boolean;
  /** Changes whenever the filters change, so the list scrolls back to the top. */
  resetKey: string;
  /** Adds a delete action to each row when provided. */
  onDelete?: ((order: OrderSummary) => void) | undefined;
};

export function OrdersTable({
  rows,
  hasNextPage,
  isFetchingNextPage,
  nextPageFailed,
  fetchNextPage,
  isUpdating,
  resetKey,
  onDelete,
}: Props) {
  const columns = onDelete ? [...COLUMNS, "Actions"] : COLUMNS;
  const rowClassName = `orders-table__row${onDelete ? " orders-table__row--with-actions" : ""}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    // One extra slot renders the "loading more" row at the end.
    count: hasNextPage ? rows.length + 1 : rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualRows.at(-1)?.index ?? -1;

  // A failed page stops auto-loading; otherwise this effect would retry in a tight loop.
  const shouldAutoLoad = hasNextPage && !isFetchingNextPage && !nextPageFailed;
  useEffect(() => {
    if (shouldAutoLoad && lastVisibleIndex >= rows.length - PREFETCH_THRESHOLD) {
      fetchNextPage();
    }
  }, [shouldAutoLoad, lastVisibleIndex, rows.length, fetchNextPage]);

  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [resetKey, virtualizer]);

  return (
    <div
      className="orders-table"
      role="table"
      aria-label="Orders"
      aria-rowcount={hasNextPage ? -1 : rows.length + 1}
      aria-busy={isUpdating}
    >
      <div className={`${rowClassName} orders-table__row--header`} role="row" aria-rowindex={1}>
        {columns.map((column) => (
          <div key={column} role="columnheader" className={`cell cell--${column.toLowerCase()}`}>
            {column}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        className={`orders-table__body${isUpdating ? " orders-table__body--updating" : ""}`}
        role="rowgroup"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualRows.map((virtualRow) => {
            const order = rows[virtualRow.index];
            const style = {
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
            };

            if (!order) {
              return (
                <div
                  key="loader"
                  className="orders-table__row orders-table__row--loader"
                  style={style}
                  role="row"
                >
                  {nextPageFailed ? (
                    <div role="cell">
                      Could not load more orders.{" "}
                      <button type="button" onClick={() => fetchNextPage()}>
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div role="cell">Loading more orders…</div>
                  )}
                </div>
              );
            }

            return (
              <div
                key={order.id}
                className={rowClassName}
                style={style}
                role="row"
                aria-rowindex={virtualRow.index + 2}
              >
                <div role="cell" className="cell cell--order">
                  #{order.id}
                </div>
                <div role="cell" className="cell cell--customer">
                  <span className="customer__name">{order.customerName}</span>
                  <span className="customer__email">{order.customerEmail}</span>
                </div>
                <div role="cell" className="cell cell--status">
                  <StatusBadge status={order.status} />
                </div>
                <div role="cell" className="cell cell--items">
                  {order.itemCount}
                </div>
                <div role="cell" className="cell cell--total">
                  {formatMoney(order.totalCents)}
                </div>
                <div role="cell" className="cell cell--created">
                  {formatDateTime(order.createdAt)}
                </div>
                {onDelete && (
                  <div role="cell" className="cell cell--actions">
                    <button
                      type="button"
                      className="button--danger-ghost"
                      onClick={() => onDelete(order)}
                      aria-label={`Delete order ${order.id}`}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
