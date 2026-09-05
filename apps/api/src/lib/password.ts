import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Reserved for Phase 2 (`POST /auth/login`) — defined now alongside `hashPassword` so the pair
 * is never split across phases/files. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
