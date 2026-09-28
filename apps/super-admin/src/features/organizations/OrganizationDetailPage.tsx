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
import { formatEntitlementValue } from "../plans/entitlement-catalog";
import { OrganizationUsagePanel } from "./OrganizationUsagePanel";
import { subscriptionFormSchema, type SubscriptionFormValues } from "./organization.schema";
import type { OrganizationStatus, SubscriptionStatus } from "./organization.types";
import {
  catalogPriceForInterval,
  resolveSubscriptionDraft,
  subscriptionConfirmCopy,
} from "./subscription-change-preview";
import {
  useOrganization,
  useOrganizationUsage,
  useSaasPlanOptions,
  useUpdateOrganizationStatus,
  useUpdateOrganizationSubscription,
} from "./useOrganizations";
import { entitlementDisplayLabel, orderedEntitlements } from "./usage-display";

export function OrganizationDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { data, isPending, isError, error } = useOrganization(organizationId);
  const usageQuery = useOrganizationUsage(data ? organizationId : undefined);
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
      billingInterval: data?.subscription?.billingInterval ?? "",
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
            <Row label="Name" value={org.name} />
            <Row label="Slug" value={org.slug} />
            <Row label="Email" value={org.email} />
            <Row label="Phone" value={org.phone ?? "—"} />
            <Row label="Timezone" value={org.timezone} />
            <Row label="Created" value={formatWhen(org.createdAt)} />
          </dl>
        </article>

        <article className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold text-fg">Owner</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Email" value={data.owner?.email ?? "—"} />
          </dl>
          <p className="mt-4 text-sm text-fg-muted">
            Owner credentials are not stored on this page.
          </p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
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

        <article className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold text-fg">Actions</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Organization status is independent of the SaaS subscription.
          </p>
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
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-fg">Assign plan</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Plan choices come from GET /platform/plans. Entitlement values cannot be edited.
        </p>
        <form
          noValidate
          className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
          onSubmit={handleSubmit((values) => {
            setActionError(null);
            setPendingSubscription(values);
          })}
        >
          <Select
            label="SaaS plan"
            placeholder="Keep current plan"
            options={(plans.data ?? [])
              .filter((plan) => plan.isActive || plan.id === data.subscription?.plan.id)
              .map((plan) => ({
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
          <Select
            label="Billing interval"
            placeholder="Keep current interval"
            options={[
              { value: "MONTHLY", label: "Monthly" },
              { value: "YEARLY", label: "Yearly" },
            ]}
            {...register("billingInterval")}
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

      <section className="rounded-lg border border-border bg-surface p-5" data-testid="entitlements-section">
        <h2 className="text-lg font-semibold text-fg">Entitlements</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Live plan values. Display only — values are not sent back to the API.
        </p>
        {data.entitlements.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">No entitlement snapshot.</p>
        ) : (
          <ul className="mt-4 divide-y divide-fg/10">
            {orderedEntitlements(data.entitlements).map((row) => (
              <li key={row.key} className="flex justify-between gap-4 py-2 text-sm">
                <span>{entitlementDisplayLabel(row.key)}</span>
                <span className="text-fg-muted">{formatEntitlementValue(row)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OrganizationUsagePanel
        usage={usageQuery.data}
        isPending={usageQuery.isPending}
        isError={usageQuery.isError}
        error={usageQuery.error}
      />

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

      {pendingSubscription && data.subscription ? (
        <ConfirmDialog
          title="Apply subscription change?"
          message={
            <SubscriptionChangeSummary
              organizationName={org.name}
              current={data.subscription}
              values={pendingSubscription}
              plans={plans.data ?? []}
            />
          }
          confirmLabel="Apply change"
          pending={subscriptionMutation.isPending}
          onCancel={() => setPendingSubscription(null)}
          onConfirm={() => {
            void (async () => {
              try {
                const input: {
                  planId?: string;
                  status?: SubscriptionStatus;
                  billingInterval?: "MONTHLY" | "YEARLY";
                  currentPeriodEnd?: string;
                } = {};
                if (pendingSubscription.planId) input.planId = pendingSubscription.planId;
                if (pendingSubscription.status) {
                  input.status = pendingSubscription.status as SubscriptionStatus;
                }
                if (pendingSubscription.billingInterval) {
                  input.billingInterval = pendingSubscription.billingInterval;
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
      <dd className="min-w-0 truncate text-right text-fg">{value}</dd>
    </div>
  );
}

function SubscriptionChangeSummary({
  organizationName,
  current,
  values,
  plans,
}: {
  organizationName: string;
  current: NonNullable<import("./organization.types").OrganizationDetail["subscription"]>;
  values: SubscriptionFormValues;
  plans: import("../plans/plan.types").SaasPlan[];
}) {
  const periodEnd = toIsoDatetime(values.currentPeriodEnd);
  const draft = resolveSubscriptionDraft(current, values, periodEnd);
  const nextPlan = plans.find((plan) => plan.id === draft.planId) ?? {
    id: current.plan.id,
    code: current.plan.code,
    name: current.plan.name,
    description: null,
    priceMonthly: current.priceSnapshot,
    priceYearly: current.priceSnapshot,
    currency: "INR",
    trialDays: 0,
    isActive: true,
    entitlements: [],
  };
  const currentPlan = plans.find((plan) => plan.id === current.plan.id);
  const copy = subscriptionConfirmCopy({
    organizationName,
    current,
    currentPlan,
    next: {
      plan: nextPlan,
      status: draft.status,
      billingInterval: draft.billingInterval,
      catalogPrice: catalogPriceForInterval(nextPlan, draft.billingInterval),
      currentPeriodEnd: draft.currentPeriodEnd,
    },
  });

  return (
    <div className="space-y-4 text-fg/80" data-testid="subscription-change-summary">
      <p>
        <span className="text-fg-muted">Organization</span>
        <br />
        <strong className="text-fg">{copy.organizationName}</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <CompareColumn title="CURRENT" rows={copy.current} />
        <CompareColumn title="NEW" rows={copy.next} next />
      </div>
      {copy.planChanged ? (
        <div>
          <h3 className="font-semibold text-fg">Entitlement impact</h3>
          {copy.entitlementImpact.length === 0 ? (
            <p className="mt-1">No plan entitlements are available to compare.</p>
          ) : (
            <dl className="mt-2 space-y-1">
              {copy.entitlementImpact.map((row) => (
                <div key={row.key} className="flex justify-between gap-4">
                  <dt>{row.label}</dt>
                  <dd className={row.changed ? "text-fg" : "text-fg-muted"}>{row.summary}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : (
        <p>Plan is unchanged, so entitlements stay as they are.</p>
      )}
      <p className="font-medium text-fg">Plan entitlements take effect immediately.</p>
      <p>Gym payments, invoices, memberships, and owner credentials are not changed.</p>
    </div>
  );
}

function CompareColumn({
  title,
  rows,
  next,
}: {
  title: string;
  rows: {
    plan: string;
    status: string;
    billingInterval: string;
    priceSnapshot?: string;
    catalogPrice?: string;
    currentPeriodEnd: string;
  };
  next?: boolean;
}) {
  return (
    <section>
      <h3 className="font-semibold text-fg">{title}</h3>
      <dl className="mt-2 space-y-1">
        <CompareRow label="Plan" value={rows.plan} />
        <CompareRow label="Subscription status" value={rows.status} />
        <CompareRow label="Billing interval" value={rows.billingInterval} />
        <CompareRow
          label={next ? "New catalog price" : "Price snapshot"}
          value={next ? rows.catalogPrice ?? "—" : rows.priceSnapshot ?? "—"}
        />
        <CompareRow
          label={next ? "Proposed period end" : "Current period end"}
          value={rows.currentPeriodEnd}
        />
      </dl>
    </section>
  );
}

function CompareRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </div>
  );
}
