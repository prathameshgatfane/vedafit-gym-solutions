import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export interface ListParams<Sort extends string, Status extends string> {
  page: number;
  limit: number;
  search: string;
  status: Status | "";
  sortBy: Sort;
  sortOrder: "asc" | "desc";
}

export interface ListParamsConfig<Sort extends string, Status extends string> {
  sortFields: readonly Sort[];
  statuses: readonly Status[];
  defaults: ListParams<Sort, Status>;
}

export function useUrlListParams<Sort extends string, Status extends string>(
  config: ListParamsConfig<Sort, Status>,
): {
  params: ListParams<Sort, Status>;
  setParams: (patch: Partial<ListParams<Sort, Status>>) => void;
  reset: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sortFields, statuses, defaults } = config;

  const params = useMemo<ListParams<Sort, Status>>(() => {
    const page = Number(searchParams.get("page"));
    const limit = Number(searchParams.get("limit"));
    const status = searchParams.get("status") ?? "";
    const sortBy = searchParams.get("sortBy") ?? "";
    const sortOrder = searchParams.get("sortOrder") ?? "";

    return {
      page: Number.isInteger(page) && page > 0 ? page : defaults.page,
      limit: Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : defaults.limit,
      search: searchParams.get("search") ?? "",
      status: statuses.includes(status as Status) ? (status as Status) : "",
      sortBy: sortFields.includes(sortBy as Sort) ? (sortBy as Sort) : defaults.sortBy,
      sortOrder: sortOrder === "asc" || sortOrder === "desc" ? sortOrder : defaults.sortOrder,
    };
  }, [searchParams, sortFields, statuses, defaults]);

  const setParams = useCallback(
    (patch: Partial<ListParams<Sort, Status>>) => {
      const next = { ...params, ...patch };
      if (patch.page === undefined) next.page = 1;

      const query = new URLSearchParams();
      const put = (key: string, value: string, isDefault: boolean) => {
        if (!isDefault) query.set(key, value);
      };

      put("page", String(next.page), next.page === defaults.page);
      put("limit", String(next.limit), next.limit === defaults.limit);
      put("search", next.search, next.search === "");
      put("status", next.status, next.status === "");
      put("sortBy", next.sortBy, next.sortBy === defaults.sortBy);
      put("sortOrder", next.sortOrder, next.sortOrder === defaults.sortOrder);
      setSearchParams(query, { replace: true });
    },
    [params, setSearchParams, defaults],
  );

  const reset = useCallback(
    () => setSearchParams(new URLSearchParams(), { replace: true }),
    [setSearchParams],
  );

  return { params, setParams, reset };
}
