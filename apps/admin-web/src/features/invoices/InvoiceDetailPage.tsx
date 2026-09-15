import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice, formatSignedPrice } from "../../lib/money";
import { useSessionStore } from "../../stores/session.store";
import {
  DEFAULT_PAYMENT_LIST_PARAMS,
  isRefundable,
  PAYMENT_METHOD_OPTIONS,
  type Payment,
  type PaymentMethod,
} from "../payments/payment.types";
import { usePaymentList, useRecordPayment, useRefundPayment } from "../payments/usePayments";
import { invoiceActions } from "./invoice.types";
import { useCancelInvoice, useInvoice } from "./useInvoices";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="mt-1 text-sm text-fg">{children}</dd>
    </div>
  );
}

/** Which pending panel, if any, is on screen. Only one at a time. */
type Panel = { kind: "pay" } | { kind: "refund"; payment: Payment } | { kind: "cancel" } | null;

export function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();

  const { data: invoice, isPending, isError, error } = useInvoice(invoiceId);
  const ledger = usePaymentList({
    ...DEFAULT_PAYMENT_LIST_PARAMS,
    limit: 100,
    sortBy: "createdAt",
    sortOrder: "asc",
    invoiceId,
  });

  const canRecordPayment = useSessionStore((s) => s.hasPermission("payments.create"));
  const canViewPayments = useSessionStore((s) => s.hasPermission("payments.view"));
  const canRefund = useSessionStore((s) => s.hasPermission("payments.refund"));
  const canManage = useSessionStore((s) => s.hasPermission("invoices.manage"));

  const recordMutation = useRecordPayment();
  const refundMutation = useRefundPayment();
  const cancelMutation = useCancelInvoice();

  const [panel, setPanel] = useState<Panel>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (isPending) return <Spinner label="Loading invoice" />;

  if (isError || !invoice) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {apiErrorMessage(error, "Could not load this invoice.")}
        </p>
        <Button variant="secondary" onClick={() => navigate("/invoices")}>
          Back to invoices
        </Button>
      </div>
    );
  }

  const actions = invoiceActions(invoice);
  const payments = ledger.data?.items ?? [];
  const busy = recordMutation.isPending || refundMutation.isPending || cancelMutation.isPending;

  function closePanel() {
    setPanel(null);
    setActionError(null);
    setAmount("");
    setReason("");
  }

  async function run(work: () => Promise<void>) {
    setActionError(null);
    try {
      await work();
    } catch (err) {
      // The likely failures are PAYMENT_EXCEEDS_INVOICE, REFUND_EXCEEDS_PAYMENT and
      // PERMISSION_DENIED — all surfaced verbatim, since the server is the authority.
      setActionError(apiErrorMessage(err, "Could not complete that action."));
    }
  }

  const handleRecordPayment = () =>
    run(async () => {
      if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
        setActionError("Enter an amount greater than zero, with up to 2 decimals.");
        return;
      }
      const { invoice: updated } = await recordMutation.mutateAsync({
        invoiceId: invoice.id,
        amount: Number(amount),
        method,
      });
      closePanel();
      setNotice(
        updated.status === "PAID"
          ? `Payment recorded — ${updated.invoiceNumber} is now settled in full.`
          : `Payment recorded — ${formatPrice(updated.amountPending)} still outstanding.`,
      );
    });

  const handleRefund = (payment: Payment) =>
    run(async () => {
      if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
        setActionError("Enter an amount greater than zero, with up to 2 decimals.");
        return;
      }
      const { invoice: updated } = await refundMutation.mutateAsync({
        paymentId: payment.id,
        amount: Number(amount),
        reason: reason.trim() || undefined,
      });
      closePanel();
      setNotice(
        `Refund recorded as a new entry — the original payment is unchanged.${
          updated ? ` This invoice now shows ${formatPrice(updated.amountPending)} outstanding.` : ""
        }`,
      );
    });

  const handleCancel = () =>
    run(async () => {
      await cancelMutation.mutateAsync(invoice.id);
      closePanel();
      setNotice("Invoice cancelled. Raise a new one if the member still owes something.");
    });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 data-testid="invoice-heading" className="text-2xl font-semibold text-fg">
              {invoice.invoiceNumber}
            </h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="mt-1 text-sm text-accent-muted">
            <Link to={`/members/${invoice.memberId}`} className="hover:text-accent-text">
              {invoice.member.firstName} {invoice.member.lastName}
            </Link>{" "}
            · {invoice.member.phone}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate("/invoices")}>
          Back
        </Button>
      </div>

      {notice ? (
        <p
          data-testid="action-notice"
          className="rounded-md border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent-muted"
        >
          {notice}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      <dl className="grid gap-5 rounded-lg border border-border bg-surface p-6 sm:grid-cols-4">
        <Field label="Total billed">
          <span data-testid="amount-total">{formatPrice(invoice.amountTotal)}</span>
        </Field>
        <Field label="Collected">
          <span data-testid="amount-paid">{formatPrice(invoice.amountPaid)}</span>
        </Field>
        <Field label="Outstanding">
          <span
            data-testid="amount-pending"
            className={Number(invoice.amountPending) > 0 ? "text-warning" : undefined}
          >
            {formatPrice(invoice.amountPending)}
          </span>
        </Field>
        <Field label="Raised">{new Date(invoice.createdAt).toLocaleDateString("en-IN")}</Field>
        <Field label="For">{invoice.notes ?? "—"}</Field>
        {invoice.membershipId ? (
          <Field label="Membership term">
            <Link
              to={`/memberships/${invoice.membershipId}`}
              className="text-accent-text hover:underline"
            >
              {invoice.membership
                ? `${invoice.membership.startDate} → ${invoice.membership.endDate}`
                : "View term"}
            </Link>
          </Field>
        ) : null}
      </dl>

      <div data-testid="invoice-actions" className="flex flex-wrap gap-3">
        {canRecordPayment && actions.canRecordPayment ? (
          <Button disabled={busy} onClick={() => setPanel({ kind: "pay" })}>
            Record payment
          </Button>
        ) : null}
        {canManage && actions.canCancel ? (
          <Button variant="danger" disabled={busy} onClick={() => setPanel({ kind: "cancel" })}>
            Cancel invoice
          </Button>
        ) : null}
      </div>

      {panel?.kind === "pay" ? (
        <div
          data-testid="record-payment-panel"
          className="rounded-lg border border-border bg-surface p-5"
        >
          <h2 className="text-sm font-semibold text-fg">Record a payment</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {formatPrice(invoice.amountPending)} is outstanding. Part payments are fine; anything
            more than the balance is refused.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <TextField
              label="Amount (₹)"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Select
              label="Method"
              options={PAYMENT_METHOD_OPTIONS}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            />
            <Button
              data-testid="confirm-payment"
              disabled={busy}
              onClick={() => void handleRecordPayment()}
            >
              Save payment
            </Button>
            <Button variant="secondary" disabled={busy} onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {panel?.kind === "cancel" ? (
        <div
          role="alertdialog"
          data-testid="confirm-cancel-invoice"
          className="rounded-lg border border-danger/40 bg-danger/5 p-5"
        >
          <h2 className="text-sm font-semibold text-fg">
            Cancel {invoice.invoiceNumber}?
          </h2>
          <p className="mt-1 text-sm text-fg/70">
            The amount billed can't be edited, so cancelling and raising a new invoice is how a
            wrong bill gets corrected. This one has nothing collected against it.
          </p>
          <div className="mt-3 flex gap-3">
            <Button variant="danger" disabled={busy} onClick={() => void handleCancel()}>
              Cancel invoice
            </Button>
            <Button variant="secondary" disabled={busy} onClick={closePanel}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}

      {canViewPayments ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-fg">Payment history</h2>
            <p className="text-xs text-fg-muted">
              Receipts and refunds, oldest first. Nothing here is ever edited or deleted.
            </p>
          </div>

          <DataTable>
            <table data-testid="payment-history" className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Date</th>
                  <th scope="col" className="px-4 py-3 font-medium">Entry</th>
                  <th scope="col" className="px-4 py-3 font-medium">Method</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Amount</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fg/5">
                {ledger.isPending ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-fg-muted">
                      Loading payments…
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-fg-muted">
                      Nothing collected yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr
                      key={payment.id}
                      data-testid={payment.isRefund ? "refund-row" : "payment-row"}
                      className="bg-bg"
                    >
                      <td className="px-4 py-3 text-fg/70">
                        {new Date(payment.paidAt).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={payment.status} />
                      </td>
                      <td className="px-4 py-3 text-fg-muted">{payment.method}</td>
                      <td
                        className={`px-4 py-3 text-right ${
                          payment.isRefund ? "text-fg-muted" : "text-fg"
                        }`}
                      >
                        {formatSignedPrice(payment.amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canRefund && isRefundable(payment) ? (
                          <Button
                            variant="secondary"
                            data-testid="refund-button"
                            disabled={busy}
                            onClick={() => {
                              setAmount(payment.amount);
                              setPanel({ kind: "refund", payment });
                            }}
                          >
                            Refund
                          </Button>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </DataTable>
        </section>
      ) : null}

      {panel?.kind === "refund" ? (
        <div
          role="alertdialog"
          data-testid="confirm-refund"
          className="rounded-lg border border-danger/40 bg-danger/5 p-5"
        >
          <h2 className="text-sm font-semibold text-fg">
            Refund {formatPrice(panel.payment.amount)} taken by {panel.payment.method}?
          </h2>
          <p className="mt-1 text-sm text-fg/70">
            This adds a separate refund entry — the original payment stays on the record exactly as
            it is, and the action is written to the audit log against your name. Refund less than
            the full amount if you're only returning part of it.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <TextField
              label="Refund amount (₹)"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="min-w-64 flex-1">
              <TextField
                label="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Goes into the audit log"
              />
            </div>
            <Button
              variant="danger"
              data-testid="submit-refund"
              disabled={busy}
              onClick={() => void handleRefund(panel.payment)}
            >
              Issue refund
            </Button>
            <Button variant="secondary" disabled={busy} onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
