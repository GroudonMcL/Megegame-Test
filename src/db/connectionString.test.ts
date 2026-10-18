import { describe, expect, it } from "vitest";
import { parseConnectionString } from "./connectionString";

const HOST = "aws-0-eu-west-2.pooler.supabase.com";

describe("parseConnectionString", () => {
  it("reads a normal Supabase pooler string", () => {
    expect(parseConnectionString(`postgresql://postgres.abcdef:Secret123@${HOST}:6543/postgres`)).toEqual({
      host: HOST,
      port: 6543,
      database: "postgres",
      username: "postgres.abcdef",
      password: "Secret123",
      ssl: "require",
    });
  });

  it("accepts passwords with symbols that would break a normal URL", () => {
    for (const pw of ["50%off", "a%zz", "p@ss", "x#y", "a/b?c", "colon:inside", "%", "100%"]) {
      const opts = parseConnectionString(`postgresql://postgres.abc:${pw}@${HOST}:6543/postgres`);
      expect(opts.password, pw).toBe(pw);
      expect(opts.host, pw).toBe(HOST);
    }
  });

  it("decodes a password that was already percent-encoded", () => {
    expect(parseConnectionString(`postgresql://u:p%40ss%25@${HOST}:6543/postgres`).password).toBe("p@ss%");
  });

  it("ignores query parameters, surrounding quotes and whitespace", () => {
    const opts = parseConnectionString(` "postgres://u:pw@localhost/megagame?sslmode=require" `);
    expect(opts).toMatchObject({ host: "localhost", port: 5432, database: "megagame", password: "pw", ssl: false });
  });

  it("explains common copy-paste mistakes", () => {
    expect(() => parseConnectionString(`postgresql://u:[YOUR-PASSWORD]@${HOST}:6543/postgres`)).toThrow(/placeholder/);
    expect(() => parseConnectionString(`${HOST}:6543/postgres`)).toThrow(/postgresql:\/\//);
    expect(() => parseConnectionString(`postgresql://${HOST}:6543/postgres`)).toThrow(/user name and password/);
  });
});
