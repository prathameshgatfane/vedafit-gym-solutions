import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { formatWhen } from "../../lib/format";
import { useListParams } from "./useListParams";
import { useOrganizationList } from "./useOrganizations";
import type { OrganizationSortField, OrganizationStatus } from "./organization.types";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
];

const SORT_OPTIONS: { value: OrganizationSortField; label: string }[] = [
  { value: "createdAt", label: "Date created" },
  { value: "name", label: "Name" },
  { value: "slug", label: "Slug" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function pageSizeOptions(current: number) {
  const sizes = PAGE_SIZE_OPTIONS.includes(current)
    ? PAGE_SIZE_OPTIONS
    : [...PAGE_SIZE_OPTIONS, current].sort((a, b) => a - b);
  return sizes.map((size) => ({ value: String(size), label: `${size} per page` }));
}

export function OrganizationsListPage() {
  const navigate = useNavigate();
  const { params, setParams, reset } = useListParams();
  const [searchDraft, setSearchDraft] = useState(params.search);

  useEffect(() => {
    setSearchDraft(params.search);
  }, [params.search]);

  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = setTimeout(() => setParams({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  const query = {
    page: params.page,
    limit: params.limit,
    search: params.search || undefined,
    status: (params.status || undefined) as OrganizationStatus | undefined,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };

  const { data, isPending, isFetching, isError, error } = useOrganizationList(query);
  const organizations = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters = params.search !== "" || params.status !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Organizations</h1>
          <p className="mt-1 text-sm text-accent-muted">
            {pagination
              ? `${pagination.total} ${pagination.total === 1 ? "organization" : "organizations"}${
                  hasFilters ? " matching your filters" : ""
                }`
              : "Loading organizations…"}
          </p>
        </div>
        <Button
          type="button"
          data-testid="new-organization"
          onClick={() => navigate("/organizations/new")}
        >
          New organization
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <TextField
          label="Search"
          value={searchDraft}
          placeholder="Name, slug, or email"
          onChange={(event) => setSearchDraft(event.target.value)}
        />
        <Select
          label="Status"
          placeholder="All statuses"
          options={STATUS_OPTIONS}
          value={params.status}
          onChange={(event) =>
            setParams({ status: event.target.value as OrganizationStatus | "" })
          }
        />
        <Select
          label="Sort by"
          options={SORT_OPTIONS}
          value={params.sortBy}
          onChange={(event) =>
            setParams({ sortBy: event.target.value as OrganizationSortField })
          }
        />
        <Select
          label="Order"
          options={[
            { value: "asc", label: "Ascending" },
            { value: "desc", label: "Descending" },
          ]}
          value={params.sortOrder}
          onChange={(event) =>
            setParams({ sortOrder: event.target.value as "asc" | "desc" })
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Page size"
          options={pageSizeOptions(params.limit)}
          value={String(params.limit)}
          onChange={(event) => setParams({ limit: Number(event.target.value) })}
        />
        {hasFilters ? (
          <Button type="button" variant="secondary" onClick={reset} className="self-end">
            Clear filters
          </Button>
        ) : null}
        {isFetching && !isPending ? (
          <span className="self-end text-xs text-fg-muted">Updating…</span>
        ) : null}
      </div>

      {isError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {apiErrorMessage(error, "Could not load organizations.")}
        </p>
      ) : null}

      {isPending ? <p className="text-sm text-fg-muted">Loading organizations…</p> : null}

      {!isPending && !isError && organizations.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          {hasFilters ? "No organizations match those filters." : "No organizations yet."}
        </p>
      ) : null}

      {organizations.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table data-testid="organizations-table" className="min-w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Subscription</th>
                <th className="px-4 py-3 font-medium">Period end</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => (
                <tr key={org.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link
                      to={`/organizations/${org.id}`}
                      className="font-medium text-accent-text hover:underline"
                    >
                      {org.name}
                    </Link>
                    <p className="text-xs text-fg-muted">
                      {org.slug} · {org.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={org.status} />
                  </td>
                  <td className="px-4 py-3">
                    {org.subscription ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={org.subscription.status} />
                        <span className="text-fg/70">{org.subscription.planCode}</span>
                      </div>
                    ) : (
                      <span className="text-fg-muted">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-fg/70">
                    {formatWhen(org.subscription?.currentPeriodEnd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={pagination.page <= 1}
            onClick={() => setParams({ page: pagination.page - 1 })}
          >
            Previous
          </Button>
          <p className="text-sm text-fg-muted">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setParams({ page: pagination.page + 1 })}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
