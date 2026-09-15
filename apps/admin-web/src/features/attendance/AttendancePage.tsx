import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import { useSessionStore } from "../../stores/session.store";
import { CheckInPanel } from "./CheckInPanel";
import {
  DEFAULT_ATTENDANCE_LIST_PARAMS,
  formatCheckInTime,
  formatRegisterDate,
  overrideLabel,
  type AttendanceExtraKey,
  type AttendanceSortField,
} from "./attendance.types";
import { useAttendanceList, useAttendanceToday } from "./useAttendance";

/** Module-level: the hook memoizes on it, so a fresh object each render would defeat that. */
const CONFIG: ListParamsConfig<AttendanceSortField, never, AttendanceExtraKey> = {
  sortFields: ["checkedInAt", "attendanceDate"],
  statuses: [],
  defaults: DEFAULT_ATTENDANCE_LIST_PARAMS,
  extraKeys: ["date", "branchId", "overridesOnly"],
};

const SORT_OPTIONS = [
  { value: "checkedInAt:desc", label: "Latest arrivals first" },
  { value: "checkedInAt:asc", label: "Earliest arrivals first" },
];

function pageSizeOptions(current: number) {
  const sizes = [20, 50, 100];
  return (sizes.includes(current) ? sizes : [current, ...sizes])
    .sort((a, b) => a - b)
    .map((size) => ({ value: String(size), label: `${size} per page` }));
}

