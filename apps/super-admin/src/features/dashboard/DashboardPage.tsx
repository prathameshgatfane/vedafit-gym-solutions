import { Link } from "react-router-dom";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { useDashboard } from "./useDashboard";

export function DashboardPage() {
  const user = useSessionStore((s) => s.user);
  const { data, isPending, isError, error } = useDashboard();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 data-testid="dashboard-heading" className="text-2xl font-semibold text-brand-white">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-brand-green-muted">
          Signed in as {user?.name}. Counts come from the platform API — they are not computed here.
        </p>
      </div>

      {isPending ? (
        <p className="text-sm text-brand-white/60">Loading fleet counts…</p>
      ) : null}

      {isError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load the dashboard.")}
        </p>
      ) : null}

      {data ? (
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active organizations"
            value={data.organizationsByStatus.ACTIVE}
            to="/organizations?status=ACTIVE"
            testId="stat-active"
          />
          <StatCard
            label="Suspended organizations"
            value={data.organizationsByStatus.SUSPENDED}
            to="/organizations?status=SUSPENDED"
            testId="stat-suspended"
          />
          <StatCard
            label="Trials ending"
            value={data.trialsEnding}
            hint="TRIAL subscriptions ending within 14 days (UTC)"
            testId="stat-trials"
          />
          <StatCard
            label="Signups this period"
            value={data.signupsThisPeriod}
            hint="Organizations created this UTC calendar month"
            testId="stat-signups"
          />
        </dl>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  to,
  testId,
}: {
  label: string;
  value: number;
  hint?: string;
  to?: string;
  testId: string;
}) {
  const body = (
    <>
      <dt className="text-xs uppercase tracking-wide text-brand-white/50">{label}</dt>
      <dd data-testid={testId} className="mt-2 text-3xl font-semibold text-brand-white">
        {value}
      </dd>
      {hint ? <p className="mt-2 text-xs text-brand-white/40">{hint}</p> : null}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-4 hover:border-brand-green/40"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-4">{body}</div>
  );
}
