import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import { memberKeys } from "../members/useMembers";
import {
  changeMembershipPlan,
  createMembership,
  getMembership,
  listMemberships,
  renewMembership,
  runMembershipAction,
  type MembershipAction,
  type MembershipPage,
} from "./memberships.api";
import type { Membership, MembershipListParams } from "./membership.types";

/** Scoped by organization id so switching tenants can never serve another org's cached rows. */
export const membershipKeys = {
  all: (organizationId: string) => ["memberships", organizationId] as const,
  list: (organizationId: string, params: MembershipListParams, memberId?: string) =>
    ["memberships", organizationId, "list", params, memberId ?? null] as const,
  detail: (organizationId: string, membershipId: string) =>
    ["memberships", organizationId, "detail", membershipId] as const,
};

function useOrganizationId(): string {
  const organizationId = useSessionStore((s) => s.organization?.id);
  // Every memberships screen sits behind ProtectedRoute, so the session is always populated here.
  return organizationId ?? "";
}

export function useMembershipList(
  params: MembershipListParams,
  extra: { memberId?: string } = {},
): UseQueryResult<MembershipPage> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: membershipKeys.list(organizationId, params, extra.memberId),
    queryFn: () => listMemberships(organizationId, params, extra),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

export function useMembership(membershipId: string | undefined): UseQueryResult<Membership> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: membershipKeys.detail(organizationId, membershipId ?? ""),
    queryFn: () => getMembership(organizationId, membershipId!),
    enabled: organizationId !== "" && Boolean(membershipId),
  });
}

/**
 * Every mutation below invalidates the member cache as well as the membership one: a member's
 * detail page shows their current term, so selling or cancelling one changes what that page says.
 */
function useInvalidateAfterWrite() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: membershipKeys.all(organizationId) });
    void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
  };
}

export function useCreateMembership(): UseMutationResult<
  Membership,
  unknown,
  { memberId: string; planId: string; startDate?: string }
> {
  const organizationId = useOrganizationId();
  const invalidate = useInvalidateAfterWrite();

  return useMutation({
    mutationFn: (input: { memberId: string; planId: string; startDate?: string }) =>
      createMembership(organizationId, input),
    onSuccess: invalidate,
  });
}

export function useRenewMembership(): UseMutationResult<
  Membership,
  unknown,
  { membershipId: string; planId?: string }
> {
  const organizationId = useOrganizationId();
  const invalidate = useInvalidateAfterWrite();

  return useMutation({
    mutationFn: ({ membershipId, planId }: { membershipId: string; planId?: string }) =>
      renewMembership(organizationId, membershipId, planId),
    onSuccess: invalidate,
  });
}

export function useChangeMembershipPlan(): UseMutationResult<
  { membership: Membership; forfeitedDays: number },
  unknown,
  { membershipId: string; planId: string }
> {
  const organizationId = useOrganizationId();
  const invalidate = useInvalidateAfterWrite();

  return useMutation({
    mutationFn: ({ membershipId, planId }: { membershipId: string; planId: string }) =>
      changeMembershipPlan(organizationId, membershipId, planId),
    onSuccess: invalidate,
  });
}

export function useMembershipAction(): UseMutationResult<
  Membership,
  unknown,
  { membershipId: string; action: MembershipAction }
> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAfterWrite();

  return useMutation({
    mutationFn: ({ membershipId, action }: { membershipId: string; action: MembershipAction }) =>
      runMembershipAction(organizationId, membershipId, action),
    onSuccess: (membership) => {
      queryClient.setQueryData(membershipKeys.detail(organizationId, membership.id), membership);
      invalidate();
    },
  });
}
