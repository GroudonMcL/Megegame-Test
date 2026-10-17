import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time comparison so the password can't be guessed by timing responses. */
export function checkDmPassword(attempt: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(attempt).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
