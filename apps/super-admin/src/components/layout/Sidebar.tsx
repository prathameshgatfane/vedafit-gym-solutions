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
      className="flex w-full shrink-0 flex-col border-b border-brand-white/10 bg-brand-black-88 md:w-60 md:border-b-0 md:border-r"
    >
      <div className="flex h-14 items-center gap-2 border-b border-brand-white/10 px-5 md:h-16">
        <span className="h-2.5 w-2.5 rounded-full bg-brand-green" aria-hidden="true" />
        <span className="text-sm font-semibold text-brand-white">Super Admin</span>
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
                  ? "bg-brand-green/15 text-brand-green"
                  : "text-brand-white/70 hover:bg-brand-white/5 hover:text-brand-white",
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
