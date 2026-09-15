import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { SELECT_CONTROL_CLASS, SelectChevron } from "./form-control";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: { value: string; label: string }[];
  /** Rendered as a value-less first option, for "no filter" / "choose one". */
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, options, placeholder, id, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={[
            SELECT_CONTROL_CLASS,
            "py-2",
            error ? "border-danger" : "border-fg/20",
            className,
          ].join(" ")}
          {...props}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <SelectChevron />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
