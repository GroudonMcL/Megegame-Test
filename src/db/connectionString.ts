import type { Options } from "postgres";

export type ConnectionOptions = Pick<
  Options<Record<string, never>>,
  "host" | "port" | "database" | "username" | "password" | "ssl"
>;

/**
 * Splits a Postgres connection string into its parts by hand, so a database
 * password can contain any character (%, @, #, /, ?, :) without the user having
 * to percent-encode it. A password that is already percent-encoded still works.
 */
export function parseConnectionString(raw: string): ConnectionOptions {
  const url = raw.trim().replace(/^["']|["']$/g, "");
  const scheme = /^postgres(?:ql)?:\/\//i.exec(url);
  if (!scheme) {
    throw new Error('DATABASE_URL must start with "postgresql://". Copy it again from Supabase → Connect.');
  }
  const rest = url.slice(scheme[0].length);

  // The host never contains "@", so the last "@" separates the login from the host.
  const at = rest.lastIndexOf("@");
  if (at < 0) throw new Error("DATABASE_URL is missing the user name and password part (user:password@host).");
  const credentials = rest.slice(0, at);
  const location = rest.slice(at + 1);

  // Supabase user names ("postgres.abcdef") never contain ":", so the first ":" ends the user name.
  const colon = credentials.indexOf(":");
  const username = decodeIfEncoded(colon < 0 ? credentials : credentials.slice(0, colon));
  const password = colon < 0 ? "" : decodeIfEncoded(credentials.slice(colon + 1));
  if (/^\[.*\]$/.test(password)) {
    throw new Error("DATABASE_URL still contains the [YOUR-PASSWORD] placeholder. Replace it (brackets included) with your database password.");
  }

  const slash = location.search(/[/?]/);
  const hostPort = slash < 0 ? location : location.slice(0, slash);
  const path = slash < 0 ? "" : location.slice(slash);
  const database = path.startsWith("/") ? path.slice(1).split("?")[0] : "";
  const portMatch = /:(\d+)$/.exec(hostPort);
  const host = portMatch ? hostPort.slice(0, portMatch.index) : hostPort;
  if (!host) throw new Error("DATABASE_URL has no host name after the @.");

  return {
    host,
    port: portMatch ? Number(portMatch[1]) : 5432,
    database: database || "postgres",
    username,
    password,
    // Encrypt everything except a database on this same machine.
    ssl: ["localhost", "127.0.0.1", "::1"].includes(host) ? false : "require",
  };
}

/** "p%40ss" → "p@ss", but a raw "50%off" (not valid encoding) is left alone. */
function decodeIfEncoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
