import { NavLink } from "react-router-dom";
import { useSessionStore } from "../../stores/session.store";

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
  { to: "/memberships", label: "Memberships", permission: "memberships.create", comingSoon: true },
  { to: "/payments", label: "Payments", permission: "payments.view", comingSoon: true },
  { to: "/staff", label: "Staff", permission: "users.manage", comingSoon: true },
];

export function Sidebar() {
  const organization = useSessionStore((s) => s.organization);
  const hasPermission = useSessionStore((s) => s.hasPermission);

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.permission === null || hasPermission(item.permission),
  );

  return (
    <aside
      data-testid="app-sidebar"
      className="flex w-60 shrink-0 flex-col border-r border-brand-white/10 bg-brand-black-88"
    >
      <div className="flex h-16 items-center gap-2 border-b border-brand-white/10 px-5">
        <span className="h-2.5 w-2.5 rounded-full bg-brand-green" aria-hidden="true" />
        <span className="truncate text-sm font-semibold text-brand-white">
          {organization?.name ?? "Gym Admin"}
        </span>
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-3">
        {visibleItems.map((item) =>
          item.comingSoon ? (
            <span
              key={item.to}
              aria-disabled="true"
              title="Available in a later phase"
              className="cursor-not-allowed rounded-md px-3 py-2 text-sm text-brand-white/35"
            >
              {item.label}
            </span>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              // Only the dashboard needs an exact match; a section stays highlighted while you're
              // anywhere inside it (e.g. /members/:id).
              end={item.to === "/"}
              className={({ isActive }) =>
                [
                  "rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-brand-green font-semibold text-brand-black"
                    : "text-brand-white/80 hover:bg-brand-white/5 hover:text-brand-white",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ),
        )}
      </nav>
    </aside>
  );
}
