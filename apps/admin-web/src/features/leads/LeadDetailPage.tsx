import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { convertLeadSchema, splitLeadName, type ConvertLeadValues } from "./lead.schema";
import { TRANSITION_LABELS, type LeadStatus } from "./lead.types";
import { useConvertLead, useLead, useTransitionLead } from "./useLeads";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-brand-white/50">{label}</dt>
      <dd className="mt-1 text-sm text-brand-white">{children}</dd>
    </div>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function LeadDetailPage() {
  const navigate = useNavigate();
  const { leadId } = useParams<{ leadId: string }>();
  const { data: lead, isPending, isError, error } = useLead(leadId);
  const transition = useTransitionLead(leadId ?? "");
  const convert = useConvertLead(leadId ?? "");
  const branches = useSessionStore((s) => s.branches);
  const userBranchId = useSessionStore((s) => s.user?.branchId ?? null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ConvertLeadValues>({
    resolver: zodResolver(convertLeadSchema),
    defaultValues: { firstName: "", lastName: "", branchId: "", email: "" },
  });

  useEffect(() => {
    if (!lead) return;
    const names = splitLeadName(lead.name);
    reset({
      firstName: names.firstName,
      lastName: names.lastName,
      branchId: userBranchId ?? lead.branchId ?? (branches.length === 1 ? branches[0]!.id : ""),
      email: "",
    });
  }, [lead, reset, userBranchId, branches]);

  if (isPending) return <Spinner label="Loading lead" />;

  if (isError || !lead) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load this lead.")}
        </p>
        <Button variant="secondary" onClick={() => navigate("/leads")}>
          Back to leads
        </Button>
      </div>
    );
  }

  const open = lead.status !== "CONVERTED" && lead.status !== "LOST";
  const pipelineMoves = lead.allowedTransitions.filter((status) => status !== "CONVERTED");

  async function runTransition(status: LeadStatus) {
    setActionError(null);
    try {
      await transition.mutateAsync(status);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not move this lead."));
    }
  }

  async function onConvert(values: ConvertLeadValues) {
    setActionError(null);
    try {
      await convert.mutateAsync(values);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not convert this lead."));
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/leads" className="text-sm text-brand-green-muted hover:text-brand-green">
          ← Back to leads
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 data-testid="lead-detail-heading" className="text-2xl font-semibold text-brand-white">
            {lead.name}
          </h1>
          <p className="mt-1 text-sm text-brand-green-muted">{lead.phone}</p>
          <div className="mt-2">
            <StatusBadge status={lead.status} />
          </div>
        </div>
        {lead.status !== "CONVERTED" ? (
          <Button variant="secondary" onClick={() => navigate(`/leads/${lead.id}/edit`)}>
            Edit
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </p>
      ) : null}

      <dl
        data-testid="lead-profile"
        className="grid gap-5 rounded-lg border border-brand-white/10 bg-brand-black-88 p-6 sm:grid-cols-2"
      >
        <Field label="Source">{lead.source ?? "—"}</Field>
        <Field label="Branch">{lead.branch?.name ?? "Unattributed"}</Field>
        <Field label="Assigned to">{lead.assignedTo?.name ?? "Unassigned"}</Field>
        <Field label="Follow-up">{formatWhen(lead.followUpAt)}</Field>
      </dl>

      {lead.status === "CONVERTED" && lead.convertedMember ? (
        <p
          data-testid="converted-banner"
          className="rounded-md border border-brand-green/25 bg-brand-green/5 px-4 py-3 text-sm text-brand-green-muted"
        >
          Converted to{" "}
          <Link
            to={`/members/${lead.convertedMember.id}`}
            className="font-semibold text-brand-green hover:underline"
          >
            {lead.convertedMember.firstName} {lead.convertedMember.lastName}
          </Link>
          . This lead is how they arrived — edit the member, not this row.
        </p>
      ) : null}

      {pipelineMoves.length > 0 ? (
        <section
          data-testid="pipeline-actions"
          className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-6"
        >
          <h2 className="text-lg font-semibold text-brand-white">Pipeline</h2>
          <p className="mt-1 text-sm text-brand-white/50">
            Forward and skip are allowed. Backward among open statuses is not. Lost reopens only
            to Contacted.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {pipelineMoves.map((status) => (
              <Button
                key={status}
                data-testid={`transition-${status}`}
                variant={status === "LOST" ? "danger" : "secondary"}
                disabled={transition.isPending}
                onClick={() => void runTransition(status)}
              >
                {TRANSITION_LABELS[status]}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {open ? (
        <section
          data-testid="convert-panel"
          className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-6"
        >
          <h2 className="text-lg font-semibold text-brand-white">Convert to member</h2>
          <p className="mt-1 text-sm text-brand-white/50">
            Creates a member with this phone in the same step. The lead then becomes read-only
            history.
          </p>
          <form
            noValidate
            data-testid="convert-form"
            onSubmit={handleSubmit(onConvert)}
            className="mt-4 flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="First name"
                data-testid="convert-first-name"
                error={errors.firstName?.message}
                {...register("firstName")}
              />
              <TextField
                label="Last name"
                data-testid="convert-last-name"
                error={errors.lastName?.message}
                {...register("lastName")}
              />
            </div>
            {userBranchId ? (
              <input type="hidden" {...register("branchId")} />
            ) : (
              <Select
                label="Home branch"
                data-testid="convert-branch"
                placeholder="Pick a branch"
                options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
                error={errors.branchId?.message}
                {...register("branchId")}
              />
            )}
            <TextField
              label="Email (optional)"
              type="email"
              autoComplete="email"
              error={errors.email?.message}
              {...register("email")}
            />
            <div>
              <Button type="submit" data-testid="convert-submit" disabled={isSubmitting}>
                {isSubmitting ? "Converting…" : "Convert to member"}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
