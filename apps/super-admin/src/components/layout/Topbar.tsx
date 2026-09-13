import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "../../features/auth/auth.api";
import { useSessionStore } from "../../stores/session.store";
import { Button } from "../ui/Button";

export function Topbar() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const clear = useSessionStore((s) => s.clear);
  const [loggingOut, setLoggingOut] = useState(false);

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
      className="flex h-16 shrink-0 items-center justify-end border-b border-brand-white/10 bg-brand-black px-6"
    >
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-brand-white">{user?.name}</p>
          <p className="text-xs text-brand-green-muted">Platform operator</p>
        </div>
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
