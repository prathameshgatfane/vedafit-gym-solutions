import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_LIST_PARAMS,
  type MemberListParams,
  type MemberSortField,
  type MemberStatus,
} from "./member.types";

const SORT_FIELDS: MemberSortField[] = ["createdAt", "firstName", "lastName", "phone"];
const STATUSES: MemberStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];

/**
 * The list's filter state lives in the URL rather than in component state, so a filtered view can
 * be reloaded, bookmarked, shared with a colleague, and survives navigating into a member and
 * back. Anything unrecognised falls back to the default instead of being passed to the API.
 */
export function useListParams(): {
  params: MemberListParams;
  setParams: (patch: Partial<MemberListParams>) => void;
  reset: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo<MemberListParams>(() => {
    const page = Number(searchParams.get("page"));
    const limit = Number(searchParams.get("limit"));
    const status = searchParams.get("status") ?? "";
    const sortBy = searchParams.get("sortBy") ?? "";
    const sortOrder = searchParams.get("sortOrder") ?? "";

    return {
      page: Number.isInteger(page) && page > 0 ? page : DEFAULT_LIST_PARAMS.page,
      limit: Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : DEFAULT_LIST_PARAMS.limit,
      search: searchParams.get("search") ?? "",
      status: STATUSES.includes(status as MemberStatus) ? (status as MemberStatus) : "",
      sortBy: SORT_FIELDS.includes(sortBy as MemberSortField)
        ? (sortBy as MemberSortField)
        : DEFAULT_LIST_PARAMS.sortBy,
      sortOrder: sortOrder === "asc" ? "asc" : DEFAULT_LIST_PARAMS.sortOrder,
    };
  }, [searchParams]);

  const setParams = useCallback(
    (patch: Partial<MemberListParams>) => {
      const next = { ...params, ...patch };

      // Changing a filter while on page 5 of the old result set would usually land on an empty
      // page, so anything other than an explicit page change resets to the first one.
      if (patch.page === undefined) next.page = 1;

      const query = new URLSearchParams();
      if (next.page !== DEFAULT_LIST_PARAMS.page) query.set("page", String(next.page));
      if (next.limit !== DEFAULT_LIST_PARAMS.limit) query.set("limit", String(next.limit));
      if (next.search) query.set("search", next.search);
      if (next.status) query.set("status", next.status);
      if (next.sortBy !== DEFAULT_LIST_PARAMS.sortBy) query.set("sortBy", next.sortBy);
      if (next.sortOrder !== DEFAULT_LIST_PARAMS.sortOrder) query.set("sortOrder", next.sortOrder);

      // `replace` so paging and typing don't bury the previous page under history entries.
      setSearchParams(query, { replace: true });
    },
    [params, setSearchParams],
  );

  const reset = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [
    setSearchParams,
  ]);

  return { params, setParams, reset };
}