export function AttendancePage() {
  const user = useSessionStore((s) => s.user);
  const branches = useSessionStore((s) => s.branches);
  const activeBranchId = useSessionStore((s) => s.activeBranchId);
  const timeZone = useSessionStore((s) => s.organization?.timezone ?? "UTC");
  const canMark = useSessionStore((s) => s.hasPermission("attendance.mark"));
  const canView = useSessionStore((s) => s.hasPermission("attendance.view"));
  const ownRoster = canView && !canMark;

  const { params, setParams, extras, setExtras, reset } = useUrlListParams(CONFIG);

  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchDraft !== params.search) setParams({ search: searchDraft });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  /**
   * A branch-scoped user's branch is not theirs to choose — Phase 2's `tenantScope` rejects a
   * `branchId` that isn't their own outright, so the filter is fixed rather than merely defaulted
   * (1.17.3). Org-wide staff pick, falling back to the shell's active branch.
   */
  const scopedBranchId = user?.branchId ?? null;
  const selectedBranchId = scopedBranchId ?? extras.branchId ?? "";
  const checkInBranchId = scopedBranchId ?? selectedBranchId ?? activeBranchId ?? "";
  const checkInBranchName =
    branches.find((b) => b.id === checkInBranchId)?.name ?? "this branch";

  // The register defaults to today, but today is the *gym's* today — the browser's clock isn't
  // the authority on which day a check-in counts as (1.17.4).
  const today = useAttendanceToday(checkInBranchId || undefined);
  const registerDate = extras.date || today.data?.date || "";
  const isToday = today.data ? registerDate === today.data.date : false;
  const overridesOnly = extras.overridesOnly === "true";

  const { data, isPending, isFetching, isError, error } = useAttendanceList({
    ...params,
    date: registerDate || undefined,
    branchId: selectedBranchId || undefined,
    overridesOnly,
  });

  const rows = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters =
    params.search !== "" || overridesOnly || (extras.date !== "" && !isToday) ||
    (scopedBranchId === null && extras.branchId !== "");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg">Attendance</h1>
        <p className="mt-1 text-sm text-accent-muted">
          Who came in, and when. A member is recorded once a day — a second tap is a no-op, not a
          second visit.
        </p>
      </div>

      {ownRoster ? (
        <p
          data-testid="own-roster-banner"
          className="rounded-md border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent-muted"
        >
          This register is check-ins for members assigned to you — not the gym&apos;s full day.
        </p>
      ) : null}

      {today.data ? (
        <div
          data-testid="today-banner"
          className="rounded-md border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent-muted"
        >
          <span className="font-semibold text-fg">
            {formatRegisterDate(today.data.date)}
          </span>{" "}
          — {today.data.count} {today.data.count === 1 ? "member has" : "members have"} checked in
          so far.
        </div>
      ) : null}

      {canMark && checkInBranchId ? (
        <CheckInPanel branchId={checkInBranchId} branchName={checkInBranchName} />
      ) : canMark ? (
        <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-fg-muted">
          Pick a branch above before checking anyone in — attendance is recorded against the branch
          it happened at.
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-fg">
          Register{registerDate ? ` — ${formatRegisterDate(registerDate)}` : ""}
        </h2>

        <div
          data-testid="attendance-filter-bar"
          className="grid grid-cols-2 items-end gap-3 rounded-lg border border-border bg-surface p-4 md:flex md:flex-wrap"
        >
          <div className="col-span-2 min-w-0 md:min-w-56 md:flex-1">
          <TextField
            label="Search"
            type="search"
            data-testid="attendance-search"
            placeholder="Name or phone"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          </div>

          <TextField
            label="Date"
            type="date"
            data-testid="attendance-date"
            value={registerDate}
            onChange={(event) => setExtras({ date: event.target.value })}
          />

          {scopedBranchId === null && branches.length > 0 ? (
            <Select
              label="Branch"
              data-testid="attendance-branch"
              placeholder="All branches"
              value={extras.branchId}
              options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(event) => setExtras({ branchId: event.target.value })}
            />
          ) : null}

          <Select
            label="Show"
            data-testid="attendance-coverage"
            value={overridesOnly ? "overrides" : "all"}
            options={[
              { value: "all", label: "All check-ins" },
              { value: "overrides", label: "Overrides only" },
            ]}
            onChange={(event) =>
              setExtras({ overridesOnly: event.target.value === "overrides" ? "true" : "" })
            }
          />

          <Select
            label="Sort"
            value={`${params.sortBy}:${params.sortOrder}`}
            options={SORT_OPTIONS}
            onChange={(event) => {
              const [sortBy, sortOrder] = event.target.value.split(":");
              setParams({
                sortBy: sortBy as AttendanceSortField,
                sortOrder: sortOrder as "asc" | "desc",
              });
            }}
          />

          <Select
            label="Page size"
            value={String(params.limit)}
            options={pageSizeOptions(params.limit)}
            onChange={(event) => setParams({ limit: Number(event.target.value) })}
          />

          {hasFilters ? (
            <Button variant="secondary" className="col-span-2 md:col-auto" onClick={reset}>
              Clear filters
            </Button>
          ) : null}
        </div>

        {isError ? (
          <div role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
            {apiErrorMessage(error, "Could not load the register")}
          </div>
        ) : null}

        <DataTable>
          <table data-testid="attendance-table" className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Coverage</th>
                <th className="px-4 py-3 font-medium">Marked by</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y divide-fg/5 transition-opacity ${
                isFetching && !isPending ? "opacity-60" : ""
              }`}
            >
              {isPending ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
                    Loading the register…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
                    {overridesOnly
                      ? "No overrides on this day — everyone who came in was covered."
                      : ownRoster
                        ? "None of your assigned members have checked in on this day."
                        : "Nobody has checked in on this day yet."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="attendance-row"
                    data-member-id={row.memberId}
                    className="bg-bg"
                  >
                    <td className="px-4 py-3 text-fg/70">
                      {formatCheckInTime(row.checkedInAt, timeZone)}
                    </td>
                    <td className="px-4 py-3 font-medium text-fg">
                      {row.member.firstName} {row.member.lastName}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{row.member.phone}</td>
                    <td className="px-4 py-3 text-fg-muted">{row.branch.name}</td>
                    <td className="px-4 py-3">
                      {row.overrideReason ? (
                        <span
                          data-testid="coverage-override"
                          className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning"
                        >
                          Override · {overrideLabel(row.overrideReason)}
                        </span>
                      ) : (
                        <span
                          data-testid="coverage-covered"
                          className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent-text"
                        >
                          Covered
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {row.markedBy?.name ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </DataTable>

        {pagination && pagination.totalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg-muted">
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} check-ins
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
    </div>
  );
}
