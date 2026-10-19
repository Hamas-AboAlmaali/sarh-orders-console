import type { OrderStats } from "@sarh/shared";
import { formatTime } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { useElapsedSeconds } from "../../lib/use-elapsed-seconds";
import { StatusBadge } from "../orders/StatusBadge";
import { useOrderStats } from "./use-order-stats";

export function OverviewPage() {
  const { data, error, isPending, isError, isFetching, refetch } = useOrderStats();
  const elapsed = useElapsedSeconds(isFetching);
  const retry = () => void refetch();

  return (
    <section className="overview" aria-busy={isFetching}>
      <header className="overview__header">
        <h1>Overview</h1>
        <p className="overview__meta" aria-live="polite">
          {isFetching
            ? `Loading report… ${elapsed}s`
            : data
              ? `Updated ${formatTime(data.generatedAt)}`
              : null}
        </p>
        <button type="button" onClick={retry} disabled={isFetching || isPending}>
          Refresh
        </button>
      </header>

      {isError && (
        <div className="notice notice--banner notice--error" role="alert">
          <span>
            Could not load the overview: {error.message}.{data && " Showing the last report."}
          </span>
          <button type="button" onClick={retry} disabled={isFetching}>
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {data ? (
        <StatsReport stats={data} />
      ) : isPending ? (
        <p className="notice">
          This report takes a few seconds to prepare. You can go back to Orders at any time; leaving
          this page cancels the request.
        </p>
      ) : null}
    </section>
  );
}

function StatsReport({ stats }: { stats: OrderStats }) {
  return (
    <>
      <div className="overview__cards">
        <article className="stat-card">
          <h2 className="stat-card__label">Revenue today</h2>
          <p className="stat-card__value">{formatMoney(stats.today.revenueCents)}</p>
          <p className="stat-card__hint">Excludes cancelled orders · {stats.timeZone} time</p>
        </article>
        <article className="stat-card">
          <h2 className="stat-card__label">Orders today</h2>
          <p className="stat-card__value">{stats.today.orderCount.toLocaleString()}</p>
          <p className="stat-card__hint">All statuses</p>
        </article>
      </div>

      <table className="status-totals">
        <caption>All orders by status</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Orders</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {stats.byStatus.map((row) => (
            <tr key={row.status}>
              <td>
                <StatusBadge status={row.status} />
              </td>
              <td>{row.orderCount.toLocaleString()}</td>
              <td>{formatMoney(row.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
