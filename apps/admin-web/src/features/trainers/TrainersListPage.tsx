import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import { useTrainerList } from "./useTrainers";
import {
  DEFAULT_TRAINER_LIST_PARAMS,
  type TrainerSortField,
} from "./trainer.types";

const CONFIG: ListParamsConfig<TrainerSortField, never> = {
  sortFields: ["name", "createdAt"],
  statuses: [],
  defaults: DEFAULT_TRAINER_LIST_PARAMS,
};

const SORT_OPTIONS: { value: TrainerSortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "createdAt", label: "Date added" },
];

function pageSizeOptions(current: number) {
  const sizes = [10, 25, 50].includes(current)
    ? [10, 25, 50]
    : [current, 10, 25, 50].sort((a, b) => a - b);
  return sizes.map((size) => ({ value: String(size), label: `${size} per page` }));
}

export function TrainersListPage() {
  const navigate = useNavigate();
  const { params, setParams, reset } = useUrlListParams(CONFIG);

  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);
  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = setTimeout(() => setParams({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  const { data, isPending, isFetching, isError, error } = useTrainerList(params);
  const trainers = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters = params.search !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 data-testid="trainers-heading" className="text-2xl font-semibold text-fg">
            Trainers
          </h1>
          <p className="mt-1 text-sm text-accent-muted">
            {pagination
              ? `${pagination.total} ${pagination.total === 1 ? "trainer" : "trainers"}${
                  hasFilters ? " matching your filters" : ""
                }`
              : "Loading trainers…"}
          </p>
        </div>
        <Button data-testid="add-trainer" onClick={() => navigate("/trainers/new")}>
          Add trainer
        </Button>
      </div>

      <p className="rounded-md border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent-muted">
        Assigning a member is what puts them on that trainer&apos;s roster. Unassigning drops
        access immediately — including past check-ins. This is a worklist, not a coaching ledger.
      </p>

      <div
        data-testid="trainers-filter-bar"
        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-border bg-surface p-4 md:flex md:flex-wrap"
      >
        <div className="col-span-2 min-w-0 md:min-w-56 md:flex-1">
          <TextField
            label="Search"
            type="search"
            placeholder="Name or email"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </div>
        <Select
          label="Sort by"
          options={SORT_OPTIONS}
          value={params.sortBy}
          onChange={(event) => setParams({ sortBy: event.target.value as TrainerSortField })}
        />
        <Select
          label="Order"
          options={[
            { value: "asc", label: "Ascending" },
            { value: "desc", label: "Descending" },
          ]}
          value={params.sortOrder}
          onChange={(event) =>
            setParams({ sortOrder: event.target.value === "asc" ? "asc" : "desc" })
          }
        />
        <Select
          label="Page size"
          options={pageSizeOptions(params.limit)}
          value={String(params.limit)}
          onChange={(event) => setParams({ limit: Number(event.target.value) })}
        />
        {hasFilters ? (
          <Button variant="secondary" className="col-span-2 md:col-auto" onClick={reset}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {isError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {apiErrorMessage(error, "Could not load trainers.")}
        </p>
      ) : null}

      <DataTable>
        <table data-testid="trainers-table" className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Email</th>
              <th scope="col" className="px-4 py-3 font-medium">Specialization</th>
              <th scope="col" className="px-4 py-3 font-medium">Assigned</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-fg/5 transition-opacity ${
              isFetching && !isPending ? "opacity-60" : ""
            }`}
          >
            {isPending ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-fg-muted">
                  Loading trainers…
                </td>
              </tr>
            ) : trainers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-fg-muted">
                  {hasFilters ? "No trainers match those filters." : "No trainer profiles yet."}
                </td>
              </tr>
            ) : (
              trainers.map((trainer) => (
                <tr
                  key={trainer.id}
                  data-testid="trainer-row"
                  data-trainer-id={trainer.id}
                  className="bg-bg hover:bg-fg/5"
                >
                  <td className="px-4 py-3 font-medium text-fg">{trainer.user.name}</td>
                  <td className="px-4 py-3 text-fg/70">{trainer.user.email}</td>
                  <td className="px-4 py-3 text-fg/70">
                    {trainer.specialization ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-fg/70">{trainer.assignments.length}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => navigate(`/trainers/${trainer.id}`)}
                      >
                        Roster
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => navigate(`/trainers/${trainer.id}/edit`)}
                      >
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTable>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p data-testid="pagination-summary" className="text-sm text-fg-muted">
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
