import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice } from "../../lib/money";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import { useSessionStore } from "../../stores/session.store";
import {
  DEFAULT_INVOICE_LIST_PARAMS,
  type InvoiceSortField,
  type InvoiceStatus,
} from "./invoice.types";
import { useInvoiceList } from "./useInvoices";

const CONFIG: ListParamsConfig<InvoiceSortField, InvoiceStatus> = {
  sortFields: ["createdAt", "invoiceNumber", "amountTotal", "amountPending"],
  statuses: ["DRAFT", "UNPAID", "PARTIALLY_PAID", "PAID", "CANCELLED"],
  defaults: DEFAULT_INVOICE_LIST_PARAMS,
};

const STATUS_OPTIONS = [
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Partly paid" },
  { value: "PAID", label: "Paid" },
  { value: "CANCELLED", label: "Cancelled" },
];

const SORT_OPTIONS = [
  { value: "createdAt", label: "Raised" },
  { value: "invoiceNumber", label: "Invoice number" },
  { value: "amountTotal", label: "Total" },
  { value: "amountPending", label: "Outstanding" },
];

function pageSizeOptions(current: number) {
  const sizes = [10, 20, 50];
  return (sizes.includes(current) ? sizes : [...sizes, current].sort((a, b) => a - b)).map(
    (size) => ({ value: String(size), label: `${size} per page` }),
  );
}

export function InvoicesListPage() {
  const navigate = useNavigate();
  const { params, setParams, reset } = useUrlListParams(CONFIG);
  const canManage = useSessionStore((s) => s.hasPermission("invoices.manage"));

  /**
   * "Pending fees" is the screen the front desk actually wants, and it isn't a status — a bill is
   * outstanding whether it's untouched or half paid. Kept out of the URL params hook because it
   * is a boolean, not one of the Section 1.9 five.
   */
  const [outstandingOnly, setOutstandingOnly] = useState(false);

  const [searchDraft, setSearchDraft] = useState(params.search);

  useEffect(() => {
    setSearchDraft(params.search);
  }, [params.search]);

  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = setTimeout(() => setParams({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  const query = { ...params, outstanding: outstandingOnly || undefined };
  const { data, isPending, isFetching, isError, error } = useInvoiceList(query);

  const invoices = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters = params.search !== "" || params.status !== "" || outstandingOnly;

  const outstandingOnPage = invoices.reduce((sum, i) => sum + Number(i.amountPending), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Invoices</h1>
          <p className="mt-1 text-sm text-accent-muted">
            {pagination
              ? `${pagination.total} ${pagination.total === 1 ? "invoice" : "invoices"}${
                  hasFilters ? " matching your filters" : ""
                }`
              : "Loading invoices…"}
          </p>
        </div>
        {canManage ? <Button onClick={() => navigate("/invoices/new")}>Raise invoice</Button> : null}
      </div>

      <p className="rounded-md border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent-muted">
        Selling or renewing a membership raises its invoice automatically. Use “Raise invoice” only
        for one-off charges — a joining fee, personal training, merchandise.
      </p>

      <div
        data-testid="invoices-filter-bar"
        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-border bg-surface p-4 md:flex md:flex-wrap"
      >
        <div className="col-span-2 min-w-0 md:min-w-56 md:flex-1">
          <TextField
            label="Search"
            type="search"
            placeholder="Invoice number, member name or phone"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
        </div>

        <Select
          label="Status"
          placeholder="All invoices"
          options={STATUS_OPTIONS}
          value={params.status}
          onChange={(e) => setParams({ status: e.target.value as InvoiceStatus | "" })}
        />

        <Select
          label="Sort by"
          options={SORT_OPTIONS}
          value={params.sortBy}
          onChange={(e) => setParams({ sortBy: e.target.value as InvoiceSortField })}
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

        <label className="flex items-center gap-2 pb-2 text-sm text-fg/80">
          <input
            data-testid="outstanding-toggle"
            type="checkbox"
            checked={outstandingOnly}
            onChange={(e) => {
              setOutstandingOnly(e.target.checked);
              setParams({ page: 1 });
            }}
            className="h-4 w-4 accent-accent"
          />
          Pending fees only
        </label>

        {hasFilters ? (
          <Button
            variant="secondary"
            className="col-span-2 md:col-auto"
            onClick={() => {
              setOutstandingOnly(false);
              reset();
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {isError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {apiErrorMessage(error, "Could not load invoices.")}
        </p>
      ) : null}

      <DataTable>
        <table data-testid="invoices-table" className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Invoice</th>
              <th scope="col" className="px-4 py-3 font-medium">Member</th>
              <th scope="col" className="px-4 py-3 font-medium">For</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Total</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Outstanding</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
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
                  Loading invoices…
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
                  {hasFilters ? "No invoices match those filters." : "No invoices yet."}
                </td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  onClick={() => navigate(`/invoices/${invoice.id}`)}
                  className="cursor-pointer bg-bg hover:bg-fg/5"
                >
                  <td
                    data-testid="invoice-number"
                    className="px-4 py-3 font-medium text-fg"
                  >
                    {invoice.invoiceNumber}
                  </td>
                  <td className="px-4 py-3 text-fg/70">
                    {invoice.member.firstName} {invoice.member.lastName}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{invoice.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-fg/70">
                    {formatPrice(invoice.amountTotal)}
                  </td>
                  <td
                    data-testid="invoice-pending"
                    className={`px-4 py-3 text-right ${
                      Number(invoice.amountPending) > 0 ? "text-warning" : "text-fg-muted"
                    }`}
                  >
                    {formatPrice(invoice.amountPending)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTable>

      {invoices.length > 0 ? (
        <p data-testid="outstanding-total" className="text-sm text-fg-muted">
          Outstanding on this page: {formatPrice(outstandingOnPage.toFixed(2))}
        </p>
      ) : null}

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
