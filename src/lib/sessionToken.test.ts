import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./sessionToken";

const SECRET = "x".repeat(40);

describe("session tokens", () => {
  it("round-trips a team session", async () => {
    const p = { role: "team" as const, teamId: "t", gameId: "g", playerId: "p", epoch: 2 };
    expect(await verifySession(await signSession(p, SECRET, 60), SECRET)).toEqual(p);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession({ role: "dm" }, "y".repeat(40), 60);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({ role: "team", teamId: "t", gameId: "g", playerId: "p", epoch: 0 }, SECRET, 60);
    const [h, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ role: "dm", iss: "megagame" })).toString("base64url");
    expect(await verifySession(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession({ role: "dm" }, SECRET, -10);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it("refuses a short secret", async () => {
    await expect(signSession({ role: "dm" }, "short", 60)).rejects.toThrow(/SESSION_SECRET/);
  });
});
