import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Select } from "../../components/ui/Select";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { formatWhen, toIsoDatetime } from "../../lib/format";
import { formatPrice } from "../../lib/money";
import { subscriptionFormSchema, type SubscriptionFormValues } from "./organization.schema";
import type { EntitlementRow, OrganizationStatus, SubscriptionStatus } from "./organization.types";
import {
  useOrganization,
  useSaasPlanOptions,
  useUpdateOrganizationStatus,
  useUpdateOrganizationSubscription,
} from "./useOrganizations";

export function OrganizationDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { data, isPending, isError, error } = useOrganization(organizationId);
  const statusMutation = useUpdateOrganizationStatus(organizationId ?? "");
  const subscriptionMutation = useUpdateOrganizationSubscription(organizationId ?? "");
  const plans = useSaasPlanOptions();
  const [pendingStatus, setPendingStatus] = useState<OrganizationStatus | null>(null);
  const [pendingSubscription, setPendingSubscription] = useState<SubscriptionFormValues | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SubscriptionFormValues>({
    resolver: zodResolver(subscriptionFormSchema),
    values: {
      planId: data?.subscription?.plan.id ?? "",
      status: data?.subscription?.status ?? "",
      currentPeriodEnd: "",
    },
  });

  if (isPending) {
    return <p className="text-sm text-fg-muted">Loading organization…</p>;
  }

  if (isError || !data) {
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
        {apiErrorMessage(error, "Could not load this organization.")}
      </p>
    );
  }

  const org = data.organization;
  const nextStatus: OrganizationStatus = org.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link to="/organizations" className="text-sm text-accent-text hover:underline">
          ← Organizations
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 data-testid="org-name" className="text-2xl font-semibold text-fg">
            {org.name}
          </h1>
          <span data-testid="org-status">
            <StatusBadge status={org.status} />
          </span>
        </div>
        <p className="mt-1 text-sm text-accent-muted">
          {org.slug} · organization status is independent of subscription status
        </p>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold text-fg">Organization</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Email" value={org.email} />
            <Row label="Phone" value={org.phone ?? "—"} />
            <Row label="Timezone" value={org.timezone} />
            <Row label="Created" value={formatWhen(org.createdAt)} />
            <Row label="Owner email" value={data.owner?.email ?? "—"} />
          </dl>
          <div className="mt-6">
            <Button
              type="button"
              data-testid="org-status-action"
              variant={nextStatus === "SUSPENDED" ? "danger" : "primary"}
              onClick={() => {
                setActionError(null);
                setPendingStatus(nextStatus);
              }}
            >
              {nextStatus === "SUSPENDED" ? "Suspend organization" : "Restore organization"}
            </Button>
          </div>
        </article>

        <article className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold text-fg">Subscription</h2>
          {data.subscription ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Status</dt>
                <dd>
                  <StatusBadge status={data.subscription.status} />
                </dd>
              </div>
              <Row
                label="Plan"
                value={`${data.subscription.plan.name} (${data.subscription.plan.code})`}
              />
              <Row label="Billing interval" value={data.subscription.billingInterval} />
              <Row label="Price snapshot" value={formatPrice(data.subscription.priceSnapshot)} />
              <Row label="Period start" value={formatWhen(data.subscription.currentPeriodStart)} />
              <Row label="Period end" value={formatWhen(data.subscription.currentPeriodEnd)} />
            </dl>
          ) : (
            <p className="mt-4 text-sm text-fg-muted">No SaaS subscription on this organization.</p>
          )}
        </article>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-fg">Assign plan</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Plan choices come from GET /platform/plans. Entitlement values cannot be edited.
        </p>
        <form
          noValidate
          className="mt-4 grid gap-4 md:grid-cols-3"
          onSubmit={handleSubmit((values) => {
            setActionError(null);
            setPendingSubscription(values);
          })}
        >
          <Select
            label="SaaS plan"
            placeholder="Keep current plan"
            options={(plans.data ?? []).map((plan) => ({
              value: plan.id,
              label: `${plan.name} (${plan.code})`,
            }))}
            {...register("planId")}
          />
          <Select
            label="Subscription status"
            placeholder="Keep current status"
            options={[
              { value: "TRIAL", label: "Trial" },
              { value: "ACTIVE", label: "Active" },
              { value: "PAST_DUE", label: "Past due" },
              { value: "CANCELLED", label: "Cancelled" },
            ]}
            {...register("status")}
          />
          <TextField
            label="New period end (optional)"
            type="datetime-local"
            error={errors.currentPeriodEnd?.message}
            {...register("currentPeriodEnd")}
          />
          {errors.root?.message ? (
            <p role="alert" className="md:col-span-3 text-sm text-danger">
              {errors.root.message}
            </p>
          ) : null}
          <div className="md:col-span-3">
            <Button type="submit" data-testid="assign-plan-submit" disabled={!data.subscription}>
              Review subscription change
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-fg">Entitlements</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Server snapshot. Display only — values are not sent back to the API.
        </p>
        {data.entitlements.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">No entitlement snapshot.</p>
        ) : (
          <ul className="mt-4 divide-y divide-fg/10">
            {data.entitlements.map((row) => (
              <li key={row.key} className="flex justify-between gap-4 py-2 text-sm">
                <span>{row.key}</span>
                <span className="text-fg-muted">{formatEntitlement(row)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pendingStatus ? (
        <ConfirmDialog
          title={pendingStatus === "SUSPENDED" ? "Suspend this organization?" : "Restore this organization?"}
          message={
            pendingStatus === "SUSPENDED"
              ? "Staff and member login for this gym will be blocked. Existing data stays in the database."
              : "Staff and members will be able to sign in again. Subscription status is unchanged."
          }
          confirmLabel={pendingStatus === "SUSPENDED" ? "Suspend" : "Restore"}
          danger={pendingStatus === "SUSPENDED"}
          pending={statusMutation.isPending}
          onCancel={() => setPendingStatus(null)}
          onConfirm={() => {
            void (async () => {
              try {
                await statusMutation.mutateAsync(pendingStatus);
                setPendingStatus(null);
              } catch (err) {
                setActionError(apiErrorMessage(err, "Could not update organization status."));
                setPendingStatus(null);
              }
            })();
          }}
        />
      ) : null}

      {pendingSubscription ? (
        <ConfirmDialog
          title="Apply subscription change?"
          message="This updates the SaaS subscription only. Organization status and entitlement values stay server-controlled."
          confirmLabel="Apply change"
          pending={subscriptionMutation.isPending}
          onCancel={() => setPendingSubscription(null)}
          onConfirm={() => {
            void (async () => {
              try {
                const input: {
                  planId?: string;
                  status?: SubscriptionStatus;
                  currentPeriodEnd?: string;
                } = {};
                if (pendingSubscription.planId) input.planId = pendingSubscription.planId;
                if (pendingSubscription.status) {
                  input.status = pendingSubscription.status as SubscriptionStatus;
                }
                const periodEnd = toIsoDatetime(pendingSubscription.currentPeriodEnd);
                if (periodEnd) input.currentPeriodEnd = periodEnd;
                await subscriptionMutation.mutateAsync(input);
                setPendingSubscription(null);
              } catch (err) {
                setActionError(apiErrorMessage(err, "Could not update the subscription."));
                setPendingSubscription(null);
              }
            })();
          }}
        />
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </div>
  );
}

function formatEntitlement(row: EntitlementRow): string {
  if (row.valueType === "UNLIMITED") return "Unlimited";
  if (row.valueType === "BOOLEAN") return row.boolValue ? "On" : "Off";
  if (row.intValue === null) return "—";
  return String(row.intValue);
}
