import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../ui/Button";
import { logout } from "../../features/auth/auth.api";
import { useSessionStore } from "../../stores/session.store";

export function Topbar() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const branches = useSessionStore((s) => s.branches);
  const activeBranchId = useSessionStore((s) => s.activeBranchId);
  const setActiveBranch = useSessionStore((s) => s.setActiveBranch);
  const clear = useSessionStore((s) => s.clear);
  const [loggingOut, setLoggingOut] = useState(false);

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
      className="flex h-16 shrink-0 items-center justify-between border-b border-brand-white/10 bg-brand-black px-6"
    >
      <div className="flex items-center gap-3">
        {canSwitchBranch ? (
          <label className="flex items-center gap-2 text-xs text-brand-white/60">
            Branch
            <select
              aria-label="Active branch"
              value={activeBranchId ?? ""}
              onChange={(e) => setActiveBranch(e.target.value || null)}
              className="rounded-md border border-brand-white/20 bg-brand-black-88 px-2 py-1 text-sm text-brand-white focus:outline-none focus:ring-2 focus:ring-brand-green"
            >
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-xs text-brand-white/60">
            {branches.find((b) => b.id === activeBranchId)?.name ?? branches[0]?.name ?? ""}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-brand-white">{user?.name}</p>
          <p className="text-xs text-brand-green-muted">{user?.role.name}</p>
        </div>
        <Button variant="secondary" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </header>
  );
}
