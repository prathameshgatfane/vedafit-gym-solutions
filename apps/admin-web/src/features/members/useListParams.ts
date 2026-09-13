import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import { DEFAULT_LIST_PARAMS, type MemberListParams, type MemberSortField, type MemberStatus } from "./member.types";

/** Module-level so the hook's memoized params/setters stay referentially stable across renders. */
const CONFIG: ListParamsConfig<MemberSortField, MemberStatus> = {
  sortFields: ["createdAt", "firstName", "lastName", "phone"],
  statuses: ["ACTIVE", "INACTIVE", "ARCHIVED"],
  defaults: DEFAULT_LIST_PARAMS,
};

/** The members list's URL-driven filter state — see `useUrlListParams` for the shared behaviour. */
export function useListParams(): {
  params: MemberListParams;
  setParams: (patch: Partial<MemberListParams>) => void;
  reset: () => void;
} {
  return useUrlListParams(CONFIG);
}
