import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice } from "../../lib/money";
import { useSessionStore } from "../../stores/session.store";
import { useDashboard } from "./useDashboard";
import type { Dashboard, DashboardRevenueWidget } from "./dashboard.types";

/**
 * Recharts needs paint colours, not Tailwind class names. These are the computed values of
 * `brand.green` / `brand.white` from the Section 1.14 palette — keep them in lockstep with
 * `tailwind.config.ts` if the palette is ever eyedropper-corrected.
 */
const CHART = {
  line: "rgb(201, 255, 31)",
  fill: "rgba(201, 255, 31, 0.18)",
  grid: "rgba(254, 249, 245, 0.12)",
  tick: "rgba(254, 249, 245, 0.55)",
  tooltipBg: "rgb(31, 31, 31)",
  tooltipBorder: "rgba(254, 249, 245, 0.15)",
};

function monthLabel(value: string): string {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(month) - 1] ?? month} ${year.slice(2)}`;
}

function scopeLabel(dashboard: Dashboard, fallbackOrg: string): string {
  if (dashboard.scope.branchName) return dashboard.scope.branchName;
  return `${fallbackOrg} · all branches`;
}

export function DashboardPage() {
  const user = useSessionStore((s) => s.user);
  const organization = useSessionStore((s) => s.organization);
  const { data, isPending, isError, error } = useDashboard();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 data-testid="dashboard-heading" className="text-2xl font-semibold text-brand-white">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-brand-green-muted">
          Signed in as {user?.name} · {organization?.name}
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-4">
          <dt className="text-xs uppercase tracking-wide text-brand-white/50">Organization</dt>
          <dd data-testid="stat-organization" className="mt-1 text-sm text-brand-white">
            {organization?.name}
          </dd>
        </div>
        <div className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-4">
          <dt className="text-xs uppercase tracking-wide text-brand-white/50">Role</dt>
          <dd data-testid="stat-role" className="mt-1 text-sm text-brand-white">
            {user?.role.name}
          </dd>
        </div>
        <div className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-4">
          <dt className="text-xs uppercase tracking-wide text-brand-white/50">Showing</dt>
          <dd data-testid="stat-scope" className="mt-1 text-sm text-brand-white">
            {data ? scopeLabel(data, organization?.name ?? "") : "…"}
          </dd>
        </div>
      </dl>

      {isPending ? (
        <p role="status" className="text-sm text-brand-white/50">
          Loading this month's numbers…
        </p>
      ) : null}

      {isError ? (
        <p role="alert" className="text-sm text-red-300">
          {apiErrorMessage(error, "Could not load the dashboard.")}
        </p>
      ) : null}

      {data ? <WidgetGrid dashboard={data} /> : null}
    </div>
  );
}

function WidgetGrid({ dashboard }: { dashboard: Dashboard }) {
  const { widgets } = dashboard;
  const hasAny = Object.keys(widgets).length > 0;

  if (!hasAny) {
    return (
      <p data-testid="dashboard-empty" className="text-sm text-brand-white/50">
        Nothing on this screen for your role yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {widgets.members ? (
          <MetricCard
            testId="widget-members"
            label="Members on the books"
            value={String(widgets.members.total)}
            hint={`${widgets.members.active} with cover today`}
            href="/members"
          />
        ) : null}
        {widgets.revenue ? (
          <MetricCard
            testId="widget-revenue"
            label={`Revenue · ${monthLabel(widgets.revenue.month)}`}
            value={formatPrice(widgets.revenue.total)}
            hint="Cash collected, net of refunds"
          />
        ) : null}
        {widgets.outstanding ? (
          <MetricCard
            testId="widget-outstanding"
            label="Outstanding fees"
            value={formatPrice(widgets.outstanding.amount)}
            hint={
              widgets.outstanding.invoiceCount === 1
                ? "1 open invoice"
                : `${widgets.outstanding.invoiceCount} open invoices`
            }
            href="/invoices"
          />
        ) : null}
        {widgets.attendance ? (
          <MetricCard
            testId="widget-attendance"
            label="Checked in today"
            value={String(widgets.attendance.count)}
            hint={widgets.attendance.date}
            href="/attendance"
          />
        ) : null}
      </div>

      {widgets.revenue ? <RevenueTrend revenue={widgets.revenue} /> : null}

      {widgets.expiring ? <ExpiringList widget={widgets.expiring} /> : null}
    </div>
  );
}

function MetricCard({
  testId,
  label,
  value,
  hint,
  href,
}: {
  testId: string;
  label: string;
  value: string;
  hint: string;
  href?: string;
}) {
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wide text-brand-white/50">{label}</p>
      <p data-testid={`${testId}-value`} className="mt-2 text-2xl font-semibold text-brand-green">
        {value}
      </p>
      <p className="mt-1 text-xs text-brand-white/50">{hint}</p>
    </>
  );

  const classes =
    "rounded-lg border border-brand-white/10 bg-brand-black-88 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green";

  if (href) {
    return (
      <Link data-testid={testId} to={href} className={`${classes} block hover:border-brand-green/40`}>
        {inner}
      </Link>
    );
  }

  return (
    <div data-testid={testId} className={classes}>
      {inner}
    </div>
  );
}

function RevenueTrend({ revenue }: { revenue: DashboardRevenueWidget }) {
  const points = revenue.trend.map((row) => ({
    month: monthLabel(row.month),
    total: Number(row.total),
    label: formatPrice(row.total),
  }));

  return (
    <section
      data-testid="widget-revenue-trend"
      className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-4"
    >
      <h2 className="text-sm font-medium text-brand-white">Revenue, last six months</h2>
      <p className="mt-1 text-xs text-brand-white/50">
        Dated by when the money arrived, in the gym's timezone — not by when the bill was raised.
      </p>
      <div className="mt-4 h-56 w-full" data-testid="revenue-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="month"
              stroke={CHART.tick}
              tick={{ fill: CHART.tick, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              stroke={CHART.tick}
              tick={{ fill: CHART.tick, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={(value: number) =>
                `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
              }
            />
            <Tooltip
              cursor={{ stroke: CHART.grid }}
              contentStyle={{
                background: CHART.tooltipBg,
                border: `1px solid ${CHART.tooltipBorder}`,
                borderRadius: 8,
                color: "rgb(254, 249, 245)",
              }}
              formatter={(value: number) => [formatPrice(value.toFixed(2)), "Collected"]}
            />
            <Area
              type="monotone"
              dataKey="total"
              stroke={CHART.line}
              fill={CHART.fill}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ExpiringList({
  widget,
}: {
  widget: NonNullable<Dashboard["widgets"]["expiring"]>;
}) {
  return (
    <section
      data-testid="widget-expiring"
      className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-4"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium text-brand-white">
          Expiring in the next {widget.withinDays} days
        </h2>
        <Link to="/memberships" className="text-xs text-brand-green hover:underline">
          {widget.count} {widget.count === 1 ? "term" : "terms"}
        </Link>
      </div>
      {widget.items.length === 0 ? (
        <p className="mt-3 text-sm text-brand-white/50">No renewals due this week.</p>
      ) : (
        <ul className="mt-3 divide-y divide-brand-white/10">
          {widget.items.map((item) => (
            <li key={item.membershipId} className="flex items-center justify-between gap-4 py-2">
              <Link
                to={`/members/${item.memberId}`}
                className="text-sm text-brand-white hover:text-brand-green"
              >
                {item.firstName} {item.lastName}
                <span className="ml-2 text-xs text-brand-white/50">{item.planName}</span>
              </Link>
              <span className="text-xs text-brand-white/60">
                {item.daysRemaining === 0
                  ? "today"
                  : item.daysRemaining === 1
                    ? "tomorrow"
                    : `${item.daysRemaining} days`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
