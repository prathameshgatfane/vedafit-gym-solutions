import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import {
  createOrganizationSchema,
  type CreateOrganizationFormValues,
} from "./organization.schema";
import { useCreateOrganization } from "./useOrganizations";

export function OrganizationFormPage() {
  const navigate = useNavigate();
  const createMutation = useCreateOrganization();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationFormValues>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: {
      name: "",
      slug: "",
      email: "",
      phone: "",
      timezone: "Asia/Kolkata",
      branchName: "",
      ownerName: "",
      ownerEmail: "",
      ownerPassword: "",
    },
  });

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-semibold text-brand-white">New organization</h1>
      <p className="mt-1 text-sm text-brand-green-muted">
        Provisions a Trial organization. Plan and status are set by the server — they are not
        fields on this form. The owner signs in through gym staff login, not Super Admin.
      </p>

      <form
        noValidate
        className="mt-6 flex flex-col gap-4"
        onSubmit={handleSubmit(async (values) => {
          setFormError(null);
          try {
            const created = await createMutation.mutateAsync(values);
            navigate(`/organizations/${created.organization.id}`, { replace: true });
          } catch (error) {
            setFormError(apiErrorMessage(error, "Could not create this organization."));
          }
        })}
      >
        <TextField label="Organization name" error={errors.name?.message} {...register("name")} />
        <TextField
          label="Slug"
          placeholder="acme-gym"
          error={errors.slug?.message}
          {...register("slug")}
        />
        <TextField
          label="Organization email"
          type="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <TextField label="Phone (optional)" error={errors.phone?.message} {...register("phone")} />
        <TextField
          label="Timezone"
          placeholder="Asia/Kolkata"
          error={errors.timezone?.message}
          {...register("timezone")}
        />
        <TextField
          label="First branch name (optional)"
          error={errors.branchName?.message}
          {...register("branchName")}
        />

        <h2 className="mt-4 text-lg font-semibold text-brand-white">Owner account</h2>
        <TextField
          label="Owner name"
          error={errors.ownerName?.message}
          {...register("ownerName")}
        />
        <TextField
          label="Owner email"
          type="email"
          error={errors.ownerEmail?.message}
          {...register("ownerEmail")}
        />
        <TextField
          label="Owner password"
          type="password"
          autoComplete="new-password"
          error={errors.ownerPassword?.message}
          {...register("ownerPassword")}
        />

        {formError ? (
          <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {formError}
          </p>
        ) : null}

        <div className="flex gap-3">
          <Button
            type="submit"
            data-testid="create-organization"
            disabled={isSubmitting || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create organization"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate("/organizations")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
