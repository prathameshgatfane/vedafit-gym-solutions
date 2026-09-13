import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { MemberBillingPanel } from "../invoices/MemberBillingPanel";
import { MemberMembershipsPanel } from "../memberships/MemberMembershipsPanel";
import { useArchiveMember, useMember } from "./useMembers";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-brand-white/50">{label}</dt>
      <dd className="mt-1 text-sm text-brand-white">{children}</dd>
    </div>
  );
}

export function MemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const { data: member, isPending, isError, error } = useMember(memberId);
  const branches = useSessionStore((s) => s.branches);
  const canUpdate = useSessionStore((s) => s.hasPermission("members.update"));
  const canArchive = useSessionStore((s) => s.hasPermission("members.archive"));
  const canViewInvoices = useSessionStore((s) => s.hasPermission("invoices.view"));

  const archiveMutation = useArchiveMember();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  if (isPending) return <Spinner label="Loading member" />;

  if (isError || !member) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load this member.")}
        </p>
        <Button variant="secondary" onClick={() => navigate("/members")}>
          Back to members
        </Button>
      </div>
    );
  }

  const branchName = branches.find((b) => b.id === member.branchId)?.name ?? member.branchId;
  const isArchived = member.status === "ARCHIVED";

  async function handleArchive() {
    setArchiveError(null);
    try {
      await archiveMutation.mutateAsync(member!.id);
      setConfirmingArchive(false);
    } catch (err) {
      // The most likely failure is PERMISSION_DENIED from a role that shouldn't have seen the
      // button at all — surfaced rather than swallowed, since the server is the real authority.
      setArchiveError(apiErrorMessage(err, "Could not archive this member."));
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/members" className="text-sm text-brand-green-muted hover:text-brand-green">
          ← Back to members
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 data-testid="member-name" className="text-2xl font-semibold text-brand-white">
            {member.firstName} {member.lastName}
          </h1>
          <div className="mt-2">
            <StatusBadge status={member.status} />
          </div>
        </div>

        <div className="flex gap-2">
          {canUpdate && !isArchived ? (
            <Button variant="secondary" onClick={() => navigate(`/members/${member.id}/edit`)}>
              Edit
            </Button>
          ) : null}
          {/* Hidden without the permission — and still refused by the API if it were reached. */}
          {canArchive && !isArchived ? (
            <Button
              variant="danger"
              data-testid="archive-button"
              onClick={() => setConfirmingArchive(true)}
            >
              Archive
            </Button>
          ) : null}
        </div>
      </div>

      {confirmingArchive ? (
        <div
          role="alertdialog"
          aria-label="Confirm archive"
          className="rounded-lg border border-red-400/40 bg-brand-black-88 p-4"
        >
          <p className="text-sm text-brand-white">
            Archive {member.firstName} {member.lastName}? Their record stays readable and their
            phone number becomes available for a new member.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              data-testid="confirm-archive"
              disabled={archiveMutation.isPending}
              onClick={handleArchive}
            >
              {archiveMutation.isPending ? "Archiving…" : "Yes, archive"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmingArchive(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {archiveError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {archiveError}
        </p>
      ) : null}

      <dl className="grid gap-5 rounded-lg border border-brand-white/10 bg-brand-black-88 p-6 sm:grid-cols-2">
        <Field label="Phone">{member.phone}</Field>
        <Field label="Email">{member.email ?? "—"}</Field>
        <Field label="Date of birth">{member.dateOfBirth ?? "—"}</Field>
        <Field label="Branch">{branchName}</Field>
        <Field label="Member since">{new Date(member.createdAt).toLocaleDateString()}</Field>
        <Field label="Last updated">{new Date(member.updatedAt).toLocaleDateString()}</Field>
      </dl>

      <MemberMembershipsPanel memberId={member.id} canSell={!isArchived} />

      {canViewInvoices ? <MemberBillingPanel memberId={member.id} /> : null}

      <p className="text-sm text-brand-white/40">Attendance appears here in a later phase.</p>
    </div>
  );
}
