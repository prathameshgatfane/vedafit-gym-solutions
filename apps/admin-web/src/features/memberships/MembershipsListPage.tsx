import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import { formatPrice } from "../membership-plans/plan.types";
import { useMembershipList } from "./useMemberships";
import {
  DEFAULT_MEMBERSHIP_LIST_PARAMS,
  type MembershipSortField,
  type MembershipStatus,
} from "./membership.types";

/** Module-level so the hook's memoized params/setters stay referentially stable across renders. */
const CONFIG: ListParamsConfig<MembershipSortField, MembershipStatus> = {
  sortFields: ["startDate", "endDate", "createdAt"],
  statuses: ["ACTIVE", "EXPIRED", "FROZEN", "CANCELLED"],
  defaults: DEFAULT_MEMBERSHIP_LIST_PARAMS,
};

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "FROZEN", label: "Frozen" },
  { value: "EXPIRED", label: "Expired" },
  { value: "CANCELLED", label: "Cancelled" },
];

const SORT_OPTIONS: { value: MembershipSortField; label: string }[] = [
  { value: "endDate", label: "End date" },
  { value: "startDate", label: "Start date" },
  { value: "createdAt", label: "Date sold" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/** A hand-written `?limit=1` has to appear in the control rather than being misreported. */
function pageSizeOptions(current: number) {
  const sizes = PAGE_SIZE_OPTIONS.includes(current)
    ? PAGE_SIZE_OPTIONS
    : [...PAGE_SIZE_OPTIONS, current].sort((a, b) => a - b);
  return sizes.map((size) => ({ value: String(size), label: `${size} per page` }));
}

export function MembershipsListPage() {
  const { params, setParams, reset } = useUrlListParams(CONFIG);
  const [searchDraft, setSearchDraft] = useState(params.search);

  useEffect(() => {
    setSearchDraft(params.search);
  }, [params.search]);

  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = setTimeout(() => setParams({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  const { data, isPending, isFetching, isError, error } = useMembershipList(params);

  const memberships = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters = params.search !== "" || params.status !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-white">Memberships</h1>
          <p className="mt-1 text-sm text-brand-green-muted">
            {pagination
              ? `${pagination.total} ${pagination.total === 1 ? "membership" : "memberships"}${
                  hasFilters ? " matching your filters" : ""
                }`
              : "Loading memberships…"}
          </p>
        </div>
      </div>

      {/* Selling starts from a member, so there's no "add" button here — just a pointer to where
          the action lives, rather than a dead end. */}
      <p className="text-sm text-brand-white/50">
        To sell a membership, open a member and choose “Sell membership”.
      </p>

      <div
        data-testid="memberships-filter-bar"
        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-brand-white/10 bg-brand-black-88 p-4 md:flex md:flex-wrap"
      >
        <div className="col-span-2 min-w-0 md:min-w-56 md:flex-1">
          <TextField
            label="Search"
            type="search"
            placeholder="Member name or phone"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
        </div>

        <Select
          label="Status"
          placeholder="All statuses"
          options={STATUS_OPTIONS}
          value={params.status}
          onChange={(e) => setParams({ status: e.target.value as MembershipStatus | "" })}
        />

        <Select
          label="Sort by"
          options={SORT_OPTIONS}
          value={params.sortBy}
          onChange={(e) => setParams({ sortBy: e.target.value as MembershipSortField })}
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
          {apiErrorMessage(error, "Could not load memberships.")}
        </p>
      ) : null}

      <DataTable>
        <table data-testid="memberships-table" className="w-full text-left text-sm">
          <thead className="bg-brand-black-88 text-xs uppercase tracking-wide text-brand-white/50">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Member</th>
              <th scope="col" className="px-4 py-3 font-medium">Plan</th>
              <th scope="col" className="px-4 py-3 font-medium">Price paid</th>
              <th scope="col" className="px-4 py-3 font-medium">Term</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
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
                  Loading memberships…
                </td>
              </tr>
            ) : memberships.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  {hasFilters ? "No memberships match those filters." : "No memberships yet."}
                </td>
              </tr>
            ) : (
              memberships.map((membership) => (
                <tr key={membership.id} className="bg-brand-black hover:bg-brand-white/5">
                  <td className="px-4 py-3">
                    <Link
                      to={`/memberships/${membership.id}`}
                      className="font-medium text-brand-white hover:text-brand-green"
                    >
                      {membership.member.firstName} {membership.member.lastName}
                    </Link>
                    <span className="block text-xs text-brand-white/40">
                      {membership.member.phone}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-white/70">{membership.plan.name}</td>
                  <td className="px-4 py-3 text-brand-white/70">
                    {formatPrice(membership.priceAtPurchase)}
                  </td>
                  <td className="px-4 py-3 text-brand-white/70">
                    {membership.startDate} → {membership.endDate}
                    {membership.status === "ACTIVE" && !membership.isUpcoming ? (
                      <span className="block text-xs text-brand-white/40">
                        {membership.daysRemaining} days left
                      </span>
                    ) : null}
                    {membership.isUpcoming ? (
                      <span className="block text-xs text-brand-green-muted">upcoming</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={membership.status} />
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
