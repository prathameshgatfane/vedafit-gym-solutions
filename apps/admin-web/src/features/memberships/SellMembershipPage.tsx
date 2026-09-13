import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useMember } from "../members/useMembers";
import { formatDuration, formatPrice } from "../membership-plans/plan.types";
import { useSellablePlans } from "../membership-plans/usePlans";
import { useCreateMembership } from "./useMemberships";

/**
 * Selling a term is always done *for a member*, so this lives under the member rather than as a
 * standalone "new membership" screen with a member picker — the caller already knows who.
 */
export function SellMembershipPage() {
  const navigate = useNavigate();
  const { memberId } = useParams<{ memberId: string }>();

  const member = useMember(memberId);
  const plans = useSellablePlans();
  const createMutation = useCreateMembership();

  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  if (member.isPending || plans.isPending) return <Spinner label="Loading" />;

  if (member.isError || !member.data) {
    return (
      <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {apiErrorMessage(member.error, "Could not load this member.")}
      </p>
    );
  }

  const sellablePlans = plans.data ?? [];
  const selectedPlan = sellablePlans.find((plan) => plan.id === planId);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!planId) {
      setFormError("Choose a plan to sell.");
      return;
    }

    try {
      const membership = await createMutation.mutateAsync({
        memberId: memberId!,
        planId,
        startDate: startDate || undefined,
      });
      navigate(`/memberships/${membership.id}`, { replace: true });
    } catch (error) {
      // MEMBERSHIP_OVERLAP is the common one here, and its message already says to renew instead.
      setFormError(apiErrorMessage(error, "Could not create this membership."));
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-brand-white">Sell a membership</h1>
      <p className="mt-1 text-sm text-brand-green-muted">
        For {member.data.firstName} {member.data.lastName} · {member.data.phone}
      </p>

      <form
        noValidate
        onSubmit={handleSubmit}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-brand-white/10 bg-brand-black-88 p-6"
      >
        {sellablePlans.length === 0 ? (
          <p className="rounded-md border border-brand-white/15 px-3 py-2 text-sm text-brand-white/70">
            There are no active plans to sell. Create one under Membership plans first.
          </p>
        ) : (
          <Select
            label="Plan"
            placeholder="Choose a plan"
            data-testid="plan-select"
            options={sellablePlans.map((plan) => ({
              value: plan.id,
              label: `${plan.name} — ${formatPrice(plan.price)} / ${formatDuration(plan.durationDays)}`,
            }))}
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          />
        )}

        <TextField
          label="Start date (optional)"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <p className="-mt-2 text-xs text-brand-white/50">
          Leave blank to start today. Backdating is allowed for signups entered late.
        </p>

        {selectedPlan ? (
          <p
            data-testid="snapshot-notice"
            className="rounded-md border border-brand-green/25 bg-brand-green/5 px-3 py-2 text-sm text-brand-green-muted"
          >
            This term will be locked to {formatPrice(selectedPlan.price)} for{" "}
            {formatDuration(selectedPlan.durationDays)}. Later changes to the plan's price won't
            affect it.
          </p>
        ) : null}

        {formError ? (
          <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {formError}
          </p>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button type="submit" disabled={createMutation.isPending || sellablePlans.length === 0}>
            {createMutation.isPending ? "Creating…" : "Create membership"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
