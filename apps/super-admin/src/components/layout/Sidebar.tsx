import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/organizations", label: "Organizations" },
  { to: "/plans", label: "SaaS plans" },
];

export function Sidebar() {
  return (
    <aside
      data-testid="app-sidebar"
      className="flex w-full shrink-0 flex-col border-b border-border bg-surface md:w-60 md:border-b-0 md:border-r"
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-5 md:h-16">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
        <span className="text-sm font-semibold text-fg">Super Admin</span>
      </div>
      <nav className="flex flex-row gap-1 overflow-x-auto p-3 md:flex-col">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              [
                "rounded-md px-3 py-2 text-sm",
                isActive
                  ? "bg-accent/15 text-accent-text"
                  : "text-fg/70 hover:bg-fg/5 hover:text-fg",
              ].join(" ")
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
