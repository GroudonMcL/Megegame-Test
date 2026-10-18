"use client";

import { useState, useTransition } from "react";
import { renameUnitAction } from "@/app/play/actions";

export function RenameUnit({ unitId, name, placeholder }: { unitId: string; name: string; placeholder: string }) {
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(name);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const save = () => {
    if (value.trim() === saved) return;
    start(async () => {
      const r = await renameUnitAction(unitId, value);
      if (r.ok) {
        setSaved(r.value);
        setValue(r.value);
        setError("");
      } else setError(r.error);
    });
  };
  return (
    <span className="inline-flex flex-col">
      <input
        aria-label="Unit name"
        className="w-56 max-w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-base font-medium hover:border-border focus:border-accent focus:outline-none"
        value={value}
        placeholder={placeholder}
        maxLength={60}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      {pending && <span className="text-xs text-muted">Saving…</span>}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
