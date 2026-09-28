import { describe, expect, it } from "vitest";
import {
  entitlementDisplayLabel,
  formatFeatureState,
  isUnavailableUsage,
  orderedEntitlements,
  overLimitBy,
  unavailableReasonCopy,
} from "./usage-display";

describe("usage display helpers", () => {
  it("does not treat unavailable as zero", () => {
    const metric = { available: false as const, reason: "NO_CONSUMPTION_PATH" };
    expect(isUnavailableUsage(metric)).toBe(true);
    expect(unavailableReasonCopy(metric.reason)).toBe(
      "No consumption path currently implemented.",
    );
    expect(unavailableReasonCopy(metric.reason)).not.toMatch(/^0/);
  });

  it("calculates over-limit by the surplus only", () => {
    expect(overLimitBy(137, 50)).toBe(87);
    expect(overLimitBy(50, 50)).toBe(0);
    expect(overLimitBy(10, 50)).toBe(0);
  });

  it("labels features without inventing keys", () => {
    expect(formatFeatureState(true)).toBe("Enabled");
    expect(formatFeatureState(false)).toBe("Disabled");
    expect(entitlementDisplayLabel("members.max")).toBe("Maximum members");
    expect(entitlementDisplayLabel("unknown.key")).toBe("unknown.key");
  });

  it("orders known entitlements by the catalog", () => {
    const rows = orderedEntitlements([
      { key: "leads", valueType: "BOOLEAN", intValue: null, boolValue: true },
      { key: "members.max", valueType: "LIMIT", intValue: 200, boolValue: null },
    ]);
    expect(rows.map((row) => row.key)).toEqual(["members.max", "leads"]);
  });
});
