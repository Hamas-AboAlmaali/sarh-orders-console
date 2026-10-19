import { LoginPage } from "./features/auth/LoginPage";
import { useLogout, useSession } from "./features/auth/session";
import { OrdersPage } from "./features/orders/OrdersPage";
import { OverviewPage } from "./features/stats/OverviewPage";
import { useHashView, VIEW_HREFS, type View } from "./lib/use-hash-view";

const NAV_ITEMS: { view: View; label: string }[] = [
  { view: "orders", label: "Orders" },
  { view: "overview", label: "Overview" },
];

export function App() {
  const session = useSession();
  const logout = useLogout();
  const view = useHashView();
  const user = session.data;

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__brand">SARH</span>
        <span className="app__title">Orders Console</span>
        {user && (
          <>
            <nav className="app__nav" aria-label="Main">
              {NAV_ITEMS.map((item) => (
                <a
                  key={item.view}
                  href={VIEW_HREFS[item.view]}
                  aria-current={view === item.view ? "page" : undefined}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="app__user">
              <span>
                {user.name} · <span className="app__role">{user.role}</span>
              </span>
              <button
                type="button"
                className="button--on-dark"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </header>
      <main className="app__main">
        {session.isPending ? (
          <div className="notice">Loading…</div>
        ) : session.isError ? (
          <div className="notice notice--error" role="alert">
            <p>Could not check your session: {session.error.message}.</p>
            <button type="button" onClick={() => void session.refetch()}>
              Try again
            </button>
          </div>
        ) : user ? (
          <>
            {/* Kept mounted while hidden so filters and scroll position survive a visit to Overview. */}
            <OrdersPage user={user} hidden={view !== "orders"} />
            {/* Mounted only while visible: unmounting is what cancels its slow request. */}
            {view === "overview" && <OverviewPage />}
          </>
        ) : (
          <LoginPage />
        )}
      </main>
    </div>
  );
}
