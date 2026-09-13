import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import { useSessionStore } from "../../stores/session.store";
import { usePlanList, useSetPlanStatus } from "./usePlans";
import {
  DEFAULT_PLAN_LIST_PARAMS,
  formatDuration,
  formatPrice,
  type PlanSortField,
  type PlanStatus,
} from "./plan.types";

/** Module-level so the hook's memoized params/setters stay referentially stable across renders. */
const CONFIG: ListParamsConfig<PlanSortField, PlanStatus> = {
  sortFields: ["name", "price", "durationDays", "createdAt"],
  statuses: ["ACTIVE", "INACTIVE"],
  defaults: DEFAULT_PLAN_LIST_PARAMS,
};

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Retired" },
];

const SORT_OPTIONS: { value: PlanSortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "price", label: "Price" },
  { value: "durationDays", label: "Duration" },
  { value: "createdAt", label: "Date added" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/** A hand-written `?limit=1` has to appear in the control rather than being misreported. */
function pageSizeOptions(current: number) {
  const sizes = PAGE_SIZE_OPTIONS.includes(current)
    ? PAGE_SIZE_OPTIONS
    : [...PAGE_SIZE_OPTIONS, current].sort((a, b) => a - b);
  return sizes.map((size) => ({ value: String(size), label: `${size} per page` }));
}

export function PlansListPage() {
  const navigate = useNavigate();
  const { params, setParams, reset } = useUrlListParams(CONFIG);
  const canManage = useSessionStore((s) => s.hasPermission("membership-plans.manage"));

  const [searchDraft, setSearchDraft] = useState(params.search);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setSearchDraft(params.search);
  }, [params.search]);

  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = setTimeout(() => setParams({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  const { data, isPending, isFetching, isError, error } = usePlanList(params);
  const statusMutation = useSetPlanStatus();

  const plans = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters = params.search !== "" || params.status !== "";

  async function toggleStatus(planId: string, current: PlanStatus) {
    setActionError(null);
    try {
      await statusMutation.mutateAsync({
        planId,
        status: current === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not update this plan."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-white">Membership plans</h1>
          <p className="mt-1 text-sm text-brand-green-muted">
            {pagination
              ? `${pagination.total} ${pagination.total === 1 ? "plan" : "plans"}${
                  hasFilters ? " matching your filters" : ""
                }`
              : "Loading plans…"}
          </p>
        </div>
        {canManage ? <Button onClick={() => navigate("/membership-plans/new")}>Add plan</Button> : null}
      </div>

      {/* Says out loud what the snapshot design guarantees, so nobody edits a price expecting
          it to reach existing members — or avoids editing one for fear that it will. */}
      <p className="rounded-md border border-brand-green/25 bg-brand-green/5 px-4 py-3 text-sm text-brand-green-muted">
        Changing a plan's price or duration only affects memberships sold from now on. Terms
        already issued keep the price they were sold at.
      </p>

      <div
        data-testid="plans-filter-bar"
        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-brand-white/10 bg-brand-black-88 p-4 md:flex md:flex-wrap"
      >
        <div className="col-span-2 min-w-0 md:min-w-56 md:flex-1">
          <TextField
            label="Search"
            type="search"
            placeholder="Plan name"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
        </div>

        <Select
          label="Status"
          placeholder="All plans"
          options={STATUS_OPTIONS}
          value={params.status}
          onChange={(e) => setParams({ status: e.target.value as PlanStatus | "" })}
        />

        <Select
          label="Sort by"
          options={SORT_OPTIONS}
          value={params.sortBy}
          onChange={(e) => setParams({ sortBy: e.target.value as PlanSortField })}
        />

        <Select
          label="Order"
          options={[
            { value: "asc", label: "Ascending" },
            { value: "desc", label: "Descending" },
          ]}
          value={params.sortOrder}
          onChange={(e) => setParams({ sortOrder: e.target.value === "asc" ? "asc" : "desc" })}
        />

        <Select
          label="Page size"
          options={pageSizeOptions(params.limit)}
          value={String(params.limit)}
          onChange={(e) => setParams({ limit: Number(e.target.value) })}
        />

        {hasFilters ? (
          <Button variant="secondary" className="col-span-2 md:col-auto" onClick={reset}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {isError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load membership plans.")}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </p>
      ) : null}

      <DataTable>
        <table data-testid="plans-table" className="w-full text-left text-sm">
          <thead className="bg-brand-black-88 text-xs uppercase tracking-wide text-brand-white/50">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Plan</th>
              <th scope="col" className="px-4 py-3 font-medium">Price</th>
              <th scope="col" className="px-4 py-3 font-medium">Duration</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-brand-white/5 transition-opacity ${
              isFetching && !isPending ? "opacity-60" : ""
            }`}
          >
            {isPending ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  Loading plans…
                </td>
              </tr>
            ) : plans.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  {hasFilters ? "No plans match those filters." : "No plans yet."}
                </td>
              </tr>
            ) : (
              plans.map((plan) => (
                <tr key={plan.id} className="bg-brand-black hover:bg-brand-white/5">
                  <td className="px-4 py-3 font-medium text-brand-white">{plan.name}</td>
                  <td data-testid="plan-price" className="px-4 py-3 text-brand-white/70">
                    {formatPrice(plan.price)}
                  </td>
                  <td className="px-4 py-3 text-brand-white/70">
                    {formatDuration(plan.durationDays)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={plan.status} />
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => navigate(`/membership-plans/${plan.id}/edit`)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={statusMutation.isPending}
                          onClick={() => toggleStatus(plan.id, plan.status)}
                        >
                          {plan.status === "ACTIVE" ? "Retire" : "Reactivate"}
                        </Button>
                      </div>
                    ) : (
                      <span className="block text-right text-brand-white/30">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTable>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p data-testid="pagination-summary" className="text-sm text-brand-white/50">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={pagination.page <= 1}
              onClick={() => setParams({ page: pagination.page - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setParams({ page: pagination.page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
