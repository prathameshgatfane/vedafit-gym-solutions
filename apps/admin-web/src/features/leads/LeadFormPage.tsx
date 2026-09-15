import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { TextField } from "../../components/ui/TextField";
import { apiErrorCode, apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { leadFormSchema, type LeadFormValues } from "./lead.schema";
import { useCreateLead, useLead, useLeadAssignees, useUpdateLead } from "./useLeads";

interface LeadFormPageProps {
  mode: "create" | "edit";
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function LeadFormPage({ mode }: LeadFormPageProps) {
  const navigate = useNavigate();
  const { leadId } = useParams<{ leadId: string }>();
  const branches = useSessionStore((s) => s.branches);
  const activeBranchId = useSessionStore((s) => s.activeBranchId);
  const userBranchId = useSessionStore((s) => s.user?.branchId ?? null);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const existing = useLead(isEdit ? leadId : undefined);
  const assignees = useLeadAssignees();
  const branchScoped = userBranchId !== null;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      name: "",
      phone: "",
      source: "",
      branchId: userBranchId ?? activeBranchId ?? (branches.length === 1 ? branches[0]!.id : ""),
      assignedToUserId: "",
      followUpAt: "",
    },
  });

  useEffect(() => {
    if (!isEdit || !existing.data) return;
    reset({
      name: existing.data.name,
      phone: existing.data.phone,
      source: existing.data.source ?? "",
      branchId: existing.data.branchId ?? "",
      assignedToUserId: existing.data.assignedToUserId ?? "",
      followUpAt: toDatetimeLocal(existing.data.followUpAt),
    });
  }, [isEdit, existing.data, reset]);

  const createMutation = useCreateLead();
  const updateMutation = useUpdateLead(leadId ?? "");

  async function onSubmit(values: LeadFormValues) {
    setFormError(null);
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(values);
        navigate(`/leads/${leadId}`, { replace: true });
      } else {
        const created = await createMutation.mutateAsync(values);
        navigate(`/leads/${created.id}`, { replace: true });
      }
    } catch (error) {
      const message = apiErrorMessage(error, "Could not save this lead.");
      if (apiErrorCode(error) === "DUPLICATE_OPEN_LEAD") {
        setError("phone", { type: "server", message });
        setFocus("phone");
        return;
      }
      setFormError(message);
    }
  }

  if (isEdit && existing.isPending) {
    return <Spinner label="Loading lead" />;
  }

  if (isEdit && existing.isError) {
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
        {apiErrorMessage(existing.error, "Could not load this lead.")}
      </p>
    );
  }

  if (isEdit && existing.data?.status === "CONVERTED") {
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
        A converted lead is history — edit the member instead.
      </p>
    );
  }

  const branchOptions = branches.map((branch) => ({ value: branch.id, label: branch.name }));
  const assigneeOptions = (assignees.data ?? []).map((row) => ({
    value: row.id,
    label: `${row.name} · ${row.email}`,
  }));

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-fg">
        {isEdit ? "Edit lead" : "Add lead"}
      </h1>
      <p className="mt-1 text-sm text-accent-muted">
        {isEdit
          ? "Update this enquiry. Status moves live on the lead page, not here."
          : "A walk-in, a DM, a referral — anything that is not a member yet."}
      </p>

      <form
        noValidate
        data-testid="lead-form"
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
      >
        <TextField
          label="Name"
          data-testid="lead-name"
          autoComplete="name"
          error={errors.name?.message}
          {...register("name")}
        />
        <TextField
          label="Phone"
          data-testid="lead-phone"
          autoComplete="tel"
          error={errors.phone?.message}
          {...register("phone")}
        />
        <TextField
          label="Source"
          data-testid="lead-source"
          placeholder="walk-in, instagram, referral…"
          error={errors.source?.message}
          {...register("source")}
        />

        {branchScoped ? (
          <input type="hidden" {...register("branchId")} />
        ) : (
          <Select
            label="Branch"
            data-testid="lead-branch"
            placeholder="Unattributed"
            options={branchOptions}
            error={errors.branchId?.message}
            {...register("branchId")}
          />
        )}

        <Select
          label="Assigned to"
          data-testid="lead-assignee"
          placeholder="Unassigned"
          options={assigneeOptions}
          error={errors.assignedToUserId?.message}
          {...register("assignedToUserId")}
        />

        <TextField
          label="Follow-up"
          data-testid="lead-follow-up"
          type="datetime-local"
          error={errors.followUpAt?.message}
          {...register("followUpAt")}
        />

        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create lead"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
