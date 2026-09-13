import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { useListParams } from "./useListParams";
import { useMemberList } from "./useMembers";
import type { MemberSortField, MemberStatus } from "./member.types";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "ARCHIVED", label: "Archived" },
];

const SORT_OPTIONS: { value: MemberSortField; label: string }[] = [
  { value: "createdAt", label: "Date added" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "phone", label: "Phone" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/**
 * The API accepts any limit up to 100 and the URL is a legitimate way to set one, so a
 * hand-written `?limit=1` has to appear in the control rather than leaving it displaying its
 * first option and quietly misreporting the current page size.
 */
function pageSizeOptions(current: number) {
  const sizes = PAGE_SIZE_OPTIONS.includes(current)
    ? PAGE_SIZE_OPTIONS
    : [...PAGE_SIZE_OPTIONS, current].sort((a, b) => a - b);
  return sizes.map((size) => ({ value: String(size), label: `${size} per page` }));
}

export function MembersListPage() {
  const navigate = useNavigate();
  const { params, setParams, reset } = useListParams();
  const canCreate = useSessionStore((s) => s.hasPermission("members.create"));
  // Same discriminator as the API (1.19.1): view without mark is own-roster, not a role name.
  const canViewAttendance = useSessionStore((s) => s.hasPermission("attendance.view"));
  const canMarkAttendance = useSessionStore((s) => s.hasPermission("attendance.mark"));
  const ownRoster = canViewAttendance && !canMarkAttendance;

  // The input is uncontrolled by the URL while typing, then debounced into it — otherwise every
  // keystroke would be a request and a history write.
  const [searchDraft, setSearchDraft] = useState(params.search);

  useEffect(() => {
    setSearchDraft(params.search);
  }, [params.search]);

  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = setTimeout(() => setParams({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  const { data, isPending, isFetching, isError, error } = useMemberList(params);

  const members = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters = params.search !== "" || params.status !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-white">Members</h1>
          <p className="mt-1 text-sm text-brand-green-muted">
            {pagination
              ? `${pagination.total} ${pagination.total === 1 ? "member" : "members"}${
                  hasFilters ? " matching your filters" : ""
                }`
              : "Loading members…"}
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => navigate("/members/new")}>Add member</Button>
        ) : null}
      </div>

      {ownRoster ? (
        <p
          data-testid="own-roster-banner"
          className="rounded-md border border-brand-green/25 bg-brand-green/5 px-4 py-3 text-sm text-brand-green-muted"
        >
          This list is the members assigned to you — not the gym&apos;s full roster.
        </p>
      ) : null}

      <div
        data-testid="members-filter-bar"
        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-brand-white/10 bg-brand-black-88 p-4 md:flex md:flex-wrap"
      >
        <div className="col-span-2 min-w-0 md:min-w-56 md:flex-1">
          <TextField
            label="Search"
            type="search"
            placeholder="Name, phone or email"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
        </div>

        <Select
          label="Status"
          placeholder="All active"
          options={STATUS_OPTIONS}
          value={params.status}
          onChange={(e) => setParams({ status: e.target.value as MemberStatus | "" })}
        />

        <Select
          label="Sort by"
          options={SORT_OPTIONS}
          value={params.sortBy}
          onChange={(e) => setParams({ sortBy: e.target.value as MemberSortField })}
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
          {apiErrorMessage(error, "Could not load members.")}
        </p>
      ) : null}

      <DataTable>
        <table data-testid="members-table" className="w-full text-left text-sm">
          <thead className="bg-brand-black-88 text-xs uppercase tracking-wide text-brand-white/50">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Phone</th>
              <th scope="col" className="px-4 py-3 font-medium">Email</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Added</th>
            </tr>
          </thead>
          <tbody
            // Dimmed while a background refetch is in flight, so the table visibly belongs to the
            // filters being typed rather than looking stale-but-authoritative.
            className={`divide-y divide-brand-white/5 transition-opacity ${
              isFetching && !isPending ? "opacity-60" : ""
            }`}
          >
            {isPending ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  Loading members…
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  {hasFilters
                    ? "No members match those filters."
                    : ownRoster
                      ? "No members assigned to you yet."
                      : "No members yet."}
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.id} className="bg-brand-black hover:bg-brand-white/5">
                  <td className="px-4 py-3">
                    <Link
                      to={`/members/${member.id}`}
                      className="font-medium text-brand-white hover:text-brand-green"
                    >
                      {member.firstName} {member.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-brand-white/70">{member.phone}</td>
                  <td className="px-4 py-3 text-brand-white/70">{member.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={member.status} />
                  </td>
                  <td className="px-4 py-3 text-brand-white/50">
                    {new Date(member.createdAt).toLocaleDateString()}
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
