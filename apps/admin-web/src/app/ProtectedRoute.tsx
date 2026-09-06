import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Spinner } from "../components/ui/Spinner";
import { useSessionStore } from "../stores/session.store";

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Gate for everything behind the login screen.
 *
 * The `bootstrapping` branch is the important one: on a cold load the access token is gone (it
 * only ever lived in memory) and the app is still trading the refresh cookie for a new one.
 * Redirecting during that window would bounce every reload through the login screen even for a
 * perfectly valid session, so we hold on a loader until the status resolves.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const status = useSessionStore((s) => s.status);
  const location = useLocation();

  if (status === "bootstrapping") {
    return <Spinner label="Restoring session" />;
  }

  if (status === "unauthenticated") {
    // `state.from` lets a later phase send the user back where they were headed.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
