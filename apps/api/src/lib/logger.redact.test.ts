import { once } from "node:events";
import { PassThrough } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { LOGGER_REDACT_PATHS } from "./logger";

describe("logger redaction (Phase J)", () => {
  it("redacts authorization, cookies, tokens, and password fields", async () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });

    const log = pino(
      {
        level: "info",
        redact: { paths: [...LOGGER_REDACT_PATHS], censor: "[Redacted]" },
      },
      stream,
    );

    log.info(
      {
        req: {
          headers: {
            authorization: "Bearer secret-access-token",
            cookie: "refresh_token=secret-refresh-cookie",
          },
          body: {
            password: "OwnerPlain1!",
            owner: { password: "NestedOwner1!" },
            currentPassword: "Current1!",
            newPassword: "NewPass1!",
          },
        },
        password: "TopLevel1!",
        passwordHash: "$2a$10$not-a-real-hash-value",
        temporaryPassword: "TempPass9x",
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
      },
      "auth attempt",
    );
    stream.end();
    await once(stream, "finish");

    const out = chunks.join("");
    expect(out).toContain("[Redacted]");
    expect(out).not.toContain("secret-access-token");
    expect(out).not.toContain("secret-refresh-cookie");
    expect(out).not.toContain("OwnerPlain1!");
    expect(out).not.toContain("NestedOwner1!");
    expect(out).not.toContain("Current1!");
    expect(out).not.toContain("NewPass1!");
    expect(out).not.toContain("TopLevel1!");
    expect(out).not.toContain("$2a$10$not-a-real-hash-value");
    expect(out).not.toContain("TempPass9x");
    expect(out).not.toContain("access-secret");
    expect(out).not.toContain("refresh-secret");
  });
});
