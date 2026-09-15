import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "../../features/auth/auth.api";
import { useSessionStore } from "../../stores/session.store";
import { Button } from "../ui/Button";
import { useTheme } from "./useTheme";

export function Topbar() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const clear = useSessionStore((s) => s.clear);
  const [loggingOut, setLoggingOut] = useState(false);
  const { theme, toggleTheme } = useTheme();

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // Local session still drops.
    } finally {
      clear();
      setLoggingOut(false);
      navigate("/login", { replace: true });
    }
  }

  return (
    <header
      data-testid="app-topbar"
      className="flex h-16 shrink-0 items-center justify-end border-b border-border bg-bg px-6"
    >
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-fg">{user?.name}</p>
          <p className="text-xs text-accent-muted">Platform operator</p>
        </div>
        <button
          type="button"
          data-testid="theme-toggle"
          aria-pressed={theme === "light"}
          aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          className="inline-flex shrink-0 rounded-md p-2 text-fg/80 hover:bg-fg/5 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
          onClick={() => void handleLogout()}
          disabled={loggingOut}
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </header>
  );
}
