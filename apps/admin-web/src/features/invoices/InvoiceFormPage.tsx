import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useMemberList } from "../members/useMembers";
import { DEFAULT_LIST_PARAMS } from "../members/member.types";
import { invoiceFormSchema, type InvoiceFormValues } from "./invoice.schema";
import { useCreateInvoice } from "./useInvoices";

/**
 * Ad-hoc invoices only — a joining fee, a personal-training block, merchandise. Membership terms
 * bill themselves when they're sold, so there is no plan picker here and no way to double-bill a
 * term by hand.
 */
export function InvoiceFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const createMutation = useCreateInvoice();
  const [formError, setFormError] = useState<string | null>(null);

  // Enough of the roster to pick from without a second search box; the members screen is where
  // you go when you can't find someone here.
  const members = useMemberList({ ...DEFAULT_LIST_PARAMS, limit: 100, status: "ACTIVE" });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      memberId: searchParams.get("memberId") ?? "",
      amountTotal: "",
      notes: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const invoice = await createMutation.mutateAsync(values);
      navigate(`/invoices/${invoice.id}`, { replace: true });
    } catch (err) {
      setFormError(apiErrorMessage(err, "Could not raise this invoice."));
    }
  });

  const memberOptions = (members.data?.items ?? []).map((member) => ({
    value: member.id,
    label: `${member.firstName} ${member.lastName} — ${member.phone}`,
  }));

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-fg">Raise an invoice</h1>
        <p className="mt-1 text-sm text-accent-muted">
          For one-off charges. The amount can't be edited afterwards — a wrong bill is cancelled
          and reissued.
        </p>
      </div>

      {formError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}

      <Select
        label="Member"
        placeholder={members.isPending ? "Loading members…" : "Choose a member"}
        options={memberOptions}
        error={errors.memberId?.message}
        {...register("memberId")}
      />

      <TextField
        label="Amount (₹)"
        inputMode="decimal"
        placeholder="1500.00"
        error={errors.amountTotal?.message}
        {...register("amountTotal")}
      />

      <TextField
        label="What is this for?"
        placeholder="Joining fee"
        error={errors.notes?.message}
        {...register("notes")}
      />

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting || createMutation.isPending}>
          {createMutation.isPending ? "Raising…" : "Raise invoice"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigate("/invoices")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
