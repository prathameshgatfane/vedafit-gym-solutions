import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice } from "../../lib/money";
import { entitlementLabel, formatEntitlementValue } from "./entitlement-catalog";
import type { SaasPlan } from "./plan.types";
import { useActivatePlan, useArchivePlan, usePlans } from "./usePlans";

export function PlansListPage() {
  const { data, isPending, isError, error } = usePlans();
  const activateMutation = useActivatePlan();
  const archiveMutation = useArchivePlan();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: "activate" | "archive"; plan: SaasPlan } | null>(
    null,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">SaaS plans</h1>
          <p className="mt-1 text-sm text-accent-muted">
            Catalog for Vedafit subscriptions. Edits apply immediately to organizations on that
            plan. Prices stored on existing subscriptions stay unchanged.
          </p>
        </div>
        <Link to="/plans/new">
          <Button type="button" data-testid="create-plan">
            Create plan
          </Button>
        </Link>
      </div>

      {isPending ? <p className="text-sm text-fg-muted">Loading plans…</p> : null}

      {isError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {apiErrorMessage(error, "Could not load SaaS plans.")}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      {data?.length === 0 ? (
        <p className="text-sm text-fg-muted">No SaaS plans in the catalog.</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {data?.map((plan) => (
          <article
            key={plan.id}
            data-testid="saas-plan-card"
            className="flex flex-col rounded-lg border border-border bg-surface p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-fg">{plan.name}</h2>
                <p className="text-xs uppercase tracking-wide text-fg-muted">{plan.code}</p>
              </div>
              <span className="text-xs text-fg-muted">{plan.isActive ? "Active" : "Archived"}</span>
            </div>
            {plan.description ? (
              <p className="mt-3 text-sm text-fg/70">{plan.description}</p>
            ) : null}
            <p className="mt-4 text-sm text-fg">
              {formatPrice(plan.priceMonthly)} / month · {formatPrice(plan.priceYearly)} / year
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {plan.trialDays} trial days · {plan.currency}
            </p>
            <p className="mt-1 text-xs text-fg-muted" data-testid="plan-org-count">
              {plan.organizationCount === 1
                ? "1 organization"
                : `${plan.organizationCount ?? 0} organizations`}
            </p>
            <ul className="mt-4 space-y-1 text-sm text-fg/80">
              {plan.entitlements.map((row) => (
                <li key={row.key} className="flex justify-between gap-3">
                  <span>{entitlementLabel(row.key)}</span>
                  <span className="text-fg-muted">{formatEntitlementValue(row)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to={`/plans/${plan.id}`}>
                <Button type="button" variant="secondary" data-testid="edit-plan">
                  Edit
                </Button>
              </Link>
              {plan.isActive ? (
                <Button
                  type="button"
                  variant="danger"
                  data-testid="archive-plan"
                  onClick={() => {
                    setActionError(null);
                    setPending({ action: "archive", plan });
                  }}
                >
                  Archive
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="activate-plan"
                  onClick={() => {
                    setActionError(null);
                    setPending({ action: "activate", plan });
                  }}
                >
                  Activate
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>

      {pending ? (
        <ConfirmDialog
          title={pending.action === "archive" ? "Archive this plan?" : "Activate this plan?"}
          message={
            pending.action === "archive"
              ? `Archived plans cannot be assigned to new organizations. ${pending.plan.organizationCount ?? 0} existing subscription(s) keep ${pending.plan.name}.`
              : `${pending.plan.name} can be assigned to organizations again.`
          }
          confirmLabel={pending.action === "archive" ? "Archive plan" : "Activate plan"}
          danger={pending.action === "archive"}
          pending={activateMutation.isPending || archiveMutation.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            void (async () => {
              try {
                if (pending.action === "archive") {
                  await archiveMutation.mutateAsync(pending.plan.id);
                } else {
                  await activateMutation.mutateAsync(pending.plan.id);
                }
                setPending(null);
              } catch (err) {
                setActionError(
                  apiErrorMessage(
                    err,
                    pending.action === "archive"
                      ? "Could not archive this plan."
                      : "Could not activate this plan.",
                  ),
                );
                setPending(null);
              }
            })();
          }}
        />
      ) : null}
    </div>
  );
}
