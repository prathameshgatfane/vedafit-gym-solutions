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
import { memberFormSchema, type MemberFormValues } from "./member.schema";
import { useCreateMember, useMember, useUpdateMember } from "./useMembers";

interface MemberFormPageProps {
  mode: "create" | "edit";
}

export function MemberFormPage({ mode }: MemberFormPageProps) {
  const navigate = useNavigate();
  const { memberId } = useParams<{ memberId: string }>();
  const branches = useSessionStore((s) => s.branches);
  const activeBranchId = useSessionStore((s) => s.activeBranchId);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const existing = useMember(isEdit ? memberId : undefined);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      dateOfBirth: "",
      // A branch-scoped user has exactly one option; an org-wide user gets the branch they're
      // currently viewing, falling back to the only branch when there is just one.
      branchId: activeBranchId ?? (branches.length === 1 ? branches[0]!.id : ""),
    },
  });

  // Populate once the record arrives — `useForm` defaults are only read on first render.
  useEffect(() => {
    if (!isEdit || !existing.data) return;
    reset({
      firstName: existing.data.firstName,
      lastName: existing.data.lastName,
      phone: existing.data.phone,
      email: existing.data.email ?? "",
      dateOfBirth: existing.data.dateOfBirth ?? "",
      branchId: existing.data.branchId,
    });
  }, [isEdit, existing.data, reset]);

  const createMutation = useCreateMember();
  const updateMutation = useUpdateMember(memberId ?? "");

  async function onSubmit(values: MemberFormValues) {
    setFormError(null);
    try {
      const member = isEdit
        ? await updateMutation.mutateAsync(values)
        : await createMutation.mutateAsync(values);
      navigate(`/members/${member.id}`, { replace: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Could not save this member.");

      // A duplicate phone is a problem with one specific field, so it belongs on that field
      // where the fix is, not only in a banner at the top of the form.
      if (apiErrorCode(error) === "DUPLICATE_PHONE") {
        setError("phone", { type: "server", message });
        setFocus("phone");
        return;
      }

      setFormError(message);
    }
  }

  if (isEdit && existing.isPending) {
    return <Spinner label="Loading member" />;
  }

  if (isEdit && existing.isError) {
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
        {apiErrorMessage(existing.error, "Could not load this member.")}
      </p>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-fg">
        {isEdit ? "Edit member" : "Add member"}
      </h1>
      <p className="mt-1 text-sm text-accent-muted">
        {isEdit ? "Update this member's details." : "Register a new member for your gym."}
      </p>

      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...register("firstName")}
          />
          <TextField
            label="Last name"
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register("lastName")}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Phone"
            type="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            error={errors.phone?.message}
            {...register("phone")}
          />
          <TextField
            label="Email (optional)"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Date of birth (optional)"
            type="date"
            error={errors.dateOfBirth?.message}
            {...register("dateOfBirth")}
          />
          <Select
            label="Branch"
            placeholder={branches.length === 1 ? undefined : "Select a branch"}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            error={errors.branchId?.message}
            {...register("branchId")}
          />
        </div>

        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create member"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
