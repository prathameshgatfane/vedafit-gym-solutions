import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { expenseFormSchema, type ExpenseFormValues } from "./expense.schema";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "./expense.types";
import { useCreateExpense, useExpense, useUpdateExpense } from "./useExpenses";

interface ExpenseFormPageProps {
  mode: "create" | "edit";
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function ExpenseFormPage({ mode }: ExpenseFormPageProps) {
  const navigate = useNavigate();
  const { expenseId } = useParams<{ expenseId: string }>();
  const branches = useSessionStore((s) => s.branches);
  const userBranchId = useSessionStore((s) => s.user?.branchId ?? null);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const existing = useExpense(isEdit ? expenseId : undefined);
  const branchScoped = userBranchId !== null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      category: "RENT",
      amount: "",
      expenseDate: todayIso(),
      branchId: userBranchId ?? "",
      paidTo: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (!isEdit || !existing.data) return;
    reset({
      category: existing.data.category,
      amount: existing.data.amount,
      expenseDate: existing.data.expenseDate,
      branchId: existing.data.branchId ?? "",
      paidTo: existing.data.paidTo ?? "",
      notes: existing.data.notes ?? "",
    });
  }, [isEdit, existing.data, reset]);

  const createMutation = useCreateExpense();
  const updateMutation = useUpdateExpense(expenseId ?? "");

  async function onSubmit(values: ExpenseFormValues) {
    setFormError(null);
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(values);
      } else {
        await createMutation.mutateAsync(values);
      }
      navigate("/expenses", { replace: true });
    } catch (error) {
      setFormError(apiErrorMessage(error, "Could not save this expense."));
    }
  }

  if (isEdit && existing.isPending) return <Spinner label="Loading expense" />;

  if (isEdit && existing.isError) {
    return (
      <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {apiErrorMessage(existing.error, "Could not load this expense.")}
      </p>
    );
  }

  const categoryOptions = EXPENSE_CATEGORIES.map((value) => ({
    value,
    label: EXPENSE_CATEGORY_LABELS[value],
  }));
  const branchOptions = branches.map((branch) => ({ value: branch.id, label: branch.name }));

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-brand-white">
        {isEdit ? "Edit expense" : "Add expense"}
      </h1>
      <p className="mt-1 text-sm text-brand-green-muted">
        {isEdit
          ? "Corrections rewrite this row. The P&L is live."
          : "Leave the branch blank for an org-level cost — software, insurance, that kind of thing."}
      </p>

      <form
        noValidate
        data-testid="expense-form"
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-brand-white/10 bg-brand-black-88 p-6"
      >
        <Select
          label="Category"
          data-testid="expense-category"
          options={categoryOptions}
          error={errors.category?.message}
          {...register("category")}
        />
        <TextField
          label="Amount"
          data-testid="expense-amount"
          inputMode="decimal"
          error={errors.amount?.message}
          {...register("amount")}
        />
        <TextField
          label="Date"
          data-testid="expense-date"
          type="date"
          error={errors.expenseDate?.message}
          {...register("expenseDate")}
        />
        {branchScoped ? (
          <input type="hidden" {...register("branchId")} />
        ) : (
          <Select
            label="Branch"
            data-testid="expense-branch"
            placeholder="Org-level (no branch)"
            options={branchOptions}
            error={errors.branchId?.message}
            {...register("branchId")}
          />
        )}
        <TextField
          label="Paid to"
          data-testid="expense-paid-to"
          placeholder="Optional"
          error={errors.paidTo?.message}
          {...register("paidTo")}
        />
        <TextField
          label="Notes"
          data-testid="expense-notes"
          placeholder="Optional"
          error={errors.notes?.message}
          {...register("notes")}
        />

        {formError ? (
          <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {formError}
          </p>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Record expense"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate("/expenses")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
