import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { formatDuration, formatPrice } from "../membership-plans/plan.types";
import { useSellablePlans } from "../membership-plans/usePlans";
import { availableActions } from "./membership.types";
import {
  useChangeMembershipPlan,
  useMembership,
  useMembershipAction,
  useRenewMembership,
} from "./useMemberships";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-brand-white/50">{label}</dt>
      <dd className="mt-1 text-sm text-brand-white">{children}</dd>
    </div>
  );
}

/** Which pending confirmation, if any, is on screen. Only one at a time. */
type Panel = "renew" | "change-plan" | "cancel" | null;

export function MembershipDetailPage() {
  const { membershipId } = useParams<{ membershipId: string }>();
  const navigate = useNavigate();

  const { data: membership, isPending, isError, error } = useMembership(membershipId);
  const plans = useSellablePlans();

  const canRenewPerm = useSessionStore((s) => s.hasPermission("memberships.renew"));
  const canFreezePerm = useSessionStore((s) => s.hasPermission("memberships.freeze"));
  const canCancelPerm = useSessionStore((s) => s.hasPermission("memberships.cancel"));
  const canCreatePerm = useSessionStore((s) => s.hasPermission("memberships.create"));

  const renewMutation = useRenewMembership();
  const changePlanMutation = useChangeMembershipPlan();
  const actionMutation = useMembershipAction();

  const [panel, setPanel] = useState<Panel>(null);
  const [renewPlanId, setRenewPlanId] = useState("");
  const [targetPlanId, setTargetPlanId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (isPending) return <Spinner label="Loading membership" />;

  if (isError || !membership) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load this membership.")}
        </p>
        <Button variant="secondary" onClick={() => navigate("/memberships")}>
          Back to memberships
        </Button>
      </div>
    );
  }

  const actions = availableActions(membership);
  const sellablePlans = plans.data ?? [];
  const otherPlans = sellablePlans.filter((plan) => plan.id !== membership.planId);

  // The same arithmetic the API returns as `meta.forfeitedValue` on a plan change (1.16.1),
  // computed here so the figure is on screen *before* the switch rather than after it.
  const unusedValue =
    membership.durationDaysAtPurchase > 0 && membership.daysRemaining > 0
      ? (
          (Number(membership.priceAtPurchase) / membership.durationDaysAtPurchase) *
          membership.daysRemaining
        ).toFixed(2)
      : null;

  function closePanel() {
    setPanel(null);
    setActionError(null);
  }

  async function run(work: () => Promise<void>) {
    setActionError(null);
    try {
      await work();
    } catch (err) {
      // The likely failures are PERMISSION_DENIED and INVALID_MEMBERSHIP_TRANSITION — both are
      // surfaced verbatim, since the server is the authority on what's allowed.
      setActionError(apiErrorMessage(err, "Could not complete that action."));
    }
  }

  const handleRenew = () =>
    run(async () => {
      const created = await renewMutation.mutateAsync({
        membershipId: membership.id,
        planId: renewPlanId || undefined,
      });
      // A renewal is a different row (1.15.3), so the page has to move to it rather than refresh.
      navigate(`/memberships/${created.id}`, { replace: true });
    });

  const handleChangePlan = () =>
    run(async () => {
      if (!targetPlanId) {
        setActionError("Choose the plan to switch to.");
        return;
      }
      const { membership: created } = await changePlanMutation.mutateAsync({
        membershipId: membership.id,
        planId: targetPlanId,
      });
      navigate(`/memberships/${created.id}`, { replace: true });
    });

  const handleAction = (action: "freeze" | "unfreeze" | "cancel") =>
    run(async () => {
      const updated = await actionMutation.mutateAsync({ membershipId: membership.id, action });
      setPanel(null);
      setNotice(
        action === "unfreeze"
          ? `Unfrozen — this term now runs to ${updated.endDate}.`
          : action === "freeze"
            ? "Frozen. The clock is paused until you unfreeze it."
            : "Membership cancelled.",
      );
    });

  const busy = renewMutation.isPending || changePlanMutation.isPending || actionMutation.isPending;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/memberships" className="text-sm text-brand-green-muted hover:text-brand-green">
          ← Back to memberships
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 data-testid="membership-heading" className="text-2xl font-semibold text-brand-white">
            {membership.plan.name}
          </h1>
          <p className="mt-1 text-sm text-brand-green-muted">
            <Link to={`/members/${membership.memberId}`} className="hover:text-brand-green">
              {membership.member.firstName} {membership.member.lastName}
            </Link>{" "}
            · {membership.member.phone}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={membership.status} />
            {membership.isUpcoming ? (
              <span className="text-xs text-brand-white/50">starts {membership.startDate}</span>
            ) : null}
          </div>
        </div>
      </div>

      {notice ? (
        <p
          data-testid="action-notice"
          className="rounded-md border border-brand-green/25 bg-brand-green/5 px-4 py-3 text-sm text-brand-green-muted"
        >
          {notice}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </p>
      ) : null}

      <dl className="grid gap-5 rounded-lg border border-brand-white/10 bg-brand-black-88 p-6 sm:grid-cols-2">
        <Field label="Price paid">
          {/* The snapshot, not the plan's price today — that's the whole point of 1.15.3. */}
          <span data-testid="price-at-purchase">{formatPrice(membership.priceAtPurchase)}</span>
        </Field>
        <Field label="Term length">{formatDuration(membership.durationDaysAtPurchase)}</Field>
        <Field label="Starts">{membership.startDate}</Field>
        <Field label="Ends">
          <span data-testid="end-date">{membership.endDate}</span>
        </Field>
        <Field label="Days remaining">
          <span data-testid="days-remaining">{membership.daysRemaining}</span>
          {membership.status === "FROZEN" ? (
            <span className="ml-2 text-xs text-brand-white/50">(paused)</span>
          ) : null}
        </Field>
        <Field label="Days frozen so far">{membership.totalFrozenDays}</Field>
        {membership.previousMembershipId ? (
          <Field label="Previous term">
            <Link
              to={`/memberships/${membership.previousMembershipId}`}
              className="text-brand-green-muted hover:text-brand-green"
            >
              View the term this one followed
            </Link>
          </Field>
        ) : null}
      </dl>

      <div
        data-testid="lifecycle-actions"
        className="flex flex-wrap gap-2 rounded-lg border border-brand-white/10 bg-brand-black-88 p-4"
      >
        {/* Buttons are shown only when both the permission and the transition matrix allow the
            move; the API re-checks both regardless. */}
        {canRenewPerm && actions.canRenew ? (
          <Button disabled={busy} onClick={() => setPanel(panel === "renew" ? null : "renew")}>
            Renew
          </Button>
        ) : null}

        {canCancelPerm && canCreatePerm && actions.canChangePlan ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setPanel(panel === "change-plan" ? null : "change-plan")}
          >
            Change plan
          </Button>
        ) : null}

        {canFreezePerm && actions.canFreeze ? (
          <Button variant="secondary" disabled={busy} onClick={() => handleAction("freeze")}>
            Freeze
          </Button>
        ) : null}

        {canFreezePerm && actions.canUnfreeze ? (
          <Button variant="secondary" disabled={busy} onClick={() => handleAction("unfreeze")}>
            Unfreeze
          </Button>
        ) : null}

        {canCancelPerm && actions.canCancel ? (
          <Button
            variant="danger"
            data-testid="cancel-button"
            disabled={busy}
            onClick={() => setPanel(panel === "cancel" ? null : "cancel")}
          >
            Cancel membership
          </Button>
        ) : null}

        {membership.status === "EXPIRED" || membership.status === "CANCELLED" ? (
          <p className="self-center text-sm text-brand-white/50">
            This term is closed. {membership.status === "EXPIRED" ? "Renew it" : "Sell a new one"}{" "}
            to give this member access again.
          </p>
        ) : null}
      </div>

      {panel === "renew" ? (
        <div className="rounded-lg border border-brand-green/30 bg-brand-black-88 p-4">
          <h2 className="text-sm font-semibold text-brand-white">Renew this membership</h2>
          <p className="mt-1 text-sm text-brand-white/70">
            A renewal creates a new term starting the day after this one ends, priced at the
            plan's current rate. This term is left untouched.
          </p>
          <div className="mt-3 max-w-sm">
            <Select
              label="Plan"
              placeholder={`Same plan (${membership.plan.name})`}
              options={otherPlans.map((plan) => ({
                value: plan.id,
                label: `${plan.name} — ${formatPrice(plan.price)} / ${formatDuration(plan.durationDays)}`,
              }))}
              value={renewPlanId}
              onChange={(e) => setRenewPlanId(e.target.value)}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button data-testid="confirm-renew" disabled={busy} onClick={handleRenew}>
              {renewMutation.isPending ? "Renewing…" : "Confirm renewal"}
            </Button>
            <Button variant="secondary" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {panel === "change-plan" ? (
        <div className="rounded-lg border border-red-400/40 bg-brand-black-88 p-4">
          <h2 className="text-sm font-semibold text-brand-white">Change plan mid-term</h2>
          {/* Stated in days *and* money, up front. Locked Decision 1.16.1 keeps this endpoint
              from moving money, so the operator needs both numbers to choose between waiting for
              the term to end and refunding the difference deliberately. */}
          <p data-testid="forfeit-warning" className="mt-1 text-sm text-red-300">
            This cancels the current term and starts the new plan today.{" "}
            {membership.daysRemaining} unused{" "}
            {membership.daysRemaining === 1 ? "day" : "days"} will be forfeited
            {unusedValue ? `, worth ${formatPrice(unusedValue)} at this term's rate` : ""} — no
            refund or credit is issued automatically. To give it back, refund the payment for this
            term first; to avoid the question, renew onto the new plan when this term ends.
          </p>
          <div className="mt-3 max-w-sm">
            <Select
              label="Switch to"
              placeholder="Choose a plan"
              options={otherPlans.map((plan) => ({
                value: plan.id,
                label: `${plan.name} — ${formatPrice(plan.price)} / ${formatDuration(plan.durationDays)}`,
              }))}
              value={targetPlanId}
              onChange={(e) => setTargetPlanId(e.target.value)}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              data-testid="confirm-change-plan"
              disabled={busy}
              onClick={handleChangePlan}
            >
              {changePlanMutation.isPending ? "Switching…" : "Switch plan"}
            </Button>
            <Button variant="secondary" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {panel === "cancel" ? (
        <div
          role="alertdialog"
          aria-label="Confirm cancellation"
          className="rounded-lg border border-red-400/40 bg-brand-black-88 p-4"
        >
          <p className="text-sm text-brand-white">
            Cancel this membership? Cancelling is final — it can't be undone, and giving this
            member access again means selling a new membership.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              data-testid="confirm-cancel"
              disabled={busy}
              onClick={() => handleAction("cancel")}
            >
              {actionMutation.isPending ? "Cancelling…" : "Yes, cancel it"}
            </Button>
            <Button variant="secondary" onClick={closePanel}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
