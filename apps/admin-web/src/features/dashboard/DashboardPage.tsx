import { useSessionStore } from "../../stores/session.store";

/**
 * Deliberately an empty shell. Phase 3's Definition of Done is "land on an empty dashboard
 * shell"; real metrics arrive in Phase 8, on top of data that doesn't exist until Phases 4-7.
 * What it does show is session context, which is the thing Phase 3 actually built.
 */
export function DashboardPage() {
  const user = useSessionStore((s) => s.user);
  const organization = useSessionStore((s) => s.organization);
  const branches = useSessionStore((s) => s.branches);

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
          <dt className="text-xs uppercase tracking-wide text-brand-white/50">Branches</dt>
          <dd data-testid="stat-branches" className="mt-1 text-sm text-brand-white">
            {branches.length}
          </dd>
        </div>
      </dl>

      <p className="text-sm text-brand-white/50">
        Members, memberships and payments arrive in later phases.
      </p>
    </div>
  );
}
