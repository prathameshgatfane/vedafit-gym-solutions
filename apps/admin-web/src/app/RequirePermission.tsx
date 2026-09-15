import type { ReactNode } from "react";
import { useSessionStore } from "../stores/session.store";

interface RequirePermissionProps {
  permission: string;
  children: ReactNode;
}

/**
 * Hides a route from a role that has no business on it. This is a usability guard, not a security
 * one — the permission list it reads comes from `/auth/me`, and the API re-checks every request
 * against the database regardless. Its job is to keep someone from navigating into a screen whose
 * every request would 403.
 */
export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const allowed = useSessionStore((s) => s.hasPermission(permission));

  if (!allowed) {
    return (
      <div className="max-w-lg rounded-lg border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-fg">Not available for your role</h1>
        <p className="mt-2 text-sm text-fg-muted">
          You don&apos;t have permission to view this page. Ask an administrator if you think you
          should.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
