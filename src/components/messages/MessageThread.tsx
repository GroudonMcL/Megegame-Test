"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { MAX_MESSAGE_LENGTH } from "@/engine/messages";
import type { MessageView } from "@/lib/messages";

// One conversation between the DM and a team, for either side. New messages
// show on refresh; while the window is open it refreshes itself every
// REFRESH_MS, so a reply turns up without reloading.

const REFRESH_MS = 20_000;

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" });

export function MessageThread({
  messages,
  me,
  send,
  hadUnread,
  empty,
}: {
  messages: MessageView[];
  /** Which side is reading: their own messages sit on the right. */
  me: "dm" | "team";
  send: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Opening the thread just marked messages read: refresh once so unread counts elsewhere update. */
  hadUnread: boolean;
  empty: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (hadUnread) router.refresh();
  }, [hadUnread, router]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const submit = () =>
    start(async () => {
      const r = await send(text);
      if (r.ok) {
        setText("");
        setError("");
        router.refresh();
      } else setError(r.error);
    });

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1" aria-label="Messages">
        {messages.length === 0 && <li className="text-sm text-muted">{empty}</li>}
        {messages.map((m) => {
          const mine = (me === "dm") === m.fromDm;
          return (
            <li key={m.id} className={`max-w-[85%] rounded-xl border px-3 py-2 text-sm ${mine ? "self-end border-accent/50 bg-accent/15" : "self-start border-border bg-raised"}`}>
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                <span className="font-semibold text-foreground">{m.authorName}</span>
                <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
                {m.kind === "note" && <span className="rounded border border-border px-1">change note</span>}
              </p>
              <p className="mt-0.5 break-words whitespace-pre-wrap">{m.body}</p>
            </li>
          );
        })}
        <li ref={end} aria-hidden />
      </ol>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="message" className="sr-only">
          Your message
        </label>
        <textarea
          id="message"
          rows={3}
          maxLength={MAX_MESSAGE_LENGTH}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none hover:border-border-strong focus:border-accent"
          placeholder={me === "dm" ? "Write to the team…" : "Write to the DM…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50" disabled={pending || !text.trim()}>
            Send
          </button>
          <span className="text-xs text-muted">Ctrl+Enter sends. New messages show up every 20 seconds while this is open.</span>
          {error && (
            <span role="alert" className="w-full text-sm text-danger">
              {error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
