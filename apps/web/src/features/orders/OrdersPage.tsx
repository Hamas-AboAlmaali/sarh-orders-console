import type { OrderStatus, OrderSummary, SessionUser } from "@sarh/shared";
import { useMemo, useState } from "react";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { CreateOrderDialog } from "./create/CreateOrderDialog";
import type { OrderFilters } from "./orders-api";
import { OrdersTable } from "./OrdersTable";
import { OrdersToolbar, type SortOption } from "./OrdersToolbar";
import { useDeleteOrder } from "./use-delete-order";
import { useOrdersList } from "./use-orders-list";

const SEARCH_DEBOUNCE_MS = 300;

type Notice = { tone: "success" | "error"; message: string };

export function OrdersPage({ user, hidden = false }: { user: SessionUser; hidden?: boolean }) {
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<OrderStatus | undefined>(undefined);
  const [sort, setSort] = useState<SortOption>({ sort: "createdAt", direction: "desc" });
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  const deleteOrder = useDeleteOrder();

  function handleDelete(order: OrderSummary) {
    if (
      !window.confirm(`Delete order #${order.id} for ${order.customerName}? This cannot be undone.`)
    ) {
      return;
    }
    deleteOrder.mutate(order.id, {
      onSuccess: () => setNotice({ tone: "success", message: `Order #${order.id} was deleted.` }),
      onError: (error) =>
        setNotice({ tone: "error", message: `Could not delete #${order.id}: ${error.message}` }),
    });
  }

  const filters = useMemo<OrderFilters>(
    () => ({ search: search || undefined, status, ...sort }),
    [search, status, sort],
  );
  const { data, error, isPending, isError, isPlaceholderData, refetch, ...pagination } =
    useOrdersList(filters);
  const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  return (
    <section className="orders-page" hidden={hidden}>
      <header className="orders-page__header">
        <h1>Orders</h1>
        <p className="orders-page__meta" aria-live="polite">
          {isPending
            ? "Loading…"
            : isPlaceholderData
              ? "Updating…"
              : `${rows.length.toLocaleString()} loaded${pagination.hasNextPage ? " · scroll for more" : ""}`}
        </p>
        <button type="button" className="button--primary" onClick={() => setIsCreating(true)}>
          New order
        </button>
      </header>

      {notice && (
        <div
          className={`notice notice--banner notice--${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <span>{notice.message}</span>
          <button type="button" className="button--ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <CreateOrderDialog
        open={isCreating}
        onClose={() => setIsCreating(false)}
        onCreated={(order) => {
          setIsCreating(false);
          setNotice({
            tone: "success",
            message: `Order #${order.id} for ${order.customerName} was created.`,
          });
        }}
      />

      <OrdersToolbar
        search={searchInput}
        onSearchChange={setSearchInput}
        status={status}
        onStatusChange={setStatus}
        sort={sort}
        onSortChange={setSort}
      />

      {isError && !data ? (
        <div className="notice notice--error" role="alert">
          <p>Could not load orders: {error.message}.</p>
          <button type="button" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      ) : isPending ? (
        <div className="notice">Loading orders…</div>
      ) : rows.length === 0 ? (
        <div className="notice">No orders match these filters.</div>
      ) : (
        <OrdersTable
          rows={rows}
          // Never page through placeholder rows: their cursor belongs to the previous filters.
          hasNextPage={pagination.hasNextPage && !isPlaceholderData}
          isFetchingNextPage={pagination.isFetchingNextPage}
          nextPageFailed={pagination.isFetchNextPageError}
          fetchNextPage={pagination.fetchNextPage}
          isUpdating={isPlaceholderData}
          resetKey={JSON.stringify(filters)}
          // Hiding the action is a convenience; the API refuses deletes from non-admins regardless.
          onDelete={user.role === "admin" ? handleDelete : undefined}
        />
      )}
    </section>
  );
}
