import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice } from "../../lib/money";
import { entitlementLabel, formatEntitlementValue } from "../plans/entitlement-catalog";
import { OwnerCredentialsPanel } from "./OwnerCredentialsPanel";
import {
  createOrganizationSchema,
  type CreateOrganizationFormValues,
} from "./organization.schema";
import { useCreateOrganization, useSaasPlanOptions } from "./useOrganizations";

interface CreatedCredentialState {
  organizationId: string;
  organizationName: string;
  planLabel: string;
  subscriptionStatus: string;
  billingInterval: string;
  ownerEmail: string;
  temporaryPassword: string | null;
}

export function OrganizationFormPage() {
  const navigate = useNavigate();
  const createMutation = useCreateOrganization();
  const plansQuery = useSaasPlanOptions();
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCredentialState | null>(null);
  const assignablePlans = (plansQuery.data ?? []).filter((plan) => plan.isActive);

  const {
    register,
    handleSubmit,
    watch,
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
      credentialMode: "generate",
      ownerPassword: "",
      ownerPasswordConfirm: "",
      planId: "",
      subscriptionStatus: "TRIAL",
      billingInterval: "MONTHLY",
      currentPeriodEnd: "",
    },
  });

  const selectedPlanId = watch("planId");
  const billingInterval = watch("billingInterval");
  const credentialMode = watch("credentialMode");
  const selectedPlan = assignablePlans.find((plan) => plan.id === selectedPlanId);

  if (created) {
    return (
      <OwnerCredentialsPanel
        organizationName={created.organizationName}
        planLabel={created.planLabel}
        subscriptionStatus={created.subscriptionStatus}
        billingInterval={created.billingInterval}
        ownerEmail={created.ownerEmail}
        temporaryPassword={created.temporaryPassword}
        onContinue={() => {
          const organizationId = created.organizationId;
          setCreated(null);
          navigate(`/organizations/${organizationId}`, { replace: true });
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-semibold text-fg">New organization</h1>
      <p className="mt-1 text-sm text-accent-muted">
        Choose the gym&apos;s SaaS plan at provisioning time. Organization, Main Branch, roles,
        owner, and subscription are created in one transaction. The owner signs in through gym
        staff login, not Super Admin.
      </p>

      <form
        noValidate
        className="mt-6 flex flex-col gap-4"
        onSubmit={handleSubmit(async (values) => {
          setFormError(null);
          try {
            const result = await createMutation.mutateAsync(values);
            const temporaryPassword = result.credentials?.temporaryPassword ?? null;
            const plan = assignablePlans.find((row) => row.id === values.planId);
            setCreated({
              organizationId: result.organization.id,
              organizationName: result.organization.name,
              planLabel: plan ? `${plan.name} (${plan.code})` : (result.subscription?.planCode ?? "—"),
              subscriptionStatus: result.subscription?.status ?? values.subscriptionStatus,
              billingInterval: values.billingInterval,
              ownerEmail: result.owner.email,
              temporaryPassword,
            });
            createMutation.reset();
          } catch (error) {
            setCreated(null);
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

        <h2 className="mt-4 text-lg font-semibold text-fg">SaaS plan</h2>
        {plansQuery.isError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {apiErrorMessage(plansQuery.error, "Could not load SaaS plans.")}
          </p>
        ) : null}
        <Select
          label="SaaS plan"
          placeholder={plansQuery.isPending ? "Loading plans…" : "Select a plan"}
          options={assignablePlans.map((plan) => ({
            value: plan.id,
            label: `${plan.name} (${plan.code})`,
          }))}
          error={errors.planId?.message}
          data-testid="create-org-plan"
          {...register("planId")}
        />
        <Select
          label="Subscription status"
          options={[
            { value: "TRIAL", label: "Trial" },
            { value: "ACTIVE", label: "Active" },
            { value: "PAST_DUE", label: "Past due" },
            { value: "CANCELLED", label: "Cancelled" },
          ]}
          error={errors.subscriptionStatus?.message}
          data-testid="create-org-subscription-status"
          {...register("subscriptionStatus")}
        />
        <Select
          label="Billing interval"
          options={[
            { value: "MONTHLY", label: "Monthly" },
            { value: "YEARLY", label: "Yearly" },
          ]}
          error={errors.billingInterval?.message}
          data-testid="create-org-billing-interval"
          {...register("billingInterval")}
        />
        <TextField
          label="Period end (optional)"
          type="datetime-local"
          error={errors.currentPeriodEnd?.message}
          {...register("currentPeriodEnd")}
        />

        {selectedPlan ? (
          <article
            data-testid="plan-preview"
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h3 className="text-sm font-semibold text-fg">Selected plan</h3>
            <p className="mt-1 text-sm text-fg-muted">
              {selectedPlan.name} ({selectedPlan.code}) · preview only — prices and entitlements
              are not submitted
            </p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-fg-muted">Monthly</dt>
                <dd className={billingInterval === "MONTHLY" ? "font-medium text-fg" : "text-fg"}>
                  {formatPrice(selectedPlan.priceMonthly)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-fg-muted">Yearly</dt>
                <dd className={billingInterval === "YEARLY" ? "font-medium text-fg" : "text-fg"}>
                  {formatPrice(selectedPlan.priceYearly)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-fg-muted">Trial days</dt>
                <dd>{selectedPlan.trialDays}</dd>
              </div>
            </dl>
            <ul className="mt-3 divide-y divide-fg/10">
              {selectedPlan.entitlements.map((row) => (
                <li key={row.key} className="flex justify-between gap-4 py-1.5 text-sm">
                  <span>{entitlementLabel(row.key)}</span>
                  <span className="text-fg-muted">{formatEntitlementValue(row)}</span>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        <h2 className="mt-4 text-lg font-semibold text-fg">Owner account</h2>
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

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-fg">Owner credentials</legend>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="radio"
              value="generate"
              data-testid="credential-mode-generate"
              {...register("credentialMode")}
            />
            Generate temporary password
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="radio"
              value="manual"
              data-testid="credential-mode-manual"
              {...register("credentialMode")}
            />
            Set password manually
          </label>
        </fieldset>

        {credentialMode === "generate" ? (
          <p className="text-sm text-fg-muted">
            The server will generate a temporary password after the organization is created. It is
            shown once and is never stored in plaintext.
          </p>
        ) : (
          <>
            <TextField
              label="Owner password"
              type="password"
              autoComplete="new-password"
              error={errors.ownerPassword?.message}
              {...register("ownerPassword")}
            />
            <TextField
              label="Confirm owner password"
              type="password"
              autoComplete="new-password"
              error={errors.ownerPasswordConfirm?.message}
              {...register("ownerPasswordConfirm")}
            />
          </>
        )}

        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            data-testid="create-organization"
            disabled={isSubmitting || createMutation.isPending || plansQuery.isPending}
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
