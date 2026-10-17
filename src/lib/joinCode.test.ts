import { describe, expect, it } from "vitest";
import { generateJoinCode, normaliseJoinCode } from "./joinCode";

describe("join codes", () => {
  it("generates well-formed codes that survive normalising", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(normaliseJoinCode(code)).toBe(code);
    }
  });

  it("accepts sloppy typing", () => {
    expect(normaliseJoinCode(" k7qm 2xrd-hp4w ")).toBe("K7QM-2XRD-HP4W");
  });

  it("rejects wrong lengths and look-alike characters", () => {
    expect(normaliseJoinCode("K7QM-2XRD")).toBeNull();
    expect(normaliseJoinCode("K7QM-2XRD-HP4O")).toBeNull();
    expect(normaliseJoinCode("K7QM-2XRD-HP41")).toBeNull();
  });
});
