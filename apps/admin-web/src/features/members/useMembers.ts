import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import {
  archiveMember,
  createMember,
  getMember,
  listMembers,
  setMemberPortalPassword,
  updateMember,
  type MemberPage,
} from "./members.api";
import type { MemberFormValues } from "./member.schema";
import type { Member, MemberListParams, PortalPasswordResult } from "./member.types";

/**
 * Query keys are scoped by organization id so switching tenants can never serve another org's
 * cached rows, and the list key carries the full filter set so each combination caches separately.
 */
export const memberKeys = {
  all: (organizationId: string) => ["members", organizationId] as const,
  list: (organizationId: string, params: MemberListParams) =>
    ["members", organizationId, "list", params] as const,
  detail: (organizationId: string, memberId: string) =>
    ["members", organizationId, "detail", memberId] as const,
};

function useOrganizationId(): string {
  const organizationId = useSessionStore((s) => s.organization?.id);
  // Every members screen sits behind ProtectedRoute, so the session is always populated here.
  return organizationId ?? "";
}

export function useMemberList(
  params: MemberListParams,
  /** For callers that only want the roster once the user has narrowed it — a search-first picker
   *  shouldn't pull a page of members nobody asked to see. */
  options: { enabled?: boolean } = {},
): UseQueryResult<MemberPage> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: memberKeys.list(organizationId, params),
    queryFn: () => listMembers(organizationId, params),
    enabled: organizationId !== "" && (options.enabled ?? true),
    // Keeps the previous page on screen while the next one loads, so paging and typing in the
    // search box don't blank the table out on every keystroke.
    placeholderData: keepPreviousData,
  });
}

export function useMember(memberId: string | undefined): UseQueryResult<Member> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: memberKeys.detail(organizationId, memberId ?? ""),
    queryFn: () => getMember(organizationId, memberId!),
    enabled: organizationId !== "" && Boolean(memberId),
  });
}

export function useCreateMember(): UseMutationResult<Member, unknown, MemberFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: MemberFormValues) => createMember(organizationId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
    },
  });
}

export function useUpdateMember(
  memberId: string,
): UseMutationResult<Member, unknown, MemberFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: MemberFormValues) => updateMember(organizationId, memberId, values),
    onSuccess: (member) => {
      queryClient.setQueryData(memberKeys.detail(organizationId, memberId), member);
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
    },
  });
}

export function useArchiveMember(): UseMutationResult<Member, unknown, string> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => archiveMember(organizationId, memberId),
    onSuccess: (member) => {
      queryClient.setQueryData(memberKeys.detail(organizationId, member.id), member);
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
    },
  });
}

export function useSetMemberPortalPassword(): UseMutationResult<
  PortalPasswordResult,
  unknown,
  { memberId: string; password?: string }
> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memberId, password }) =>
      setMemberPortalPassword(organizationId, memberId, password),
    onSuccess: (_result, { memberId }) => {
      // Flip the flag on the cached member. Do not write the plaintext password into the cache —
      // it lives only in the one-time success panel that called this mutation.
      queryClient.setQueryData<Member>(memberKeys.detail(organizationId, memberId), (current) =>
        current ? { ...current, portalEnabled: true } : current,
      );
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
    },
  });
}
