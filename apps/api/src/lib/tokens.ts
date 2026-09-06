import { createHash, randomBytes } from "node:crypto";

/**
 * Refresh tokens and password-reset tokens are opaque random strings, not JWTs — they must be
 * revocable server-side, which a self-contained signed token can't be. Only the SHA-256 hash is
 * persisted, so a leaked database dump yields nothing that can be replayed.
 */

/** 32 bytes of CSPRNG output, base64url-encoded (43 chars, no padding or URL-unsafe characters). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest. Plain hashing (not bcrypt) is correct here: the input is already
 * high-entropy random, so there is nothing for a slow KDF to protect against. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
