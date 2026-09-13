import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice, formatSignedPrice } from "../../lib/money";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import {
  DEFAULT_PAYMENT_LIST_PARAMS,
  type PaymentSortField,
  type PaymentStatus,
} from "./payment.types";
import { usePaymentList } from "./usePayments";

const CONFIG: ListParamsConfig<PaymentSortField, PaymentStatus> = {
  sortFields: ["paidAt", "amount", "createdAt"],
  statuses: ["SUCCESS", "REFUNDED", "PENDING", "FAILED"],
  defaults: DEFAULT_PAYMENT_LIST_PARAMS,
};

const STATUS_OPTIONS = [
  { value: "SUCCESS", label: "Receipts" },
  { value: "REFUNDED", label: "Refunds" },
];

const SORT_OPTIONS = [
  { value: "paidAt", label: "Date" },
  { value: "amount", label: "Amount" },
  { value: "createdAt", label: "Recorded" },
];

function pageSizeOptions(current: number) {
  const sizes = [10, 20, 50];
  return (sizes.includes(current) ? sizes : [...sizes, current].sort((a, b) => a - b)).map(
    (size) => ({ value: String(size), label: `${size} per page` }),
  );
}

export function PaymentsListPage() {
  const navigate = useNavigate();
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

  const { data, isPending, isFetching, isError, error } = usePaymentList(params);

  const payments = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters = params.search !== "" || params.status !== "";

  // Receipts minus refunds — the net the gym actually kept from the rows on screen.
  const netOnPage = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-white">Payments</h1>
        <p className="mt-1 text-sm text-brand-green-muted">
          {pagination
            ? `${pagination.total} ${pagination.total === 1 ? "entry" : "entries"}${
                hasFilters ? " matching your filters" : ""
              }`
            : "Loading payments…"}
        </p>
      </div>

      <p className="rounded-md border border-brand-green/25 bg-brand-green/5 px-4 py-3 text-sm text-brand-green-muted">
        This is a ledger, not a list of edits. Refunds appear as their own negative entries beside
        the payments they reverse — nothing here is ever changed or removed after the fact.
      </p>

      <div
        data-testid="payments-filter-bar"
        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-brand-white/10 bg-brand-black-88 p-4 md:flex md:flex-wrap"
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
          label="Entry type"
          placeholder="Everything"
          options={STATUS_OPTIONS}
          value={params.status}
          onChange={(e) => setParams({ status: e.target.value as PaymentStatus | "" })}
        />

        <Select
          label="Sort by"
          options={SORT_OPTIONS}
          value={params.sortBy}
          onChange={(e) => setParams({ sortBy: e.target.value as PaymentSortField })}
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
          {apiErrorMessage(error, "Could not load payments.")}
        </p>
      ) : null}

      <DataTable>
        <table data-testid="payments-table" className="w-full text-left text-sm">
          <thead className="bg-brand-black-88 text-xs uppercase tracking-wide text-brand-white/50">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Date</th>
              <th scope="col" className="px-4 py-3 font-medium">Member</th>
              <th scope="col" className="px-4 py-3 font-medium">Invoice</th>
              <th scope="col" className="px-4 py-3 font-medium">Method</th>
              <th scope="col" className="px-4 py-3 font-medium">Entry</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-brand-white/5 transition-opacity ${
              isFetching && !isPending ? "opacity-60" : ""
            }`}
          >
            {isPending ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-brand-white/50">
                  Loading payments…
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-brand-white/50">
                  {hasFilters ? "No payments match those filters." : "No payments yet."}
                </td>
              </tr>
            ) : (
              payments.map((payment) => (
                <tr
                  key={payment.id}
                  data-testid={payment.isRefund ? "refund-row" : "payment-row"}
                  onClick={() =>
                    payment.invoiceId ? navigate(`/invoices/${payment.invoiceId}`) : undefined
                  }
                  className="cursor-pointer bg-brand-black hover:bg-brand-white/5"
                >
                  <td className="px-4 py-3 text-brand-white/70">
                    {new Date(payment.paidAt).toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-brand-white">
                    {payment.member.firstName} {payment.member.lastName}
                  </td>
                  <td className="px-4 py-3 text-brand-white/50">
                    {payment.invoice?.invoiceNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-brand-white/50">{payment.method}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={payment.status} />
                  </td>
                  <td
                    data-testid="payment-amount"
                    className={`px-4 py-3 text-right ${
                      payment.isRefund ? "text-brand-white/50" : "text-brand-white"
                    }`}
                  >
                    {formatSignedPrice(payment.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTable>

      {payments.length > 0 ? (
        <p data-testid="net-total" className="text-sm text-brand-white/50">
          Net on this page: {formatPrice(netOnPage.toFixed(2))}
        </p>
      ) : null}

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
