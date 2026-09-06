import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/** Authenticated chrome: fixed sidebar, topbar, and the routed page in the remaining space. */
export function AppShell() {
  return (
    <div data-testid="app-shell" className="flex min-h-screen bg-brand-black text-brand-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
