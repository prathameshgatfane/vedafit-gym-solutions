import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { EntitlementEditor, type EntitlementEditorProps } from "./EntitlementEditor";
import { emptyPlanFormValues, planChangeLines, planToFormValues, toCreatePlanInput } from "./plan-form.utils";
import { planFormSchema, type PlanFormValues } from "./plan.schema";
import { useCreatePlan, usePlan, useUpdatePlan } from "./usePlans";

export function PlanFormPage() {
  const { planId } = useParams<{ planId: string }>();
  const isEdit = Boolean(planId);
  const navigate = useNavigate();
  const existing = usePlan(planId);
  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan(planId ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingValues, setPendingValues] = useState<PlanFormValues | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: emptyPlanFormValues(),
  });

  useEffect(() => {
    if (existing.data) reset(planToFormValues(existing.data));
  }, [existing.data, reset]);

  const entitlements = watch("entitlements");
  const pending = createMutation.isPending || updateMutation.isPending || isSubmitting;

  if (isEdit && existing.isPending) {
    return <p className="text-sm text-fg-muted">Loading plan…</p>;
  }

  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
        {apiErrorMessage(existing.error, "Could not load this plan.")}
      </p>
    );
  }

  const organizationCount = existing.data?.organizationCount ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link to="/plans" className="text-sm text-accent-text hover:underline">
        ← SaaS plans
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-fg">
        {isEdit ? `Edit ${existing.data?.name}` : "New SaaS plan"}
      </h1>
      <p className="mt-1 text-sm text-accent-muted">
        Plan changes apply immediately to every organization currently on this plan. Stored
        subscription prices are not rewritten.
      </p>

      <form
        noValidate
        className="mt-6 flex flex-col gap-4"
        onSubmit={handleSubmit((values) => {
          setFormError(null);
          setPendingValues(values);
        })}
      >
        <TextField label="Name" error={errors.name?.message} {...register("name")} />
        <TextField
          label="Code"
          error={errors.code?.message}
          disabled={isEdit}
          autoComplete="off"
          {...register("code")}
        />
        <TextField
          label="Description (optional)"
          error={errors.description?.message}
          {...register("description")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Monthly price"
            inputMode="decimal"
            error={errors.priceMonthly?.message}
            {...register("priceMonthly")}
          />
          <TextField
            label="Yearly price"
            inputMode="decimal"
            error={errors.priceYearly?.message}
            {...register("priceYearly")}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Currency"
            error={errors.currency?.message}
            {...register("currency")}
          />
          <TextField
            label="Trial days"
            inputMode="numeric"
            error={errors.trialDays?.message}
            {...register("trialDays")}
          />
        </div>

        <EntitlementEditor
          values={entitlements}
          errors={errors.entitlements as EntitlementEditorProps["errors"]}
          setValue={setValue}
        />

        {errors.entitlements?.root?.message || errors.entitlements?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.entitlements.root?.message ?? errors.entitlements.message}
          </p>
        ) : null}

        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" data-testid="review-plan" disabled={pending}>
            Review plan {isEdit ? "changes" : "create"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate("/plans")}>
            Cancel
          </Button>
        </div>
      </form>

      {pendingValues ? (
        <ConfirmDialog
          title={isEdit ? "Apply plan changes?" : "Create this SaaS plan?"}
          message={
            <div className="space-y-3" data-testid="plan-impact">
              {isEdit ? (
                <p>
                  {organizationCount === 1
                    ? "1 organization currently on this plan will receive the new limits immediately."
                    : `${organizationCount} organizations currently on this plan will receive the new limits immediately.`}{" "}
                  Stored subscription prices are unchanged.
                </p>
              ) : (
                <p>This creates a catalog plan. No organization is assigned until you choose it later.</p>
              )}
              <ul className="list-disc space-y-1 pl-5">
                {(isEdit && existing.data
                  ? planChangeLines(planToFormValues(existing.data), pendingValues)
                  : [
                      `${pendingValues.name} (${pendingValues.code})`,
                      `₹${pendingValues.priceMonthly} / month`,
                    ]
                ).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {isEdit && existing.data && planChangeLines(planToFormValues(existing.data), pendingValues).length === 0 ? (
                <p>No field values changed.</p>
              ) : null}
            </div>
          }
          confirmLabel={isEdit ? "Apply changes" : "Create plan"}
          pending={pending}
          onCancel={() => setPendingValues(null)}
          onConfirm={() => {
            void (async () => {
              try {
                if (isEdit) {
                  const input = toCreatePlanInput(pendingValues);
                  await updateMutation.mutateAsync({
                    name: input.name,
                    description: input.description,
                    priceMonthly: input.priceMonthly,
                    priceYearly: input.priceYearly,
                    currency: input.currency,
                    trialDays: input.trialDays,
                    entitlements: input.entitlements,
                  });
                } else {
                  await createMutation.mutateAsync(toCreatePlanInput(pendingValues));
                }
                setPendingValues(null);
                navigate("/plans", { replace: true });
              } catch (error) {
                setFormError(
                  apiErrorMessage(error, isEdit ? "Could not update this plan." : "Could not create this plan."),
                );
                setPendingValues(null);
              }
            })();
          }}
        />
      ) : null}
    </div>
  );
}
