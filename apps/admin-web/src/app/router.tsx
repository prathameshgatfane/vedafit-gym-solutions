import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { MemberDetailPage } from "../features/members/MemberDetailPage";
import { MemberFormPage } from "../features/members/MemberFormPage";
import { MembersListPage } from "../features/members/MembersListPage";
import { ProtectedRoute } from "./ProtectedRoute";
import { RequirePermission } from "./RequirePermission";

/**
 * Route table. Declared as JSX `<Routes>` rather than `createBrowserRouter` so component tests
 * can wrap the same tree in a `MemoryRouter` and exercise real navigation without a second,
 * test-only router configuration drifting from this one.
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

        <Route
          path="members"
          element={
            <RequirePermission permission="members.view">
              <MembersListPage />
            </RequirePermission>
          }
        />
        <Route
          path="members/new"
          element={
            <RequirePermission permission="members.create">
              <MemberFormPage mode="create" />
            </RequirePermission>
          }
        />
        <Route
          path="members/:memberId"
          element={
            <RequirePermission permission="members.view">
              <MemberDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="members/:memberId/edit"
          element={
            <RequirePermission permission="members.update">
              <MemberFormPage mode="edit" />
            </RequirePermission>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
