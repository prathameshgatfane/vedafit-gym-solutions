import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { TextField } from "../../components/ui/TextField";
import { apiErrorCode, apiErrorMessage } from "../../lib/api-client";
import { planFormSchema, type PlanFormValues } from "./plan.schema";
import { useCreatePlan, usePlan, useUpdatePlan } from "./usePlans";

interface PlanFormPageProps {
  mode: "create" | "edit";
}

export function PlanFormPage({ mode }: PlanFormPageProps) {
  const navigate = useNavigate();
  const { planId } = useParams<{ planId: string }>();
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const existing = usePlan(isEdit ? planId : undefined);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: { name: "", price: "", durationDays: "30", status: "ACTIVE" },
  });

  // Populate once the record arrives — `useForm` defaults are only read on first render.
  useEffect(() => {
    if (!isEdit || !existing.data) return;
    reset({
      name: existing.data.name,
      price: existing.data.price,
      durationDays: String(existing.data.durationDays),
      status: existing.data.status,
    });
  }, [isEdit, existing.data, reset]);

  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan(planId ?? "");

  async function onSubmit(values: PlanFormValues) {
    setFormError(null);
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(values);
      } else {
        await createMutation.mutateAsync(values);
      }
      navigate("/membership-plans", { replace: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Could not save this plan.");

      // A name clash is a problem with one specific field, so it belongs on that field where the
      // fix is, not only in a banner at the top of the form.
      if (apiErrorCode(error) === "DUPLICATE_PLAN_NAME") {
        setError("name", { type: "server", message });
        setFocus("name");
        return;
      }

      setFormError(message);
    }
  }

  if (isEdit && existing.isPending) {
    return <Spinner label="Loading plan" />;
  }

  if (isEdit && existing.isError) {
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
        {apiErrorMessage(existing.error, "Could not load this plan.")}
      </p>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-fg">
        {isEdit ? "Edit plan" : "Add plan"}
      </h1>
      <p className="mt-1 text-sm text-accent-muted">
        {isEdit
          ? "Changes apply to memberships sold from now on — existing terms keep their price."
          : "Define what a membership costs and how long it lasts."}
      </p>

      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
      >
        <TextField
          label="Plan name"
          placeholder="Gold — Quarterly"
          error={errors.name?.message}
          {...register("name")}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Price (₹)"
            inputMode="decimal"
            placeholder="1500.00"
            error={errors.price?.message}
            {...register("price")}
          />
          <TextField
            label="Duration (days)"
            inputMode="numeric"
            placeholder="30"
            error={errors.durationDays?.message}
            {...register("durationDays")}
          />
        </div>

        <Select
          label="Status"
          options={[
            { value: "ACTIVE", label: "Active — can be sold" },
            { value: "INACTIVE", label: "Retired — no new sales" },
          ]}
          error={errors.status?.message}
          {...register("status")}
        />

        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create plan"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
