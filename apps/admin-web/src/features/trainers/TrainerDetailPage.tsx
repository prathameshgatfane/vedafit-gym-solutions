import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { apiErrorMessage } from "../../lib/api-client";
import { AssignMemberPanel } from "./AssignMemberPanel";
import { useTrainer, useUnassignTrainerMember } from "./useTrainers";

export function TrainerDetailPage() {
  const navigate = useNavigate();
  const { trainerId } = useParams<{ trainerId: string }>();
  const { data: trainer, isPending, isError, error } = useTrainer(trainerId);
  const unassign = useUnassignTrainerMember(trainerId ?? "");

  if (isPending) return <Spinner label="Loading trainer" />;

  if (isError || !trainer) {
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
        {apiErrorMessage(error, "Could not load this trainer.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 data-testid="trainer-detail-heading" className="text-2xl font-semibold text-fg">
            {trainer.user.name}
          </h1>
          <p className="mt-1 text-sm text-accent-muted">{trainer.user.email}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/trainers/${trainer.id}/edit`)}>
          Edit profile
        </Button>
      </div>

      <dl
        data-testid="trainer-profile"
        className="grid gap-4 rounded-lg border border-border bg-surface p-6 sm:grid-cols-3"
      >
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-muted">Specialization</dt>
          <dd data-testid="trainer-specialization-value" className="mt-1 text-sm text-fg">
            {trainer.specialization ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-muted">Commission</dt>
          <dd className="mt-1 text-sm text-fg">
            {trainer.commissionPct ? `${trainer.commissionPct}%` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-muted">On the roster</dt>
          <dd className="mt-1 text-sm text-fg">{trainer.assignments.length}</dd>
        </div>
      </dl>

      <section
        data-testid="trainer-roster"
        className="rounded-lg border border-border bg-surface p-6"
      >
        <h2 className="text-lg font-semibold text-fg">Assigned members</h2>
        <p className="mt-1 text-sm text-fg-muted">
          This is the ACL the trainer&apos;s members and attendance screens filter on.
        </p>

        <div className="mt-4 overflow-hidden rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Assigned</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fg/5">
              {trainer.assignments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-fg-muted">
                    No members assigned yet.
                  </td>
                </tr>
              ) : (
                trainer.assignments.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="roster-row"
                    data-member-id={row.memberId}
                    className="bg-bg"
                  >
                    <td className="px-4 py-3 font-medium text-fg">
                      <Link
                        to={`/members/${row.memberId}`}
                        className="hover:text-accent-text"
                      >
                        {row.member.firstName} {row.member.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-fg/70">{row.member.phone}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {new Date(row.assignedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        data-testid="unassign-button"
                        variant="secondary"
                        disabled={unassign.isPending}
                        onClick={() => unassign.mutate(row.memberId)}
                      >
                        Unassign
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AssignMemberPanel
        trainerId={trainer.id}
        assignedMemberIds={trainer.assignments.map((row) => row.memberId)}
      />
    </div>
  );
}
