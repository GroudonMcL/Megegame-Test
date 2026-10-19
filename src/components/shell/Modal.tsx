"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A popup for confirmations and short forms, on the native <dialog> element:
// it traps focus, dims the page, and closes with Escape or a click outside.

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="pointer-events-auto m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-card-solid p-0 text-foreground shadow-xl backdrop:bg-overlay backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="p-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="mt-3">{children}</div>
        </div>
      )}
    </dialog>
  );
}
