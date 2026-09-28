import { apiErrorMessage } from "../../lib/api-client";
import type { FeatureFlag, OrganizationUsage, UsageMetric } from "./organization.types";
import {
  FEATURE_LABELS,
  USAGE_LABELS,
  formatFeatureState,
  isCountUsage,
  isUnavailableUsage,
  overLimitBy,
  unavailableReasonCopy,
} from "./usage-display";

const COUNT_KEYS = ["members", "branches", "staff"] as const;
const OBSERVATIONAL_KEYS = ["trainers", "leads"] as const;
const UNAVAILABLE_KEYS = ["storage", "monthlySms", "whatsapp", "onlinePayments"] as const;
const FEATURE_KEYS = [
  "leads",
  "trainers",
  "reports",
  "notifications",
  "whatsapp",
  "onlinePayments",
] as const;

export function OrganizationUsagePanel({
  usage,
  isPending,
  isError,
  error,
}: {
  usage: OrganizationUsage | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-lg border border-border bg-surface p-5" data-testid="usage-section">
        <h2 className="text-lg font-semibold text-fg">Usage</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Live counts against the current plan. This page does not change gym records.
        </p>
        {isPending ? (
          <p className="mt-4 text-sm text-fg-muted" data-testid="usage-loading">
            Loading usage…
          </p>
        ) : null}
        {isError ? (
          <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {apiErrorMessage(error, "Could not load organization usage.")}
          </p>
        ) : null}
        {usage ? <UsageGrid payload={usage} /> : null}
      </article>

      <article className="rounded-lg border border-border bg-surface p-5" data-testid="features-section">
        <h2 className="text-lg font-semibold text-fg">Features</h2>
        <p className="mt-1 text-sm text-fg-muted">Live plan flags. Disabled is not a numeric limit.</p>
        {isPending ? (
          <p className="mt-4 text-sm text-fg-muted">Loading features…</p>
        ) : null}
        {isError ? (
          <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {apiErrorMessage(error, "Could not load feature flags.")}
          </p>
        ) : null}
        {usage ? <FeatureList features={usage.features} /> : null}
      </article>
    </section>
  );
}

function UsageGrid({ payload }: { payload: OrganizationUsage }) {
  const overLimit = COUNT_KEYS.some((key) => {
    const metric = payload.usage[key];
    return isCountUsage(metric) && metric.overLimit;
  });

  return (
    <div className="mt-4 space-y-4">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {COUNT_KEYS.map((key) => (
          <MetricCard key={key} testId={`usage-${key}`} label={USAGE_LABELS[key]} metric={payload.usage[key]} />
        ))}
        {OBSERVATIONAL_KEYS.map((key) => (
          <ObservationalCard
            key={key}
            testId={`usage-${key}`}
            label={USAGE_LABELS[key]}
            metric={payload.usage[key]}
            enabled={payload.features[key].enabled}
          />
        ))}
        {UNAVAILABLE_KEYS.map((key) => (
          <MetricCard
            key={key}
            testId={`usage-${key}`}
            label={USAGE_LABELS[key]}
            metric={payload.usage[key]}
          />
        ))}
      </div>
      {overLimit ? (
        <p className="text-sm text-fg-muted" data-testid="usage-over-limit-note">
          Existing records are retained. Plan enforcement prevents additional usage where
          applicable.
        </p>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  metric,
  testId,
}: {
  label: string;
  metric: UsageMetric;
  testId: string;
}) {
  if (isUnavailableUsage(metric)) {
    return (
      <div data-testid={testId} className="min-w-0 rounded-md border border-border px-3 py-3">
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="mt-1 text-sm text-fg">Unavailable</p>
        <p className="mt-1 text-xs text-fg-muted">{unavailableReasonCopy(metric.reason)}</p>
      </div>
    );
  }

  if (!isCountUsage(metric)) {
    return null;
  }

  if (metric.unlimited) {
    return (
      <div data-testid={testId} className="min-w-0 rounded-md border border-border px-3 py-3">
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="mt-1 text-sm text-fg">Used: {metric.used}</p>
        <p className="text-sm text-fg-muted">Limit: Unlimited</p>
      </div>
    );
  }

  const limit = metric.limit ?? 0;
  return (
    <div data-testid={testId} className="min-w-0 rounded-md border border-border px-3 py-3">
      <p className="text-sm font-medium text-fg">{label}</p>
      <p className="mt-1 text-sm text-fg">
        {metric.used} / {limit}
      </p>
      {metric.overLimit ? (
        <p className="mt-1 text-sm text-danger">Over limit by {overLimitBy(metric.used, limit)}</p>
      ) : (
        <p className="mt-1 text-sm text-fg-muted">{metric.remaining ?? 0} remaining</p>
      )}
    </div>
  );
}

function ObservationalCard({
  label,
  metric,
  enabled,
  testId,
}: {
  label: string;
  metric: UsageMetric;
  enabled: boolean;
  testId: string;
}) {
  const used = isCountUsage(metric) ? metric.used : null;
  return (
    <div data-testid={testId} className="min-w-0 rounded-md border border-border px-3 py-3">
      <p className="text-sm font-medium text-fg">{label}</p>
      <p className="mt-1 text-sm text-fg">{used === null ? "—" : `${used} created`}</p>
      <p className="mt-1 text-sm text-fg-muted">Feature: {formatFeatureState(enabled)}</p>
    </div>
  );
}

function FeatureList({ features }: { features: OrganizationUsage["features"] }) {
  return (
    <dl className="mt-4 divide-y divide-fg/10">
      {FEATURE_KEYS.map((key) => (
        <FeatureRow key={key} testId={`feature-${key}`} label={FEATURE_LABELS[key]} flag={features[key]} />
      ))}
    </dl>
  );
}

function FeatureRow({
  label,
  flag,
  testId,
}: {
  label: string;
  flag: FeatureFlag;
  testId: string;
}) {
  return (
    <div data-testid={testId} className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-fg">{label}</dt>
      <dd className={flag.enabled ? "text-fg" : "text-fg-muted"}>{formatFeatureState(flag.enabled)}</dd>
    </div>
  );
}
