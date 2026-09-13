import { forwardRef, useId, type InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Validation message. Wired to `aria-describedby` + `aria-invalid` so tests and screen
   * readers find it the same way. */
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, id, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-brand-white">
        {label}
      </label>
      <input
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={[
          "w-full rounded-md bg-brand-black px-3 py-2 text-sm text-brand-white",
          "border placeholder:text-brand-white/40",
          "focus:outline-none focus:ring-2 focus:ring-brand-green",
          error ? "border-red-400" : "border-brand-white/20",
          className,
        ].join(" ")}
        {...props}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
});
