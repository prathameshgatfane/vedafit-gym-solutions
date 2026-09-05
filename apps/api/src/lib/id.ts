import { ulid } from "ulid";

/**
 * Generates a new primary-key ID for any model.
 *
 * Per docs/architecture/DEVELOPMENT_PLAN.md Locked Decision 1.2: ULID, canonicalized to
 * lowercase (the `id` columns use an explicit case-sensitive collation, so we always produce
 * one consistent case ourselves rather than relying on comparisons being case-insensitive).
 *
 * 26 lowercase Crockford-base32 characters — matches every model's `@db.Char(26)` column.
 */
export function generateId(): string {
  return ulid().toLowerCase();
}

/** Crockford base32 alphabet used by ULID, lowercase — for validating/testing generated IDs. */
export const ULID_LOWERCASE_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/;
