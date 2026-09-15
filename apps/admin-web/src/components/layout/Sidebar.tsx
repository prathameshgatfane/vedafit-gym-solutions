import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useSessionStore } from "../../stores/session.store";
import { NavIcon } from "./nav-icons";

interface NavItem {
  to: string;
  label: string;
  /** Permission key required to see this item, or null for "everyone signed in". */
  permission: string | null;
  /** Phases beyond 3 fill these in; shown disabled so the shell reads as a real product. */
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", permission: null },
  { to: "/members", label: "Members", permission: "members.view" },
  { to: "/memberships", label: "Memberships", permission: "memberships.view" },
  { to: "/membership-plans", label: "Plans", permission: "membership-plans.view" },
  { to: "/attendance", label: "Attendance", permission: "attendance.view" },
  { to: "/trainers", label: "Trainers", permission: "trainers.manage" },
  { to: "/leads", label: "Leads", permission: "leads.manage" },
  { to: "/invoices", label: "Invoices", permission: "invoices.view" },
  { to: "/payments", label: "Payments", permission: "payments.view" },
  { to: "/expenses", label: "Expenses", permission: "expenses.manage" },
  { to: "/reports", label: "Reports", permission: "reports.view" },
  { to: "/notifications", label: "Notifications", permission: "notifications.manage" },
  { to: "/staff", label: "Staff", permission: "users.manage", comingSoon: true },
];

interface SidebarProps {
  mdUp: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onNavigate: () => void;
}

export function Sidebar({
  mdUp,
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onNavigate,
}: SidebarProps) {
  const organization = useSessionStore((s) => s.organization);
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const asideRef = useRef<HTMLElement>(null);

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.permission === null || hasPermission(item.permission),
  );

  // Drawer shows full labels; icon-only is a desktop preference only.
  const showLabels = !mdUp || !collapsed;

  useEffect(() => {
    if (!mdUp && mobileOpen) asideRef.current?.focus();
  }, [mdUp, mobileOpen]);

  return (
    <aside
      ref={asideRef}
      id="app-sidebar"
      data-testid="app-sidebar"
      tabIndex={-1}
      aria-hidden={!mdUp && !mobileOpen}
      className={[
        "flex shrink-0 flex-col border-r border-border bg-surface outline-none",
        "fixed inset-y-0 left-0 z-40 w-60 transition-transform duration-200",
        "md:static md:z-0 md:translate-x-0 md:pointer-events-auto",
        mdUp && collapsed ? "md:w-16" : "md:w-60",
        !mdUp && !mobileOpen
          ? "pointer-events-none -translate-x-full"
          : "translate-x-0",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-16 items-center border-b border-border",
          showLabels ? "gap-2 px-4" : "justify-center px-2",
        ].join(" ")}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        {showLabels ? (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
            {organization?.name ?? "Gym Admin"}
          </span>
        ) : (
          <span className="sr-only">{organization?.name ?? "Gym Admin"}</span>
        )}
        <button
          type="button"
          data-testid="sidebar-toggle"
          className="hidden rounded-md p-1.5 text-fg/70 hover:bg-fg/5 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:inline-flex"
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapsed}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            aria-hidden="true"
          >
            {collapsed ? (
              <path d="M9 6l6 6-6 6" />
            ) : (
              <path d="M15 6l-6 6 6 6" />
            )}
          </svg>
        </button>
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-2">
        {visibleItems.map((item) =>
          item.comingSoon ? (
            <span
              key={item.to}
              aria-disabled="true"
              title="Available in a later phase"
              className={[
                "flex cursor-not-allowed items-center rounded-md py-2 text-sm text-fg/40",
                showLabels ? "gap-3 px-3" : "justify-center px-2",
              ].join(" ")}
            >
              <NavIcon to={item.to} />
              {showLabels ? item.label : <span className="sr-only">{item.label}</span>}
            </span>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={showLabels ? undefined : item.label}
              onClick={onNavigate}
              className={({ isActive }) =>
                [
                  "flex items-center rounded-md py-2 text-sm transition-colors",
                  showLabels ? "gap-3 px-3" : "justify-center px-2",
                  isActive
                    ? "bg-accent font-semibold text-accent-fg"
                    : "text-fg/80 hover:bg-fg/5 hover:text-fg",
                ].join(" ")
              }
            >
              <NavIcon to={item.to} />
              {showLabels ? item.label : <span className="sr-only">{item.label}</span>}
            </NavLink>
          ),
        )}
      </nav>
    </aside>
  );
}
