import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Spinner } from "../components/ui/Spinner";
import { useSessionStore } from "../stores/session.store";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const location = useLocation();

  if (status === "bootstrapping") {
    return <Spinner label="Restoring session" />;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
