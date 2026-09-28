import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { OrganizationDetailPage } from "../features/organizations/OrganizationDetailPage";
import { OrganizationFormPage } from "../features/organizations/OrganizationFormPage";
import { OrganizationsListPage } from "../features/organizations/OrganizationsListPage";
import { PlanFormPage } from "../features/plans/PlanFormPage";
import { PlansListPage } from "../features/plans/PlansListPage";
import { ProtectedRoute } from "./ProtectedRoute";

/**
 * Route table. Declared as JSX `<Routes>` rather than `createBrowserRouter` so component tests
 * can wrap the same tree in a `MemoryRouter`. No gym-admin or audit-log routes (15.11).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="organizations" element={<OrganizationsListPage />} />
        <Route path="organizations/new" element={<OrganizationFormPage />} />
        <Route path="organizations/:organizationId" element={<OrganizationDetailPage />} />
        <Route path="plans" element={<PlansListPage />} />
        <Route path="plans/new" element={<PlanFormPage />} />
        <Route path="plans/:planId" element={<PlanFormPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
