import { describe, expect, it } from "vitest";
import { cleanMessage, MAX_MESSAGE_LENGTH, unreadCount } from "./messages";

describe("cleaning a message", () => {
  it("trims it and squeezes runs of blank lines", () => {
    expect(cleanMessage("  Hello\r\n\r\n\r\n\r\nthere  ")).toEqual({ ok: true, body: "Hello\n\nthere" });
  });

  it("has nothing to send when it's blank", () => {
    expect(cleanMessage("   \n  ")).toBeNull();
  });

  it("refuses one that's too long", () => {
    expect(cleanMessage("x".repeat(MAX_MESSAGE_LENGTH))).toMatchObject({ ok: true });
    expect(cleanMessage("x".repeat(MAX_MESSAGE_LENGTH + 1))).toMatchObject({ ok: false });
  });
});

describe("unread messages", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 20, 12, min));
  const thread = [
    { fromDm: true, createdAt: at(0) },
    { fromDm: false, createdAt: at(1) },
    { fromDm: true, createdAt: at(5) },
    { fromDm: false, createdAt: at(6) },
    { fromDm: false, createdAt: at(7) },
  ];

  it("counts only the other side's messages", () => {
    expect(unreadCount(thread, null, "team")).toBe(2);
    expect(unreadCount(thread, null, "dm")).toBe(3);
  });

  it("counts only messages after the reader last opened the thread", () => {
    expect(unreadCount(thread, at(5), "team")).toBe(0);
    expect(unreadCount(thread, at(4), "team")).toBe(1);
    expect(unreadCount(thread, at(6), "dm")).toBe(1);
  });
});
