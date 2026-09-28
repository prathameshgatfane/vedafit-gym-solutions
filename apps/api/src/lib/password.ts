import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = `${UPPER}${LOWER}${DIGITS}`;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

/**
 * Readable 10-character temporary password that satisfies `strongPasswordSchema`
 * (8+, lowercase, uppercase, digit). I/l/O/0 are omitted so staff can read it off the screen.
 */
export function generateTemporaryPassword(): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < 10) {
    chars.push(pick(ALL));
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const swap = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = swap;
  }
  return chars.join("");
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Reserved for Phase 2 (`POST /auth/login`) — defined now alongside `hashPassword` so the pair
 * is never split across phases/files. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
