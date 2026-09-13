import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice } from "../../lib/money";
import { useSessionStore } from "../../stores/session.store";
import { DEFAULT_INVOICE_LIST_PARAMS } from "./invoice.types";
import { useInvoiceList } from "./useInvoices";

/**
 * A member's bills, on their detail page. Fixed list params rather than the URL hook — this is a
 * panel inside another screen, so it must not fight that screen for the query string.
 */
export function MemberBillingPanel({ memberId }: { memberId: string }) {
  const navigate = useNavigate();
  const canManage = useSessionStore((s) => s.hasPermission("invoices.manage"));

  const { data, isPending, isError, error } = useInvoiceList({
    ...DEFAULT_INVOICE_LIST_PARAMS,
    limit: 50,
    memberId,
  });

  const invoices = data?.items ?? [];
  const outstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.amountPending), 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-brand-white">Billing</h2>
          <p
            data-testid="member-outstanding"
            className={`mt-1 text-sm ${outstanding > 0 ? "text-amber-300" : "text-brand-white/50"}`}
          >
            {outstanding > 0
              ? `${formatPrice(outstanding.toFixed(2))} outstanding`
              : "Nothing outstanding"}
          </p>
        </div>
        {canManage ? (
          <Button
            variant="secondary"
            onClick={() => navigate(`/invoices/new?memberId=${memberId}`)}
          >
            Raise invoice
          </Button>
        ) : null}
      </div>

      {isError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load this member's invoices.")}
        </p>
      ) : null}

      <DataTable>
        <table data-testid="member-invoices" className="w-full text-left text-sm">
          <thead className="bg-brand-black-88 text-xs uppercase tracking-wide text-brand-white/50">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Invoice</th>
              <th scope="col" className="px-4 py-3 font-medium">For</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Total</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Outstanding</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-white/5">
            {isPending ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  Loading invoices…
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  No invoices for this member yet.
                </td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr key={invoice.id} className="bg-brand-black hover:bg-brand-white/5">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/invoices/${invoice.id}`} className="text-brand-green hover:underline">
                      {invoice.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-brand-white/50">{invoice.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-brand-white/70">
                    {formatPrice(invoice.amountTotal)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${
                      Number(invoice.amountPending) > 0 ? "text-amber-300" : "text-brand-white/40"
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
    </section>
  );
}
