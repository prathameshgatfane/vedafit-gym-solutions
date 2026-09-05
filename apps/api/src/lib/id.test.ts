import { describe, expect, it } from "vitest";
import { generateId, ULID_LOWERCASE_PATTERN } from "./id";

describe("generateId", () => {
  it("produces a 26-character lowercase Crockford-base32 ULID", () => {
    const id = generateId();

    expect(id).toHaveLength(26);
    expect(id).toBe(id.toLowerCase()); // no uppercase characters at all
    expect(id).toMatch(ULID_LOWERCASE_PATTERN);
  });

  it("produces unique, monotonically-sortable-ish IDs across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000); // no collisions
    for (const id of ids) {
      expect(id).toMatch(ULID_LOWERCASE_PATTERN);
    }
  });
});
