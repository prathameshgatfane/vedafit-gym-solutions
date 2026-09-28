import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useSidebarNav } from "./useSidebarNav";

/** Authenticated chrome: collapsible sidebar (md+), off-canvas drawer below md, topbar, page. */
export function AppShell() {
  const { mdUp, collapsed, mobileOpen, toggleCollapsed, toggleMobile, closeMobile } =
    useSidebarNav();

  return (
    <div data-testid="app-shell" className="flex min-h-screen bg-bg text-fg">
      <Sidebar
        mdUp={mdUp}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapsed={toggleCollapsed}
        onNavigate={closeMobile}
      />
      {mobileOpen && !mdUp ? (
        <button
          type="button"
          data-testid="sidebar-backdrop"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={closeMobile}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar mobileOpen={mobileOpen} onToggleMobile={toggleMobile} />
        <main className="flex-1 overflow-y-auto overflow-x-clip p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
