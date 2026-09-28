import type { UseFormSetValue } from "react-hook-form";
import { Select } from "../../components/ui/Select";
import { TextField } from "../../components/ui/TextField";
import {
  entitlementLabel,
  isLimitEntitlementKey,
  SAAS_ENTITLEMENT_DEFS,
} from "./entitlement-catalog";
import type { PlanFormValues } from "./plan.schema";

export interface EntitlementEditorProps {
  values: PlanFormValues["entitlements"];
  errors?: { [index: number]: { intValue?: { message?: string } } | undefined };
  setValue: UseFormSetValue<PlanFormValues>;
}

export function EntitlementEditor({ values, errors, setValue }: EntitlementEditorProps) {
  return (
    <fieldset className="flex flex-col gap-4" data-testid="entitlement-editor">
      <legend className="text-lg font-semibold text-fg">Entitlements</legend>
      <p className="text-sm text-fg-muted">
        Values use the catalog keys the API already knows. Organizations on this plan receive
        these limits immediately after you save.
      </p>
      <ul className="flex flex-col gap-4">
        {SAAS_ENTITLEMENT_DEFS.map((def) => {
          const index = values.findIndex((row) => row.key === def.key);
          const row = index >= 0 ? values[index] : undefined;
          if (!row || index < 0) return null;
          const error = errors?.[index];

          if (isLimitEntitlementKey(def.key)) {
            return (
              <li
                key={def.key}
                className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_10rem_8rem]"
              >
                <div>
                  <p className="text-sm font-medium text-fg">{entitlementLabel(def.key)}</p>
                  <p className="text-xs text-fg-muted">{def.key}</p>
                </div>
                <Select
                  label="Type"
                  options={[
                    { value: "LIMIT", label: "Limited" },
                    { value: "UNLIMITED", label: "Unlimited" },
                  ]}
                  value={row.valueType === "UNLIMITED" ? "UNLIMITED" : "LIMIT"}
                  onChange={(event) => {
                    const next = event.target.value === "UNLIMITED" ? "UNLIMITED" : "LIMIT";
                    setValue(`entitlements.${index}.valueType`, next, { shouldValidate: true });
                    if (next === "UNLIMITED") {
                      setValue(`entitlements.${index}.intValue`, "", { shouldValidate: true });
                    } else if (!row.intValue) {
                      setValue(`entitlements.${index}.intValue`, "0", { shouldValidate: true });
                    }
                  }}
                />
                {row.valueType === "UNLIMITED" ? (
                  <p className="self-end text-sm text-fg-muted">Unlimited</p>
                ) : (
                  <TextField
                    label="Limit"
                    inputMode="numeric"
                    value={row.intValue ?? ""}
                    error={error?.intValue?.message}
                    onChange={(event) =>
                      setValue(`entitlements.${index}.intValue`, event.target.value, {
                        shouldValidate: true,
                      })
                    }
                  />
                )}
              </li>
            );
          }

          return (
            <li
              key={def.key}
              className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_10rem]"
            >
              <div>
                <p className="text-sm font-medium text-fg">{entitlementLabel(def.key)}</p>
                <p className="text-xs text-fg-muted">{def.key}</p>
              </div>
              <Select
                label="Access"
                options={[
                  { value: "true", label: "Enabled" },
                  { value: "false", label: "Disabled" },
                ]}
                value={row.boolValue ? "true" : "false"}
                onChange={(event) => {
                  setValue(`entitlements.${index}.valueType`, "BOOLEAN", { shouldValidate: true });
                  setValue(`entitlements.${index}.boolValue`, event.target.value === "true", {
                    shouldValidate: true,
                  });
                }}
              />
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
