import { randomInt } from "node:crypto";

// No 0/O or 1/I/L, so codes are easy to read aloud and type on a phone.
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 3;
const GROUP_LEN = 4;

/** A random code like "K7QM-2XRD-HP4W" (about 59 bits of randomness). */
export function generateJoinCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let s = "";
    for (let i = 0; i < GROUP_LEN; i++) s += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
    groups.push(s);
  }
  return groups.join("-");
}

/**
 * Turns whatever a player typed ("k7qm 2xrd hp4w") into the stored form
 * ("K7QM-2XRD-HP4W"). Returns null if it can't possibly be a valid code.
 */
export function normaliseJoinCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== GROUPS * GROUP_LEN) return null;
  for (const ch of cleaned) if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) groups.push(cleaned.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN));
  return groups.join("-");
}
