import { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Money handling, in one place, because Phase 6 introduces two modules that both have to agree
 * about it. The rules (Locked Decision 1.16.2 and Section 3's `Decimal(10,2)`):
 *
 *   - amounts arrive as JSON numbers, validated to at most 2 decimal places
 *   - they are stored as `Decimal`, never as a float
 *   - they leave as fixed-2 strings, so nothing downstream can drift a cent doing float maths
 */
export const MAX_AMOUNT = 99_999_999.99;

export function moneyAmountSchema(label: string, { positive = false } = {}) {
  return z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .refine((value) => Number.isFinite(value), `${label} must be a number`)
    .refine(
      (value) => (positive ? value > 0 : value >= 0),
      positive ? `${label} must be greater than zero` : `${label} cannot be negative`,
    )
    .refine((value) => value <= MAX_AMOUNT, `${label} is too large`)
    .refine(
      (value) => Math.round(value * 100) === value * 100,
      `${label} can have at most 2 decimals`,
    );
}

/** The only way an amount becomes a `Decimal` — via a fixed-2 string, never the raw float. */
export function toDecimal(amount: number): Prisma.Decimal {
  return new Prisma.Decimal(amount.toFixed(2));
}

export const ZERO = new Prisma.Decimal(0);
