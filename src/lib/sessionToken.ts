import { SignJWT, jwtVerify } from "jose";

export type SessionPayload =
  | { role: "dm" }
  | { role: "team"; teamId: string; gameId: string; playerId: string; epoch: number };

const ISSUER = "megagame";

function key(secret: string) {
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters long. See docs/SETUP.md.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload, secret: string, maxAgeSeconds: number) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(key(secret));
}

/** Returns the payload, or null if the token is missing, tampered with or expired. */
export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, algorithms: ["HS256"] });
    if (payload.role === "dm") return { role: "dm" };
    if (
      payload.role === "team" &&
      typeof payload.teamId === "string" &&
      typeof payload.gameId === "string" &&
      typeof payload.playerId === "string" &&
      typeof payload.epoch === "number"
    ) {
      return {
        role: "team",
        teamId: payload.teamId,
        gameId: payload.gameId,
        playerId: payload.playerId,
        epoch: payload.epoch,
      };
    }
    return null;
  } catch {
    return null;
  }
}
