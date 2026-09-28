import { useEffect, useRef, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/organizations", label: "Organizations" },
  { to: "/plans", label: "SaaS plans" },
] as const;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function NavIcon({ to }: { to: string }) {
  if (to === "/organizations") {
    return (
      <Icon>
        <path d="M4 20V8l8-4 8 4v12" />
        <path d="M10 20v-6h4v6" />
        <path d="M8 10h.01M16 10h.01" />
      </Icon>
    );
  }
  if (to === "/plans") {
    return (
      <Icon>
        <path d="M12 4 5 8v8l7 4 7-4V8z" />
        <path d="M12 12 5 8M12 12l7-4M12 12v8" />
      </Icon>
    );
  }
  return (
    <Icon>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 10v9h12v-9" />
    </Icon>
  );
}

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
  const asideRef = useRef<HTMLElement>(null);
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
        !mdUp && !mobileOpen ? "pointer-events-none -translate-x-full" : "translate-x-0",
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
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">Super Admin</span>
        ) : (
          <span className="sr-only">Super Admin</span>
        )}
        <button
          type="button"
          data-testid="sidebar-toggle"
          className="hidden rounded-md p-1.5 text-fg-muted transition-colors hover:bg-accent/15 hover:text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:inline-flex"
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
            {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-2">
        {NAV.map((item) => (
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
                  ? "bg-accent/15 font-semibold text-accent-text"
                  : "text-fg-muted hover:bg-accent/15 hover:text-accent-text",
              ].join(" ")
            }
          >
            <NavIcon to={item.to} />
            {showLabels ? item.label : <span className="sr-only">{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
