import { describe, expect, it } from "vitest";
import type { SaasPlan } from "../plans/plan.types";
import {
  catalogPriceForInterval,
  entitlementImpactRows,
  formatEntitlementImpact,
  subscriptionConfirmCopy,
} from "./subscription-change-preview";
import type { OrganizationDetail } from "./organization.types";

const growth: SaasPlan = {
  id: "plan_growth",
  code: "growth",
  name: "Growth",
  description: null,
  priceMonthly: "0.00",
  priceYearly: "999.00",
  currency: "INR",
  trialDays: 14,
  isActive: true,
  entitlements: [
    { key: "members.max", valueType: "UNLIMITED", intValue: null, boolValue: null },
    { key: "branches.max", valueType: "LIMIT", intValue: 5, boolValue: null },
    { key: "staff.max", valueType: "UNLIMITED", intValue: null, boolValue: null },
    { key: "leads", valueType: "BOOLEAN", intValue: null, boolValue: true },
  ],
};

const starter: SaasPlan = {
  ...growth,
  id: "plan_starter",
  code: "starter",
  name: "Starter",
  priceMonthly: "499.00",
  priceYearly: "4990.00",
  entitlements: [
    { key: "members.max", valueType: "LIMIT", intValue: 50, boolValue: null },
    { key: "branches.max", valueType: "LIMIT", intValue: 1, boolValue: null },
    { key: "staff.max", valueType: "LIMIT", intValue: 3, boolValue: null },
    { key: "leads", valueType: "BOOLEAN", intValue: null, boolValue: false },
  ],
};

const current: NonNullable<OrganizationDetail["subscription"]> = {
  id: "sub_1",
  status: "ACTIVE",
  billingInterval: "MONTHLY",
  priceSnapshot: "0.00",
  currentPeriodStart: "2026-09-01T00:00:00.000Z",
  currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  plan: { id: "plan_growth", code: "growth", name: "Growth" },
};

describe("subscription change preview", () => {
  it("uses the selected plan and interval for the catalog price", () => {
    expect(catalogPriceForInterval(starter, "MONTHLY")).toBe("499.00");
    expect(catalogPriceForInterval(starter, "YEARLY")).toBe("4990.00");
  });

  it("summarizes entitlement impact without inventing keys or implying unchanged values", () => {
    const rows = entitlementImpactRows(growth, starter);
    expect(rows.map((row) => `${row.label}: ${row.summary}`)).toEqual([
      "Members: Unlimited → 50",
      "Branches: 5 → 1",
      "Staff: Unlimited → 3",
      "Leads: Enabled → Disabled",
    ]);
    expect(
      formatEntitlementImpact(
        { key: "branches.max", valueType: "LIMIT", intValue: 1, boolValue: null },
        { key: "branches.max", valueType: "LIMIT", intValue: 1, boolValue: null },
      ),
    ).toBe("1 (unchanged)");
  });

  it("builds current vs new copy and omits entitlement impact when the plan does not change", () => {
    const copy = subscriptionConfirmCopy({
      organizationName: "Phase F Check",
      current,
      currentPlan: growth,
      next: {
        plan: growth,
        status: "PAST_DUE",
        billingInterval: "YEARLY",
        catalogPrice: "999.00",
        currentPeriodEnd: "2027-01-01T00:00:00.000Z",
      },
    });
    expect(copy.organizationName).toBe("Phase F Check");
    expect(copy.planChanged).toBe(false);
    expect(copy.entitlementImpact).toEqual([]);
    expect(copy.current.plan).toContain("Growth");
    expect(copy.next.status).toBe("PAST_DUE");
    expect(copy.next.catalogPrice).toBe("₹999.00");
  });
});
