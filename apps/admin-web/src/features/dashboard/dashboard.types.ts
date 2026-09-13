/** Mirrors `DashboardResponse` in apps/api/src/modules/reports/report.service.ts. */

export interface DashboardMembersWidget {
  total: number;
  active: number;
}

export interface DashboardRevenueWidget {
  month: string;
  total: string;
  trend: { month: string; total: string }[];
}

export interface DashboardOutstandingWidget {
  amount: string;
  invoiceCount: number;
}

export interface DashboardExpiringItem {
  membershipId: string;
  memberId: string;
  firstName: string;
  lastName: string;
  phone: string;
  planName: string;
  endDate: string;
  daysRemaining: number;
}

export interface DashboardExpiringWidget {
  withinDays: number;
  count: number;
  items: DashboardExpiringItem[];
}

export interface DashboardAttendanceWidget {
  date: string;
  count: number;
}

export interface DashboardWidgets {
  members?: DashboardMembersWidget;
  revenue?: DashboardRevenueWidget;
  outstanding?: DashboardOutstandingWidget;
  expiring?: DashboardExpiringWidget;
  attendance?: DashboardAttendanceWidget;
}

export interface Dashboard {
  asOf: string;
  timezone: string;
  month: string;
  scope: { branchId: string | null; branchName: string | null };
  widgets: DashboardWidgets;
}
