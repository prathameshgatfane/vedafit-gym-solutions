import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice } from "../../lib/money";
import type { EntitlementRow } from "../organizations/organization.types";
import { usePlans } from "./usePlans";

export function PlansListPage() {
  const { data, isPending, isError, error } = usePlans();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-white">SaaS plans</h1>
        <p className="mt-1 text-sm text-brand-green-muted">
          Read-only catalog. Prices are stored stubs. Entitlements cannot be edited here.
        </p>
      </div>

      {isPending ? <p className="text-sm text-brand-white/60">Loading plans…</p> : null}

      {isError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load SaaS plans.")}
        </p>
      ) : null}

      {data?.length === 0 ? (
        <p className="text-sm text-brand-white/60">No SaaS plans in the catalog.</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {data?.map((plan) => (
          <article
            key={plan.id}
            data-testid="saas-plan-card"
            className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-brand-white">{plan.name}</h2>
                <p className="text-xs uppercase tracking-wide text-brand-white/40">{plan.code}</p>
              </div>
              <span className="text-xs text-brand-white/50">
                {plan.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            {plan.description ? (
              <p className="mt-3 text-sm text-brand-white/70">{plan.description}</p>
            ) : null}
            <p className="mt-4 text-sm text-brand-white">
              {formatPrice(plan.priceMonthly)} / month · {formatPrice(plan.priceYearly)} / year
            </p>
            <p className="mt-1 text-xs text-brand-white/40">
              {plan.trialDays} trial days · {plan.currency}
            </p>
            <ul className="mt-4 space-y-1 text-sm text-brand-white/80">
              {plan.entitlements.map((row) => (
                <li key={row.key} className="flex justify-between gap-3">
                  <span>{row.key}</span>
                  <span className="text-brand-white/60">{formatEntitlement(row)}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatEntitlement(row: EntitlementRow): string {
  if (row.valueType === "UNLIMITED") return "Unlimited";
  if (row.valueType === "BOOLEAN") return row.boolValue ? "On" : "Off";
  if (row.intValue === null) return "—";
  return String(row.intValue);
}
