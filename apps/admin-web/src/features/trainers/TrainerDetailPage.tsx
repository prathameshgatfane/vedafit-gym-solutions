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
      <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {apiErrorMessage(error, "Could not load this trainer.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 data-testid="trainer-detail-heading" className="text-2xl font-semibold text-brand-white">
            {trainer.user.name}
          </h1>
          <p className="mt-1 text-sm text-brand-green-muted">{trainer.user.email}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/trainers/${trainer.id}/edit`)}>
          Edit profile
        </Button>
      </div>

      <dl
        data-testid="trainer-profile"
        className="grid gap-4 rounded-lg border border-brand-white/10 bg-brand-black-88 p-6 sm:grid-cols-3"
      >
        <div>
          <dt className="text-xs uppercase tracking-wide text-brand-white/50">Specialization</dt>
          <dd data-testid="trainer-specialization-value" className="mt-1 text-sm text-brand-white">
            {trainer.specialization ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-brand-white/50">Commission</dt>
          <dd className="mt-1 text-sm text-brand-white">
            {trainer.commissionPct ? `${trainer.commissionPct}%` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-brand-white/50">On the roster</dt>
          <dd className="mt-1 text-sm text-brand-white">{trainer.assignments.length}</dd>
        </div>
      </dl>

      <section
        data-testid="trainer-roster"
        className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-6"
      >
        <h2 className="text-lg font-semibold text-brand-white">Assigned members</h2>
        <p className="mt-1 text-sm text-brand-white/50">
          This is the ACL the trainer&apos;s members and attendance screens filter on.
        </p>

        <div className="mt-4 overflow-hidden rounded-md border border-brand-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-black text-xs uppercase tracking-wide text-brand-white/50">
              <tr>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Assigned</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-white/5">
              {trainer.assignments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-brand-white/50">
                    No members assigned yet.
                  </td>
                </tr>
              ) : (
                trainer.assignments.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="roster-row"
                    data-member-id={row.memberId}
                    className="bg-brand-black"
                  >
                    <td className="px-4 py-3 font-medium text-brand-white">
                      <Link
                        to={`/members/${row.memberId}`}
                        className="hover:text-brand-green"
                      >
                        {row.member.firstName} {row.member.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-brand-white/70">{row.member.phone}</td>
                    <td className="px-4 py-3 text-brand-white/50">
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
