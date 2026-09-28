import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../ui/Button";
import { SELECT_CONTROL_CLASS, SelectChevron } from "../ui/form-control";
import { logout } from "../../features/auth/auth.api";
import { useSessionStore } from "../../stores/session.store";
import { useTheme } from "./useTheme";

interface TopbarProps {
  mobileOpen: boolean;
  onToggleMobile: () => void;
}

export function Topbar({ mobileOpen, onToggleMobile }: TopbarProps) {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const branches = useSessionStore((s) => s.branches);
  const activeBranchId = useSessionStore((s) => s.activeBranchId);
  const setActiveBranch = useSessionStore((s) => s.setActiveBranch);
  const clear = useSessionStore((s) => s.clear);
  const [loggingOut, setLoggingOut] = useState(false);
  const { theme, toggleTheme } = useTheme();

  // A branch-scoped user has exactly one branch and no business switching; only org-wide roles
  // with more than one branch get a picker.
  const canSwitchBranch = user?.branchId === null && branches.length > 1;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      // Revokes the refresh-token family server-side and clears the cookie. Even if the request
      // fails (offline, API down) the local session is still dropped — leaving a user "logged in"
      // in the UI after they asked to leave is the worse failure.
      await logout();
    } catch {
      // Intentionally swallowed; see above.
    } finally {
      clear();
      setLoggingOut(false);
      navigate("/login", { replace: true });
    }
  }

  return (
    <header
      data-testid="app-topbar"
      className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg px-4 md:gap-3 md:px-6"
    >
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <button
          type="button"
          data-testid="sidebar-open"
          className="inline-flex shrink-0 rounded-md p-2 text-fg-muted transition-colors hover:bg-accent/15 hover:text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={onToggleMobile}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {canSwitchBranch ? (
          <label className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
            <span className="sr-only md:not-sr-only">Branch</span>
            <span className="relative min-w-0">
              <select
                aria-label="Active branch"
                value={activeBranchId ?? ""}
                onChange={(e) => setActiveBranch(e.target.value || null)}
                className={[
                  SELECT_CONTROL_CLASS,
                  "min-w-0 max-w-[8.5rem] truncate bg-surface py-1 sm:max-w-40",
                  "border-fg/20",
                ].join(" ")}
              >
                <option value="">All branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </span>
          </label>
        ) : (
          <span className="truncate text-xs text-fg-muted">
            {branches.find((b) => b.id === activeBranchId)?.name ?? branches[0]?.name ?? ""}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 md:gap-4">
        <div className="min-w-0 text-right">
          <p
            data-testid="topbar-user-name"
            className="truncate text-sm font-medium text-fg"
          >
            {user?.name}
          </p>
          <p className="hidden text-xs text-accent-muted sm:block">{user?.role.name}</p>
        </div>
        <button
          type="button"
          data-testid="theme-toggle"
          aria-pressed={theme === "light"}
          aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          className="inline-flex shrink-0 rounded-md p-2 text-fg-muted transition-colors hover:bg-accent/15 hover:text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={toggleTheme}
        >
          {theme === "light" ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
              <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 3v1.5M12 19.5V21M4.9 4.9l1.1 1.1M18 18l1.1 1.1M3 12h1.5M19.5 12H21M4.9 19.1l1.1-1.1M18 6l1.1-1.1" />
            </svg>
          )}
        </button>
        <Button
          variant="secondary"
          data-testid="sign-out"
          className="shrink-0"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </header>
  );
}
