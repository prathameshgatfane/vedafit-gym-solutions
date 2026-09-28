import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { MemberBillingPanel } from "../invoices/MemberBillingPanel";
import { MemberMembershipsPanel } from "../memberships/MemberMembershipsPanel";
import { portalPasswordFieldError } from "./member.schema";
import type { PortalPasswordResult } from "./member.types";
import { useArchiveMember, useMember, useSetMemberPortalPassword } from "./useMembers";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="mt-1 text-sm text-fg">{children}</dd>
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
  const portalMutation = useSetMemberPortalPassword();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  const [portalPassword, setPortalPassword] = useState("");
  const [portalFieldError, setPortalFieldError] = useState<string | undefined>();
  const [portalError, setPortalError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<PortalPasswordResult | null>(null);
  const [copied, setCopied] = useState(false);

  if (isPending) return <Spinner label="Loading member" />;

  if (isError || !member) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
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

  function openPortalDialog() {
    setPortalDialogOpen(true);
    setPortalPassword("");
    setPortalFieldError(undefined);
    setPortalError(null);
    setCopied(false);
  }

  function closePortalDialog() {
    setPortalDialogOpen(false);
    setPortalPassword("");
    setPortalFieldError(undefined);
  }

  async function submitPortalPassword(password?: string) {
    const trimmed = password?.trim();
    if (trimmed) {
      const fieldError = portalPasswordFieldError(trimmed);
      if (fieldError) {
        setPortalFieldError(fieldError);
        return;
      }
    }
    setPortalFieldError(undefined);
    setPortalError(null);
    try {
      const result = await portalMutation.mutateAsync({
        memberId: member!.id,
        password: trimmed || undefined,
      });
      setRevealed(result);
      closePortalDialog();
    } catch (err) {
      setPortalError(apiErrorMessage(err, "Could not set the portal password."));
    }
  }

  async function copyTemporaryPassword() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function dismissRevealed() {
    setRevealed(null);
    setCopied(false);
  }

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
        <Link to="/members" className="text-sm text-accent-muted hover:text-accent-text">
          ← Back to members
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 data-testid="member-name" className="text-2xl font-semibold text-fg">
            {member.firstName} {member.lastName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={member.status} />
            <span
              data-testid="portal-badge"
              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                member.portalEnabled
                  ? "bg-accent/15 text-accent-text border-accent/40"
                  : "bg-fg/10 text-fg-muted border-fg/25"
              }`}
            >
              {member.portalEnabled ? "Portal enabled" : "Portal not enabled"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {canUpdate && !isArchived ? (
            <Button variant="secondary" onClick={() => navigate(`/members/${member.id}/edit`)}>
              Edit
            </Button>
          ) : null}
          {canUpdate && !isArchived ? (
            <Button
              variant="secondary"
              data-testid="portal-password-button"
              onClick={openPortalDialog}
            >
              {member.portalEnabled ? "Reset portal password" : "Enable portal"}
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
          className="rounded-lg border border-danger/40 bg-surface p-4"
        >
          <p className="text-sm text-fg">
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
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {archiveError}
        </p>
      ) : null}

      {portalDialogOpen ? (
        <div
          role="dialog"
          aria-label={member.portalEnabled ? "Reset portal password" : "Enable portal"}
          data-testid="portal-password-dialog"
          className="rounded-lg border border-accent/30 bg-surface p-4"
        >
          <h2 className="text-sm font-semibold text-fg">
            {member.portalEnabled ? "Reset portal password" : "Enable portal"}
          </h2>
          <p className="mt-1 text-sm text-fg/70">
            {member.portalEnabled
              ? "This replaces the current password and signs the member out of the app. Leave the field blank to generate a temporary password, or type one they can read at the desk."
              : "The member can then sign into the app with their exact stored phone, this gym's slug, and the password shown next. Leave the field blank to generate one."}
          </p>
          <div className="mt-3 max-w-sm">
            <TextField
              data-testid="portal-password-input"
              label="Temporary password (optional)"
              type="text"
              autoComplete="off"
              value={portalPassword}
              error={portalFieldError}
              onChange={(e) => {
                setPortalPassword(e.target.value);
                setPortalFieldError(undefined);
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              data-testid="portal-generate"
              disabled={portalMutation.isPending}
              onClick={() => void submitPortalPassword()}
            >
              {portalMutation.isPending ? "Saving…" : "Generate"}
            </Button>
            <Button
              variant="secondary"
              data-testid="portal-set-password"
              disabled={portalMutation.isPending || portalPassword.trim() === ""}
              onClick={() => void submitPortalPassword(portalPassword)}
            >
              Set password
            </Button>
            <Button variant="secondary" onClick={closePortalDialog}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {portalError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {portalError}
        </p>
      ) : null}

      {revealed ? (
        <div
          role="status"
          data-testid="portal-password-revealed"
          className="rounded-lg border border-warning/40 bg-warning/5 p-4"
        >
          <h2 className="text-sm font-semibold text-fg">Give these to the member now</h2>
          <p className="mt-1 text-sm text-warning">
            This password is shown once. Closing this panel loses it — it is never stored on the
            member record and cannot be retrieved later.
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-muted">Phone</dt>
              <dd data-testid="portal-revealed-phone" className="mt-1 font-mono text-sm text-fg">
                {revealed.phone}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-muted">Gym slug</dt>
              <dd data-testid="portal-revealed-slug" className="mt-1 font-mono text-sm text-fg">
                {revealed.organizationSlug}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-muted">Temporary password</dt>
              <dd
                data-testid="portal-temp-password"
                className="mt-1 font-mono text-sm text-fg"
              >
                {revealed.temporaryPassword}
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button data-testid="portal-copy" onClick={() => void copyTemporaryPassword()}>
              {copied ? "Copied" : "Copy password"}
            </Button>
            <Button variant="secondary" data-testid="portal-dismiss" onClick={dismissRevealed}>
              I&apos;ve copied this
            </Button>
          </div>
        </div>
      ) : null}

      <dl className="grid gap-5 rounded-lg border border-border bg-surface p-6 sm:grid-cols-2">
        <Field label="Phone">{member.phone}</Field>
        <Field label="Email">{member.email ?? "—"}</Field>
        <Field label="Date of birth">{member.dateOfBirth ?? "—"}</Field>
        <Field label="Branch">{branchName}</Field>
        <Field label="Member since">{new Date(member.createdAt).toLocaleDateString()}</Field>
        <Field label="Last updated">{new Date(member.updatedAt).toLocaleDateString()}</Field>
      </dl>

      <MemberMembershipsPanel memberId={member.id} canSell={!isArchived} />

      {canViewInvoices ? <MemberBillingPanel memberId={member.id} /> : null}

      <p className="text-sm text-fg-muted">Attendance appears here in a later phase.</p>
    </div>
  );
}
