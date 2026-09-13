import { useUrlListParams } from "../../lib/url-list-params";
import type { OrganizationSortField, OrganizationStatus } from "./organization.types";

const SORT_FIELDS = ["createdAt", "name", "slug"] as const satisfies readonly OrganizationSortField[];
const STATUSES = ["ACTIVE", "SUSPENDED"] as const satisfies readonly OrganizationStatus[];

export function useListParams() {
  return useUrlListParams({
    sortFields: SORT_FIELDS,
    statuses: STATUSES,
    defaults: {
      page: 1,
      limit: 20,
      search: "",
      status: "",
      sortBy: "createdAt",
      sortOrder: "asc",
    },
  });
}
