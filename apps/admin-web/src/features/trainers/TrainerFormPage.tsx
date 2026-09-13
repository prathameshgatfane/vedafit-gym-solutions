import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { TextField } from "../../components/ui/TextField";
import { apiErrorCode, apiErrorMessage } from "../../lib/api-client";
import { trainerFormSchema, type TrainerFormValues } from "./trainer.schema";
import { useCreateTrainer, useTrainer, useTrainerCandidates, useUpdateTrainer } from "./useTrainers";

interface TrainerFormPageProps {
  mode: "create" | "edit";
}

export function TrainerFormPage({ mode }: TrainerFormPageProps) {
  const navigate = useNavigate();
  const { trainerId } = useParams<{ trainerId: string }>();
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const existing = useTrainer(isEdit ? trainerId : undefined);
  const candidates = useTrainerCandidates();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TrainerFormValues>({
    resolver: zodResolver(trainerFormSchema),
    defaultValues: { userId: "", specialization: "", commissionPct: "" },
  });

  useEffect(() => {
    if (!isEdit || !existing.data) return;
    reset({
      userId: existing.data.userId,
      specialization: existing.data.specialization ?? "",
      commissionPct: existing.data.commissionPct ?? "",
    });
  }, [isEdit, existing.data, reset]);

  const createMutation = useCreateTrainer();
  const updateMutation = useUpdateTrainer(trainerId ?? "");

  async function onSubmit(values: TrainerFormValues) {
    setFormError(null);
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(values);
        navigate(`/trainers/${trainerId}`, { replace: true });
      } else {
        const created = await createMutation.mutateAsync(values);
        navigate(`/trainers/${created.id}`, { replace: true });
      }
    } catch (error) {
      const message = apiErrorMessage(error, "Could not save this trainer.");
      if (apiErrorCode(error) === "USER_NOT_ELIGIBLE_TRAINER") {
        setFormError(message);
        return;
      }
      setFormError(message);
    }
  }

  if (isEdit && existing.isPending) {
    return <Spinner label="Loading trainer" />;
  }

  if (isEdit && existing.isError) {
    return (
      <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {apiErrorMessage(existing.error, "Could not load this trainer.")}
      </p>
    );
  }

  const candidateOptions = (candidates.data ?? []).map((row) => ({
    value: row.id,
    label: `${row.name} · ${row.email}`,
  }));

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-brand-white">
        {isEdit ? "Edit trainer" : "Add trainer"}
      </h1>
      <p className="mt-1 text-sm text-brand-green-muted">
        {isEdit
          ? `Profile for ${existing.data?.user.name ?? "this staff member"}. The login account is not changed here.`
          : "Attach a profile to an existing staff member whose role is the trainer matrix — not an owner or manager."}
      </p>

      <form
        noValidate
        data-testid="trainer-form"
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-brand-white/10 bg-brand-black-88 p-6"
      >
        {isEdit ? (
          <div>
            <p className="text-sm font-medium text-brand-white">Staff member</p>
            <p data-testid="trainer-user" className="mt-1 text-sm text-brand-white/70">
              {existing.data?.user.name} · {existing.data?.user.email}
            </p>
            <input type="hidden" {...register("userId")} />
          </div>
        ) : (
          <Select
            label="Staff member"
            data-testid="trainer-candidate"
            placeholder="Pick a candidate"
            options={candidateOptions}
            error={errors.userId?.message}
            {...register("userId")}
          />
        )}

        {!isEdit && candidates.data?.length === 0 ? (
          <p className="text-sm text-brand-white/50">
            Everyone who can be a trainer already has a profile, or there is no eligible staff
            member yet.
          </p>
        ) : null}

        <TextField
          label="Specialization"
          data-testid="trainer-specialization"
          placeholder="Strength, yoga, rehab…"
          error={errors.specialization?.message}
          {...register("specialization")}
        />

        <TextField
          label="Commission (%)"
          data-testid="trainer-commission"
          inputMode="decimal"
          placeholder="Optional — e.g. 10.50"
          error={errors.commissionPct?.message}
          {...register("commissionPct")}
        />

        {formError ? (
          <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {formError}
          </p>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create profile"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
