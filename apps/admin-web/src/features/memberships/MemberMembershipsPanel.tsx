import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { formatPrice } from "../membership-plans/plan.types";
import { useMembershipList } from "./useMemberships";
import { DEFAULT_MEMBERSHIP_LIST_PARAMS } from "./membership.types";

/**
 * Every term this member has ever held, newest first. A member's history is a list of rows
 * because renewals and plan changes each create one (Locked Decision 1.15.3/1.15.4) — so this
 * panel is the term chain, not a single "current membership" field.
 *
 * Fixed params rather than URL-driven: this is a panel inside the member page, and hijacking the
 * page's query string would fight with anything else on it.
 */
const PANEL_PARAMS = {
  ...DEFAULT_MEMBERSHIP_LIST_PARAMS,
  limit: 25,
  sortBy: "startDate" as const,
  sortOrder: "desc" as const,
};

interface MemberMembershipsPanelProps {
  memberId: string;
  /** Archived members can't be sold to, so the button is pointless there. */
  canSell: boolean;
}

export function MemberMembershipsPanel({ memberId, canSell }: MemberMembershipsPanelProps) {
  const navigate = useNavigate();
  const canView = useSessionStore((s) => s.hasPermission("memberships.view"));
  const canCreate = useSessionStore((s) => s.hasPermission("memberships.create"));

  const { data, isPending, isError, error } = useMembershipList(PANEL_PARAMS, { memberId });

  if (!canView) return null;

  const memberships = data?.items ?? [];
  const hasLiveTerm = memberships.some((m) => m.status === "ACTIVE" || m.status === "FROZEN");

  return (
    <section
      data-testid="member-memberships"
      className="rounded-lg border border-border bg-surface p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-fg">Memberships</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Every term this member has held, newest first.
          </p>
        </div>
        {canCreate && canSell && !hasLiveTerm ? (
          <Button
            data-testid="sell-membership"
            onClick={() => navigate(`/members/${memberId}/memberships/new`)}
          >
            Sell membership
          </Button>
        ) : null}
      </div>

      {isError ? (
        <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {apiErrorMessage(error, "Could not load this member's memberships.")}
        </p>
      ) : null}

      {isPending ? (
        <p className="mt-4 text-sm text-fg-muted">Loading memberships…</p>
      ) : memberships.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">
          No memberships yet.{canCreate && canSell ? " Sell one to get this member started." : ""}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-fg/5">
          {memberships.map((membership) => (
            <li key={membership.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <Link
                  to={`/memberships/${membership.id}`}
                  className="text-sm font-medium text-fg hover:text-accent-text"
                >
                  {membership.plan.name}
                </Link>
                <p className="text-xs text-fg-muted">
                  {membership.startDate} → {membership.endDate} ·{" "}
                  {formatPrice(membership.priceAtPurchase)}
                </p>
              </div>
              <StatusBadge status={membership.status} />
            </li>
          ))}
        </ul>
      )}

      {/* A live term exists, so the way to extend it is renewal — which is on the term itself. */}
      {canCreate && canSell && hasLiveTerm ? (
        <p className="mt-4 text-xs text-fg-muted">
          This member already has a live membership. Open it to renew, freeze or change the plan.
        </p>
      ) : null}
    </section>
  );
}
