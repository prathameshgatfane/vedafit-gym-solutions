import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/** The Section 1.9 list convention, as the UI holds it. */
export interface ListParams<Sort extends string, Status extends string> {
  page: number;
  limit: number;
  search: string;
  status: Status | "";
  sortBy: Sort;
  sortOrder: "asc" | "desc";
}

export interface ListParamsConfig<
  Sort extends string,
  Status extends string,
  Extra extends string = never,
> {
  sortFields: readonly Sort[];
  statuses: readonly Status[];
  defaults: ListParams<Sort, Status>;
  /**
   * Single-value filter keys a screen keeps in the URL beyond the Section 1.9 six — attendance's
   * `date` and `branchId`, for instance. Kept out of `ListParams` so each module still gets a
   * precisely-typed status and sort field rather than a bag of strings.
   */
  extraKeys?: readonly Extra[];
}

/**
 * Keeps a list screen's filter state in the URL rather than in component state, so a filtered
 * view can be reloaded, bookmarked, shared with a colleague, and survives navigating into a row
 * and back. Anything unrecognised falls back to the default instead of being passed to the API.
 *
 * Generic over each module's own sort fields and status enum so a screen can't accidentally
 * request a field its endpoint doesn't sort by. Pass `config` as a module-level constant — it is
 * a dependency of the memoized return values, so a fresh object each render would defeat them.
 */
export function useUrlListParams<
  Sort extends string,
  Status extends string,
  Extra extends string = never,
>(
  config: ListParamsConfig<Sort, Status, Extra>,
): {
  params: ListParams<Sort, Status>;
  setParams: (patch: Partial<ListParams<Sort, Status>>) => void;
  /** The screen's own filter keys, `""` when absent from the URL. */
  extras: Record<Extra, string>;
  /** Sets or (on `""`) clears extra keys. Like `setParams`, it returns to page 1. */
  setExtras: (patch: Partial<Record<Extra, string>>) => void;
  reset: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sortFields, statuses, defaults, extraKeys } = config;

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

      // Changing a filter while on page 5 of the old result set would usually land on an empty
      // page, so anything other than an explicit page change resets to the first one.
      if (patch.page === undefined) next.page = 1;

      // Built from the current URL rather than from empty, so a screen's own extra filters
      // aren't silently dropped every time someone pages or types in the search box.
      const query = new URLSearchParams(searchParams);
      const put = (key: string, value: string, isDefault: boolean) =>
        isDefault ? query.delete(key) : query.set(key, value);

      put("page", String(next.page), next.page === defaults.page);
      put("limit", String(next.limit), next.limit === defaults.limit);
      put("search", next.search, next.search === "");
      put("status", next.status, next.status === "");
      put("sortBy", next.sortBy, next.sortBy === defaults.sortBy);
      put("sortOrder", next.sortOrder, next.sortOrder === defaults.sortOrder);

      // `replace` so paging and typing don't bury the previous page under history entries.
      setSearchParams(query, { replace: true });
    },
    [params, searchParams, setSearchParams, defaults],
  );

  const extras = useMemo(() => {
    const result = {} as Record<Extra, string>;
    for (const key of extraKeys ?? []) {
      result[key] = searchParams.get(key) ?? "";
    }
    return result;
  }, [searchParams, extraKeys]);

  const setExtras = useCallback(
    (patch: Partial<Record<Extra, string>>) => {
      const query = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "") query.delete(key);
        else query.set(key, value as string);
      }
      // An extra filter is still a filter, so it lands on page 1 like the rest of them.
      query.delete("page");
      setSearchParams(query, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const reset = useCallback(
    () => setSearchParams(new URLSearchParams(), { replace: true }),
    [setSearchParams],
  );

  return { params, setParams, extras, setExtras, reset };
}
