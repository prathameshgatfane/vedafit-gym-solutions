import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { AttendancePage } from "../features/attendance/AttendancePage";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { MemberDetailPage } from "../features/members/MemberDetailPage";
import { MemberFormPage } from "../features/members/MemberFormPage";
import { MembersListPage } from "../features/members/MembersListPage";
import { InvoiceDetailPage } from "../features/invoices/InvoiceDetailPage";
import { InvoiceFormPage } from "../features/invoices/InvoiceFormPage";
import { InvoicesListPage } from "../features/invoices/InvoicesListPage";
import { PaymentsListPage } from "../features/payments/PaymentsListPage";
import { PlanFormPage } from "../features/membership-plans/PlanFormPage";
import { PlansListPage } from "../features/membership-plans/PlansListPage";
import { MembershipDetailPage } from "../features/memberships/MembershipDetailPage";
import { MembershipsListPage } from "../features/memberships/MembershipsListPage";
import { SellMembershipPage } from "../features/memberships/SellMembershipPage";
import { TrainerDetailPage } from "../features/trainers/TrainerDetailPage";
import { TrainerFormPage } from "../features/trainers/TrainerFormPage";
import { TrainersListPage } from "../features/trainers/TrainersListPage";
import { LeadDetailPage } from "../features/leads/LeadDetailPage";
import { LeadFormPage } from "../features/leads/LeadFormPage";
import { LeadsListPage } from "../features/leads/LeadsListPage";
import { ExpenseFormPage } from "../features/expenses/ExpenseFormPage";
import { ExpensesListPage } from "../features/expenses/ExpensesListPage";
import { ProfitLossPage } from "../features/reports/ProfitLossPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
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

        {/* Selling is nested under the member because a term always belongs to someone. */}
        <Route
          path="members/:memberId/memberships/new"
          element={
            <RequirePermission permission="memberships.create">
              <SellMembershipPage />
            </RequirePermission>
          }
        />

        <Route
          path="membership-plans"
          element={
            <RequirePermission permission="membership-plans.view">
              <PlansListPage />
            </RequirePermission>
          }
        />
        <Route
          path="membership-plans/new"
          element={
            <RequirePermission permission="membership-plans.manage">
              <PlanFormPage mode="create" />
            </RequirePermission>
          }
        />
        <Route
          path="membership-plans/:planId/edit"
          element={
            <RequirePermission permission="membership-plans.manage">
              <PlanFormPage mode="edit" />
            </RequirePermission>
          }
        />

        <Route
          path="memberships"
          element={
            <RequirePermission permission="memberships.view">
              <MembershipsListPage />
            </RequirePermission>
          }
        />
        <Route
          path="memberships/:membershipId"
          element={
            <RequirePermission permission="memberships.view">
              <MembershipDetailPage />
            </RequirePermission>
          }
        />

        <Route
          path="invoices"
          element={
            <RequirePermission permission="invoices.view">
              <InvoicesListPage />
            </RequirePermission>
          }
        />
        {/* Before `:invoiceId`, or "new" would be read as an id. */}
        <Route
          path="invoices/new"
          element={
            <RequirePermission permission="invoices.manage">
              <InvoiceFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="invoices/:invoiceId"
          element={
            <RequirePermission permission="invoices.view">
              <InvoiceDetailPage />
            </RequirePermission>
          }
        />

        <Route
          path="payments"
          element={
            <RequirePermission permission="payments.view">
              <PaymentsListPage />
            </RequirePermission>
          }
        />

        {/*
          Gated on `attendance.view` rather than `.mark`: the register is the screen, and the
          check-in panel inside it hides itself for a role that can only read (1.17.1).
        */}
        <Route
          path="attendance"
          element={
            <RequirePermission permission="attendance.view">
              <AttendancePage />
            </RequirePermission>
          }
        />

        <Route
          path="trainers"
          element={
            <RequirePermission permission="trainers.manage">
              <TrainersListPage />
            </RequirePermission>
          }
        />
        <Route
          path="trainers/new"
          element={
            <RequirePermission permission="trainers.manage">
              <TrainerFormPage mode="create" />
            </RequirePermission>
          }
        />
        <Route
          path="trainers/:trainerId"
          element={
            <RequirePermission permission="trainers.manage">
              <TrainerDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="trainers/:trainerId/edit"
          element={
            <RequirePermission permission="trainers.manage">
              <TrainerFormPage mode="edit" />
            </RequirePermission>
          }
        />

        <Route
          path="leads"
          element={
            <RequirePermission permission="leads.manage">
              <LeadsListPage />
            </RequirePermission>
          }
        />
        <Route
          path="leads/new"
          element={
            <RequirePermission permission="leads.manage">
              <LeadFormPage mode="create" />
            </RequirePermission>
          }
        />
        <Route
          path="leads/:leadId"
          element={
            <RequirePermission permission="leads.manage">
              <LeadDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="leads/:leadId/edit"
          element={
            <RequirePermission permission="leads.manage">
              <LeadFormPage mode="edit" />
            </RequirePermission>
          }
        />

        <Route
          path="expenses"
          element={
            <RequirePermission permission="expenses.manage">
              <ExpensesListPage />
            </RequirePermission>
          }
        />
        <Route
          path="expenses/new"
          element={
            <RequirePermission permission="expenses.manage">
              <ExpenseFormPage mode="create" />
            </RequirePermission>
          }
        />
        <Route
          path="expenses/:expenseId/edit"
          element={
            <RequirePermission permission="expenses.manage">
              <ExpenseFormPage mode="edit" />
            </RequirePermission>
          }
        />

        <Route
          path="reports"
          element={
            <RequirePermission permission="reports.view">
              <ProfitLossPage />
            </RequirePermission>
          }
        />
        <Route
          path="notifications"
          element={
            <RequirePermission permission="notifications.manage">
              <NotificationsPage />
            </RequirePermission>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
